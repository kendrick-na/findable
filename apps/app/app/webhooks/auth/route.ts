import { analytics } from "@repo/analytics/server";
import type {
  DeletedObjectJSON,
  OrganizationJSON,
  OrganizationMembershipJSON,
  UserJSON,
  WebhookEvent,
} from "@repo/auth/server";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { captureOpsAlert } from "@repo/observability/ops-alert";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { env } from "@/env";
import { clerkUserPresence } from "@/lib/privacy/clerk-user-presence";
import { eraseDeletedUser } from "@/lib/privacy/erase-deleted-user";
import {
  GuardLookupError,
  writeUnlessDeleted,
} from "@/lib/privacy/guarded-user-write";

// 20번(D2 근본): org/user를 Prisma DB에 정식 적재하는 소유 경로.
//   기존엔 analytics만 발생시켜 DB가 비어 있었고, 그 탓에 Brand.organizationId FK가
//   가리킬 Organization row가 없어 Tracking 적재가 불가능했다(근본원인 A).
//   여기서 User/Organization을 DB에 upsert해 그 뿌리를 해소한다. best-effort:
//   DB 쓰기 실패가 웹훅 200을 막지 않도록 try/catch(analytics·응답은 그대로).
//   🔴 2026-10-20: 탈퇴 표식(DeletedClerkUser)이 있으면 **절대 쓰지 않는다**(`writeUnlessDeleted`).
//     표식 조회 자체가 실패하면(표 없음 포함) `GuardLookupError` 를 던진다 → 호출부가 500(fail-closed).
const upsertUserToDb = async (
  data: UserJSON
): Promise<"tombstoned" | "written" | "write_failed"> => {
  const email = data.email_addresses.at(0)?.email_address;
  const name =
    [data.first_name, data.last_name].filter(Boolean).join(" ").trim() || null;
  try {
    return await writeUnlessDeleted(database, data.id, async (tx) => {
      if (!email) {
        return; // email은 User @unique NOT NULL. 없으면 적재 불가 → skip(표식 확인은 했다).
      }
      await tx.user.upsert({
        where: { id: data.id }, // User.id = Clerk user_id
        create: { id: data.id, email, name },
        update: { email, name },
      });
    });
  } catch (error) {
    if (error instanceof GuardLookupError) {
      throw error;
    }
    log.error("webhook.user.upsert_failed", {
      userId: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return "write_failed";
  }
};

/**
 * 가입·수정 공통: Clerk 존재 확인(보조) → 탈퇴 표식 확인 + 적재(주 방어).
 * @returns 멈춰야 하면 Response, 계속(분석 전송)하면 null.
 */
const syncUserOrStop = async (data: UserJSON): Promise<Response | null> => {
  const stop = await stopIfUserGone(data);
  if (stop) {
    return stop;
  }
  let outcome: Awaited<ReturnType<typeof upsertUserToDb>>;
  try {
    outcome = await upsertUserToDb(data);
  } catch (error) {
    log.error("webhook.user.tombstone_lookup_failed", {
      userId: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response("Tombstone lookup failed", { status: 500 });
  }
  if (outcome === "tombstoned") {
    log.info("privacy.user_upsert.skipped_tombstone", { userId: data.id });
    return new Response("Ignored: user was deleted", { status: 200 });
  }
  return null;
};

/**
 * 🔒 PostHog 로 보내는 사용자 속성 — **내부 id(distinctId) + 가입 시각만** (2026-10-20 대표 결정 ③).
 *
 * 예전엔 이메일·이름·전화번호·프로필 사진 주소를 그대로 보냈다. PostHog 는 이용 분석 도구라
 * 그 값들이 필요 없고, 보내는 순간 해외 위탁처에 개인정보가 쌓인다.
 * ⚠️ 여기에 개인 식별 칸을 다시 넣지 말 것 — `webhook-privacy-erasure.test.ts` 가 막는다.
 * ⚠️ 과거에 이미 보낸 값은 PostHog 화면에서 직접 지워야 한다(범위표 4-2).
 */
const analyticsUserProperties = (data: UserJSON) => ({
  createdAt: new Date(data.created_at),
});

/**
 * 🔴 늦은 웹훅 부활 방지(2026-10-20, 코덱스 검토). 적재 전에 Clerk 에 이 사용자가 아직 있는지 본다.
 *   - 없음(404) → 이미 탈퇴한 사람의 늦은 이벤트 → 적재·분석 전송 없이 200 으로 끝낸다.
 *   - 조회 실패 → 500 을 돌려 Clerk 가 나중에 다시 보내게 한다(모르는 채로 되살리지 않는다).
 * @returns 처리를 멈춰야 하면 돌려줄 Response, 계속하면 null.
 */
const stopIfUserGone = async (data: UserJSON): Promise<Response | null> => {
  try {
    if ((await clerkUserPresence(data.id)) === "gone") {
      log.info("privacy.user_upsert.skipped_deleted", { userId: data.id });
      return new Response("Ignored: user no longer exists", { status: 200 });
    }
    return null;
  } catch (error) {
    log.error("webhook.user.clerk_lookup_failed", {
      userId: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response("Clerk lookup failed", { status: 500 });
  }
};

const handleUserCreated = async (data: UserJSON): Promise<Response> => {
  const stop = await syncUserOrStop(data);
  if (stop) {
    return stop;
  }

  analytics?.identify({
    distinctId: data.id,
    properties: analyticsUserProperties(data),
  });

  analytics?.capture({
    event: "User Created",
    distinctId: data.id,
  });

  return new Response("User created", { status: 201 });
};

const handleUserUpdated = async (data: UserJSON): Promise<Response> => {
  const stop = await syncUserOrStop(data); // DB email/name 동기화(멱등) 포함.
  if (stop) {
    return stop;
  }

  analytics?.identify({
    distinctId: data.id,
    properties: analyticsUserProperties(data),
  });

  analytics?.capture({
    event: "User Updated",
    distinctId: data.id,
  });

  return new Response("User updated", { status: 201 });
};

/**
 * 🔴 탈퇴 = 회원 정보 즉시 삭제 (2026-10-20 대표 결정 ①).
 *
 * 예전엔 analytics 만 남기고 **DB 를 하나도 안 지웠다** — 처리방침은 「탈퇴 시 파기」를 약속하는데
 * 이메일·이름이 그대로 남아 있었다. 지우는 범위는 `lib/privacy/erase-deleted-user.ts`
 * (표: `docs/_적용/개인정보_삭제범위_20261020.md`).
 *
 * ⚠️ 다른 핸들러와 달리 **DB 실패를 삼키지 않고 500 을 돌려준다.** 삭제는 반드시 끝나야 하는
 *   일이라 Clerk(Svix)가 다시 보내게 한다. 삭제는 한 트랜잭션·멱등이라 재시도해도 안전하다.
 */
const handleUserDeleted = async (
  data: DeletedObjectJSON
): Promise<Response> => {
  if (data.id) {
    try {
      const result = await eraseDeletedUser(database, data.id);
      // 결과에는 id·건수만 있다(이메일 원문 없음).
      log.info("privacy.user_erase.done", { userId: data.id, ...result });
      if (result.emailHoldReason) {
        // 역할 주소·다른 회원과 같은 이메일 → 무료 진단·리드 이메일을 자동으로 바꾸지 않았다.
        log.warn("privacy.user_erase.email_held", {
          userId: data.id,
          reason: result.emailHoldReason,
          auditJobCount: result.heldAuditJobIds.length,
          auditJobIds: result.heldAuditJobIds,
          leadCount: result.heldLeadIds.length,
          leadIds: result.heldLeadIds,
        });
      }
      for (const held of result.ownershipHeld) {
        // 소유권 이전 보류 — ownerId 는 그대로다. 운영자가 확인해 직접 정한다(범위표 6절).
        log.warn("privacy.owner_transfer.held", {
          userId: data.id,
          orgId: held.orgId,
          reason: held.reason,
        });
        captureOpsAlert("privacy.owner_transfer.held", {
          orgId: held.orgId,
          reason: held.reason,
        });
      }
      if (result.soleOwnerOrgIds.length > 0) {
        // 혼자 쓰던 조직은 지우지 않았다 — 확정 방침(정기결제 해지 → 30일 뒤 삭제)은
        // 스키마 변경이 필요해 다음 단계(범위표 3-1). 조직 id 만 남긴다.
        log.warn("privacy.user_erase.sole_owner_orgs", {
          userId: data.id,
          orgIds: result.soleOwnerOrgIds,
        });
      }
    } catch (error) {
      log.error("privacy.user_erase.failed", {
        userId: data.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Response("User erase failed", { status: 500 });
    }

    analytics?.identify({
      distinctId: data.id,
      properties: {
        deleted: new Date(),
      },
    });

    // ⚠️ Clerk 재전송 때 이 이벤트가 한 번 더 기록될 수 있다(DB 삭제는 멱등, 분석 이벤트는 아님 — 영향 낮음, 범위표 4-5).
    analytics?.capture({
      event: "User Deleted",
      distinctId: data.id,
    });
  }

  return new Response("User deleted", { status: 201 });
};

// Organization을 DB에 적재(D2 근본, D3=ownerId는 Clerk data.created_by).
//   billing 필드(plan/billingStatus)는 기입하지 않는다 → 스키마 기본값(free/trialing)에 위임,
//   결제 웹훅이 소유(설계 R6: 잘못된 billing 고착 방지). best-effort.
const upsertOrgToDb = async (data: OrganizationJSON): Promise<void> => {
  try {
    await database.organization.upsert({
      where: { id: data.id }, // Organization.id = Clerk org_id (Brand.organizationId가 이 값)
      create: {
        id: data.id,
        name: data.name,
        // created_by 없을 일은 거의 없으나(웹훅 payload), 방어적으로 id 폴백.
        ownerId: data.created_by ?? data.id,
      },
      update: { name: data.name },
    });
  } catch (error) {
    log.error("webhook.org.upsert_failed", {
      orgId: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const handleOrganizationCreated = async (
  data: OrganizationJSON
): Promise<Response> => {
  await upsertOrgToDb(data);

  analytics?.groupIdentify({
    groupKey: data.id,
    groupType: "company",
    distinctId: data.created_by,
    // 조직 사진 주소는 보내지 않는다(개인 사진일 수 있음 — 2026-10-20).
    properties: {
      name: data.name,
    },
  });

  if (data.created_by) {
    analytics?.capture({
      event: "Organization Created",
      distinctId: data.created_by,
    });
  }

  return new Response("Organization created", { status: 201 });
};

const handleOrganizationUpdated = async (
  data: OrganizationJSON
): Promise<Response> => {
  await upsertOrgToDb(data); // name 등 DB 동기화(멱등).

  analytics?.groupIdentify({
    groupKey: data.id,
    groupType: "company",
    distinctId: data.created_by,
    // 조직 사진 주소는 보내지 않는다(개인 사진일 수 있음 — 2026-10-20).
    properties: {
      name: data.name,
    },
  });

  if (data.created_by) {
    analytics?.capture({
      event: "Organization Updated",
      distinctId: data.created_by,
    });
  }

  return new Response("Organization updated", { status: 201 });
};

/**
 * 🔴 **가입자를 조직에 연결한다** (N-46 실측 버그).
 *
 * 이 핸들러는 analytics 만 쐈고 **DB 를 건드리지 않았다.** 그 결과
 * `User.organizationId` 가 **7명 전원 NULL** 이었다 — 스키마에 필드도 있고
 * 관계도 걸려 있는데 **채우는 코드가 어디에도 없었다.**
 *
 * 증상: 운영 콘솔이 *"가입자 0"* 이라고 말한다. 조직에 사람이 분명히 있는데도.
 * 📕 이 저장소의 최다 사고 유형 「못 잰 것을 0이라 부르기」의 데이터판이다.
 *
 * ⚠️ DB 실패가 웹훅 200 을 막지 않게 한다(`upsertUserToDb` 와 같은 방침) —
 *   Clerk 가 재시도 폭주하는 것보다 로그를 남기고 넘어가는 편이 낫다.
 */
/**
 * 조직 연결 결과. 호출부가 이것으로 응답·분석 전송을 정한다(코덱스 4차).
 *  - linked: 연결/해제함
 *  - tombstoned: 탈퇴 표식 있음 → 쓰지 않음, **분석 이벤트도 보내지 않음**
 *  - no_user_row: 회원 행이 아직 없음(user.created 보다 먼저 온 정상 순서 문제) → 201 유지
 *  - write_failed: 실제 DB 쓰기 실패 → 500(Clerk 재시도)
 * 잠금·표식 조회 실패(GuardLookupError)는 던진다 → POST 가 500.
 */
type OrgLinkResult = "linked" | "no_user_row" | "tombstoned" | "write_failed";

const linkUserToOrg = async (
  userId: string,
  orgId: string | null
): Promise<OrgLinkResult> => {
  let updated = 0;
  try {
    // 탈퇴·소유권 이전과 같은 잠금 안에서 쓴다(이전 중 새 소유자가 빠져나가는 경합 방지).
    // updateMany 라 회원 행이 없으면 오류 대신 0건 → 「아직 없음」과 「쓰기 실패」를 가른다.
    const outcome = await writeUnlessDeleted(database, userId, async (tx) => {
      updated = (
        await tx.user.updateMany({
          where: { id: userId },
          data: { organizationId: orgId },
        })
      ).count;
    });
    if (outcome === "tombstoned") {
      return "tombstoned";
    }
    if (updated === 0) {
      // 아직 user.created 가 안 들어온 순서(정상 가능 경로) — 기존처럼 201.
      log.warn("webhook.user.org_link_no_user_row", { userId, orgId });
      return "no_user_row";
    }
    return "linked";
  } catch (error) {
    // 🔴 잠금·탈퇴 표식 조회 실패(표 없음·DB 장애)는 그대로 올린다 → POST 가 500(재시도).
    if (error instanceof GuardLookupError) {
      throw error;
    }
    // 🔴 실제 쓰기 실패도 삼키지 않는다 → 호출부가 500(코덱스 4차). 예전엔 201 로 끝나 조용히 누락됐다.
    log.error("webhook.user.org_link_failed", {
      userId,
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "write_failed";
  }
};

/** 조직 연결 결과가 응답을 정해야 하면 그 Response, 계속(분석 전송)하면 null. */
const stopForOrgLink = (result: OrgLinkResult): Response | null => {
  if (result === "write_failed") {
    return new Response("Organization link failed", { status: 500 });
  }
  if (result === "tombstoned") {
    return new Response("Ignored: user was deleted", { status: 200 });
  }
  return null;
};

const handleOrganizationMembershipCreated = async (
  data: OrganizationMembershipJSON
) => {
  const linked = await linkUserToOrg(
    data.public_user_data.user_id,
    data.organization.id
  );
  const stop = stopForOrgLink(linked);
  if (stop) {
    return stop;
  }

  analytics?.groupIdentify({
    groupKey: data.organization.id,
    groupType: "company",
    distinctId: data.public_user_data.user_id,
  });

  analytics?.capture({
    event: "Organization Member Created",
    distinctId: data.public_user_data.user_id,
  });

  return new Response("Organization membership created", { status: 201 });
};

const handleOrganizationMembershipDeleted = async (
  data: OrganizationMembershipJSON
) => {
  // 🔴 next-forge 기본 코드의 `// Need to unlink the user from the group` 이
  //   **주석으로만 남아 있었다**(N-46). 나가면 연결을 끊는다 — 안 끊으면 운영 콘솔이
  //   **이미 나간 사람을 가입자로** 계속 보여준다.
  const unlinked = await linkUserToOrg(data.public_user_data.user_id, null);
  const stop = stopForOrgLink(unlinked);
  if (stop) {
    return stop;
  }

  analytics?.capture({
    event: "Organization Member Deleted",
    distinctId: data.public_user_data.user_id,
  });

  return new Response("Organization membership deleted", { status: 201 });
};

export const POST = async (request: Request): Promise<Response> => {
  if (!env.CLERK_WEBHOOK_SECRET) {
    return NextResponse.json({ message: "Not configured", ok: false });
  }

  // Get the headers
  const headerPayload = await headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");

  // If there are no headers, error out
  if (!(svixId && svixTimestamp && svixSignature)) {
    return new Response("Error occured -- no svix headers", {
      status: 400,
    });
  }

  // Get the body
  const payload = (await request.json()) as object;
  const body = JSON.stringify(payload);

  // Create a new SVIX instance with your secret.
  const webhook = new Webhook(env.CLERK_WEBHOOK_SECRET);

  let event: WebhookEvent | undefined;

  // Verify the payload with the headers
  try {
    event = webhook.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as WebhookEvent;
  } catch (error) {
    // 🔬 BL-Day17-03(2026-08-12 세션N-24) — 키를 `도메인.대상.동작` 으로 통일했다.
    //   `"Error verifying webhook:"` 은 문장이라 **검색·집계가 불가능**했다
    //   (다른 21개 결제 로그는 이미 `billing.*`·`payments.webhook.*` 규칙을 따른다).
    log.error("webhook.auth.invalid_signature", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return new Response("Error occured", {
      status: 400,
    });
  }

  // Get the ID and type
  const { id } = event.data;
  const eventType = event.type;

  // 🔴🔴 **개인정보 유출을 막았다**(2026-08-12 세션N-24).
  //   예전엔 `body`(= Clerk 원문 JSON 전체)를 그대로 로그에 넣었다. 그 안에는
  //   **이메일·이름·전화번호·아바타 URL** 이 평문으로 들어 있고(위 핸들러들이 읽는
  //   필드가 그 증거다), 가입·수정이 일어날 때마다 **Logtail 에 그대로 적재**됐다.
  //   ⚠️ 로그는 지우기 어렵고 보존기간이 길다 — 필요 없는 개인정보는 **애초에 안 넣는다**.
  //
  //   🔬 그럼 무엇을 남기나: 장애 조사에 **실제로 필요한 것만**(누가·무슨 이벤트).
  //   `id` 는 Clerk 식별자라 개인정보가 아니고, DB·PostHog 와 대조하는 열쇠다.
  //   ⚠️ 2026-10-20: `analytics.identify` 도 더는 개인정보를 보내지 않는다
  //      (`analyticsUserProperties` — 내부 id·가입 시각만).
  log.info("webhook.auth.received", { id, eventType });

  let response: Response = new Response("", { status: 201 });

  // 🔴 탈퇴 표식·잠금 조회 실패(GuardLookupError)는 어느 이벤트에서든 500 — 조용히 201 로 넘기지 않는다.
  try {
    switch (eventType) {
      case "user.created": {
        response = await handleUserCreated(event.data);
        break;
      }
      case "user.updated": {
        response = await handleUserUpdated(event.data);
        break;
      }
      case "user.deleted": {
        response = await handleUserDeleted(event.data);
        break;
      }
      case "organization.created": {
        response = await handleOrganizationCreated(event.data);
        break;
      }
      case "organization.updated": {
        response = await handleOrganizationUpdated(event.data);
        break;
      }
      case "organizationMembership.created": {
        response = await handleOrganizationMembershipCreated(event.data);
        break;
      }
      case "organizationMembership.deleted": {
        response = await handleOrganizationMembershipDeleted(event.data);
        break;
      }
      default: {
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof GuardLookupError)) {
      throw error;
    }
    log.error("webhook.auth.tombstone_lookup_failed", { id, eventType });
    response = new Response("Tombstone lookup failed", { status: 500 });
  }

  await analytics?.shutdown();

  if (response.status >= 500) {
    // 🔎 실패 추적(2026-10-20): Clerk 가 다시 보낼 이벤트다. 개인정보 없이 이벤트 id·유형만 남긴다.
    //   운영자 확인 절차: 범위표 6절(로그 검색 → Clerk 대시보드에서 같은 id 재전송 확인).
    log.error("webhook.auth.failed", {
      eventId: svixId,
      eventType,
      status: response.status,
    });
    captureOpsAlert("webhook.auth.failed", {
      eventId: svixId,
      eventType,
      status: response.status,
    });
  }

  return response;
};
