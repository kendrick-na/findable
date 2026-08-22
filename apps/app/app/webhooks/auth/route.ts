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
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { env } from "@/env";

// 20번(D2 근본): org/user를 Prisma DB에 정식 적재하는 소유 경로.
//   기존엔 analytics만 발생시켜 DB가 비어 있었고, 그 탓에 Brand.organizationId FK가
//   가리킬 Organization row가 없어 Tracking 적재가 불가능했다(근본원인 A).
//   여기서 User/Organization을 DB에 upsert해 그 뿌리를 해소한다. best-effort:
//   DB 실패가 웹훅 200을 막지 않도록 try/catch(analytics·응답은 그대로).
const upsertUserToDb = async (data: UserJSON): Promise<void> => {
  const email = data.email_addresses.at(0)?.email_address;
  if (!email) {
    return; // email은 User @unique NOT NULL. 없으면 적재 불가 → skip.
  }
  const name =
    [data.first_name, data.last_name].filter(Boolean).join(" ").trim() || null;
  try {
    await database.user.upsert({
      where: { id: data.id }, // User.id = Clerk user_id
      create: { id: data.id, email, name },
      update: { email, name },
    });
  } catch (error) {
    log.error("webhook.user.upsert_failed", {
      userId: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const handleUserCreated = async (data: UserJSON): Promise<Response> => {
  await upsertUserToDb(data);

  analytics?.identify({
    distinctId: data.id,
    properties: {
      email: data.email_addresses.at(0)?.email_address,
      firstName: data.first_name,
      lastName: data.last_name,
      createdAt: new Date(data.created_at),
      avatar: data.image_url,
      phoneNumber: data.phone_numbers.at(0)?.phone_number,
    },
  });

  analytics?.capture({
    event: "User Created",
    distinctId: data.id,
  });

  return new Response("User created", { status: 201 });
};

const handleUserUpdated = async (data: UserJSON): Promise<Response> => {
  await upsertUserToDb(data); // DB email/name 동기화(멱등).

  analytics?.identify({
    distinctId: data.id,
    properties: {
      email: data.email_addresses.at(0)?.email_address,
      firstName: data.first_name,
      lastName: data.last_name,
      createdAt: new Date(data.created_at),
      avatar: data.image_url,
      phoneNumber: data.phone_numbers.at(0)?.phone_number,
    },
  });

  analytics?.capture({
    event: "User Updated",
    distinctId: data.id,
  });

  return new Response("User updated", { status: 201 });
};

const handleUserDeleted = (data: DeletedObjectJSON) => {
  if (data.id) {
    analytics?.identify({
      distinctId: data.id,
      properties: {
        deleted: new Date(),
      },
    });

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
    properties: {
      name: data.name,
      avatar: data.image_url,
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
    properties: {
      name: data.name,
      avatar: data.image_url,
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
const linkUserToOrg = async (
  userId: string,
  orgId: string | null
): Promise<void> => {
  try {
    await database.user.update({
      where: { id: userId },
      data: { organizationId: orgId },
    });
  } catch (error) {
    // 아직 user.created 가 안 들어온 순서면 여기서 실패한다(정상 가능 경로).
    log.error("webhook.user.org_link_failed", {
      userId,
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const handleOrganizationMembershipCreated = async (
  data: OrganizationMembershipJSON
) => {
  await linkUserToOrg(data.public_user_data.user_id, data.organization.id);

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
  await linkUserToOrg(data.public_user_data.user_id, null);

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
  //   ⚠️ `analytics.identify`(위 `handleUserCreated`)가 개인정보를 보내는 것은
  //      **의도된 것**이다 — 거긴 CRM 이고 여긴 운영 로그다. 목적이 다르다.
  log.info("webhook.auth.received", { id, eventType });

  let response: Response = new Response("", { status: 201 });

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
      response = handleUserDeleted(event.data);
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

  await analytics?.shutdown();

  return response;
};
