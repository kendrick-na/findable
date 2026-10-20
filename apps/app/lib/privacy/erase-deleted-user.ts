/**
 * 탈퇴 회원 정보 삭제 — 2026-10-20 (대표 결정 ① 「탈퇴 시 회원 정보 즉시 삭제」, 2차: 코덱스 검토 반영).
 *
 * 범위표: `docs/_적용/개인정보_삭제범위_20261020.md` — **표를 고치면 이 파일도 같이 고칠 것.**
 *
 * 원칙(대표 확정): 개인을 알아볼 수 있는 값(이메일·이름·전화·토큰·IP)만 지우거나 가리고,
 *   개인과 연결되지 않는 측정 결과·집계·조직 데이터는 최대한 보존한다.
 *
 * 규칙
 *  - 한 트랜잭션 안에서 전부 하거나 전부 안 한다(중간에 실패하면 아무것도 안 바뀜 → Clerk 재시도로 다시 처리).
 *  - 멱등: 두 번 돌려도 결과가 같다(이미 처리된 건 0건으로 끝난다).
 *  - 조직 공유 데이터(브랜드·측정·리포트)와 결제·계약 기록은 **건드리지 않는다**.
 *  - 이메일만으로 남의 기록을 바꾸지 않는다: 역할 주소(info@ 등)나 다른 회원과 같은 이메일이면
 *    무료 진단·리드 이메일을 **바꾸지 않고 보류**(id·건수만 돌려준다 — 이메일 원문은 남기지 않는다).
 *  - 3차(코덱스 2차 검토): 트랜잭션 **첫 단계**에서 탈퇴 표식(DeletedClerkUser)을 남긴다. 같은 사용자의
 *    가입·수정·조직 연결과는 advisory lock(`clerkUserLockKey`)으로 한 줄로 세운다 → 늦은 웹훅이 되살리지 못한다.
 *  - 조직 소유자였으면 가장 먼저 가입한 남은 구성원에게 넘긴다 — **조직마다 별도 트랜잭션**(한 조직 실패가
 *    회원 삭제 전체를 되돌리지 않게). 새 소유자를 잠그고 아직 구성원인지 다시 확인한 뒤에만 바꾼다.
 *    확인 실패·오류면 `ownerId` 를 바꾸지 않고 보류로 돌려준다. 남은 구성원이 없으면 id 만 돌려준다
 *    (확정 방침 「정기결제 해지 → 30일 뒤 삭제」는 다음 단계).
 *  - 스키마 변경: 추가 표 1개(DeletedClerkUser)뿐. 표가 없으면 첫 단계에서 실패 → 웹훅 500(fail-closed).
 */

import type { database } from "@repo/database";
import {
  advisoryXactLock,
  clerkUserLockKey,
} from "@repo/database/advisory-lock";

/** 무료 진단·리드 이메일을 바꿔 넣는 자리표시. `.invalid` 는 예약 최상위 도메인이라 실제로 배달되지 않는다. */
export const ERASED_EMAIL = "deleted-user@deleted.invalid";

/** 메일함 연결을 끊었다는 표시. 화면·초안 API 는 `connected` 가 아니면 연결 안 됨으로 본다. */
export const REVOKED_MAILBOX_STATUS = "revoked";

/** 검색 성과 연결을 끊은 이유 코드. 동기화는 토큰이 없으면 시작하지 않는다(`syncConnection`). */
export const OWNER_DELETED_ERROR_CODE = "OWNER_ACCOUNT_DELETED";

/**
 * 여러 사람이 함께 쓰는 「역할 주소」의 @ 앞부분. 이런 주소는 탈퇴자 한 사람의 것이라고
 * 단정할 수 없으므로 무료 진단·리드 이메일을 자동으로 바꾸지 않는다(보류).
 */
export const ROLE_EMAIL_LOCAL_PARTS: ReadonlySet<string> = new Set([
  "admin",
  "biz",
  "business",
  "contact",
  "cs",
  "help",
  "hello",
  "hr",
  "info",
  "mail",
  "marketing",
  "office",
  "pr",
  "press",
  "sales",
  "service",
  "support",
  "team",
  "webmaster",
]);

/** 보류 시 돌려주는 id 개수 상한(로그가 커지지 않게). */
const HELD_ID_LIMIT = 50;

const TX_OPTIONS = { maxWait: 5000, timeout: 15_000 } as const;
const TRANSFER_TX_OPTIONS = { maxWait: 5000, timeout: 10_000 } as const;

export type OwnershipHoldReason =
  | "successor_left_during_transfer"
  | "owner_already_changed"
  | "transfer_error";

export type EmailHoldReason = "role_address" | "shared_with_other_user";

export interface EraseDeletedUserResult {
  actionCompletionsUnlinked: number;
  annotationsUnlinked: number;
  auditJobEmailsErased: number;
  contentReviewEventsUnlinked: number;
  contentRevisionsUnlinked: number;
  /** 이메일을 바꾸지 않고 보류한 이유. null = 보류 없음. */
  emailHoldReason: EmailHoldReason | null;
  /** 보류된 무료 진단 id(최대 50개). 이메일 원문은 담지 않는다. */
  heldAuditJobIds: string[];
  heldLeadIds: string[];
  leadEmailsErased: number;
  mailboxConnectionsRevoked: number;
  outreachDraftSendersCleared: number;
  /** 소유권 이전을 보류한 조직(ownerId 그대로) — 운영자 확인 필요. */
  ownershipHeld: Array<{ orgId: string; reason: OwnershipHoldReason }>;
  /** 소유권을 넘긴 조직: 조직 id → 새 소유자 id. */
  ownershipTransfers: Array<{ orgId: string; newOwnerId: string }>;
  partnerApplicationsDeleted: number;
  searchConnectionsRevoked: number;
  /** 탈퇴자가 소유자이고 남은 구성원이 0명인 조직 id — 지우지 않았다(다음 단계). */
  soleOwnerOrgIds: string[];
  /** 회원 행이 있었는가. false 면 이미 지웠거나 처음부터 적재되지 않은 회원. */
  userFound: boolean;
  usersDeleted: number;
}

/** 역할 주소인가(`info+tag@` 처럼 + 뒤는 무시). */
export function isRoleEmail(email: string): boolean {
  const local = email.trim().toLowerCase().split("@")[0]?.split("+")[0] ?? "";
  return ROLE_EMAIL_LOCAL_PARTS.has(local);
}

const insensitive = (value: string) => ({
  equals: value,
  mode: "insensitive" as const,
});

type EraseClient = Pick<typeof database, "$transaction">;

type MemberErasure = Omit<
  EraseDeletedUserResult,
  "ownershipHeld" | "ownershipTransfers" | "soleOwnerOrgIds"
> & { ownedOrgIds: string[] };

export async function eraseDeletedUser(
  client: EraseClient,
  userId: string
): Promise<EraseDeletedUserResult> {
  if (!userId) {
    throw new Error("eraseDeletedUser: userId 가 비어 있다");
  }
  const { ownedOrgIds, ...member } = await eraseMemberData(client, userId);

  const ownershipTransfers: Array<{ orgId: string; newOwnerId: string }> = [];
  const ownershipHeld: Array<{ orgId: string; reason: OwnershipHoldReason }> =
    [];
  const soleOwnerOrgIds: string[] = [];
  for (const orgId of ownedOrgIds) {
    let outcome: TransferOutcome;
    try {
      outcome = await transferOrgOwnership(client, orgId, userId);
    } catch {
      outcome = { kind: "held", reason: "transfer_error" };
    }
    if (outcome.kind === "transferred") {
      ownershipTransfers.push({ orgId, newOwnerId: outcome.newOwnerId });
    } else if (outcome.kind === "no_member") {
      soleOwnerOrgIds.push(orgId);
    } else {
      ownershipHeld.push({ orgId, reason: outcome.reason });
    }
  }
  return { ...member, ownershipTransfers, ownershipHeld, soleOwnerOrgIds };
}

type TransferOutcome =
  | { kind: "transferred"; newOwnerId: string }
  | { kind: "no_member" }
  | { kind: "held"; reason: OwnershipHoldReason };

/**
 * 조직 1곳의 소유권을 가장 먼저 가입한 남은 구성원에게 넘긴다(별도 트랜잭션).
 * 새 소유자를 잠근 뒤(조직 연결·해제와 같은 잠금) 아직 구성원인지 **다시** 확인하고,
 * 소유자가 여전히 탈퇴자일 때만 바꾼다. 아니면 바꾸지 않고 보류.
 */
export async function transferOrgOwnership(
  client: EraseClient,
  orgId: string,
  formerOwnerId: string
): Promise<TransferOutcome> {
  return await client.$transaction(async (tx) => {
    const candidate = await tx.user.findFirst({
      where: { organizationId: orgId, id: { not: formerOwnerId } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!candidate) {
      return { kind: "no_member" } as const;
    }
    await advisoryXactLock(tx, clerkUserLockKey(candidate.id));
    const stillMember = await tx.user.findFirst({
      where: { id: candidate.id, organizationId: orgId },
      select: { id: true },
    });
    if (!stillMember) {
      return {
        kind: "held",
        reason: "successor_left_during_transfer",
      } as const;
    }
    const changed = await tx.organization.updateMany({
      where: { id: orgId, ownerId: formerOwnerId },
      data: { ownerId: candidate.id },
    });
    if (changed.count !== 1) {
      return { kind: "held", reason: "owner_already_changed" } as const;
    }
    return { kind: "transferred", newOwnerId: candidate.id } as const;
  }, TRANSFER_TX_OPTIONS);
}

/** 회원 본인 정보 삭제(한 트랜잭션). 첫 단계에서 탈퇴 표식을 남긴다. */
function eraseMemberData(
  client: EraseClient,
  userId: string
): Promise<MemberErasure> {
  return client.$transaction(async (tx) => {
    // 0) 같은 사용자의 가입·수정·조직 연결 웹훅과 한 줄로 선다(잠금은 트랜잭션 끝에 풀린다).
    await advisoryXactLock(tx, clerkUserLockKey(userId));
    // 0-1) 탈퇴 표식 — 이후 늦게 온 user.created/updated 는 이 표식을 보고 적재하지 않는다.
    //      표가 없으면(마이그레이션 미적용) 여기서 던진다 → 전체 롤백 → 웹훅 500(재시도).
    await tx.deletedClerkUser.upsert({
      where: { clerkId: userId },
      create: { clerkId: userId },
      update: {},
    });
    // 이메일은 지우기 **전에** 읽는다 — 무료 진단 기록·초안 보낸사람에서 같은 주소를 찾는 열쇠다.
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const email = user?.email?.trim() ?? "";
    const mailboxes = await tx.mailboxConnection.findMany({
      where: { userId },
      select: { email: true },
    });

    // ── 1) 회원 본인 정보 ──────────────────────────────────────────
    const usersDeleted = await tx.user.deleteMany({ where: { id: userId } });
    const partner = await tx.partnerApplication.deleteMany({
      where: { userId },
    });
    // 행을 지우면 영업 초안 기록(OutreachDraft)이 함께 지워지므로 주소·토큰만 비운다.
    const mailbox = await tx.mailboxConnection.updateMany({
      where: { userId },
      data: {
        email: "",
        encryptedRefreshToken: "",
        scopes: [],
        status: REVOKED_MAILBOX_STATUS,
      },
    });
    // 탈퇴자가 연결한 GSC·GA4: 토큰(본인 Google 권한)만 지우고 끊김 처리. 받아 둔 일별 수치는 조직 것이라 유지.
    const searchConnections = await tx.searchPerformanceConnection.updateMany({
      where: { createdBy: userId, encryptedRefreshToken: { not: null } },
      data: {
        encryptedRefreshToken: null,
        status: "error",
        lastErrorCode: OWNER_DELETED_ERROR_CODE,
      },
    });
    // 탈퇴자 본인 주소가 보낸사람으로 남은 초안만 비운다(받는 사람은 영업 대상 주소라 유지).
    const ownAddresses = [
      ...new Set(
        [email, ...mailboxes.map((m) => m.email)]
          .map((a) => a.trim())
          .filter((a) => a && !isRoleEmail(a))
      ),
    ];
    let outreachDraftSendersCleared = 0;
    for (const address of ownAddresses) {
      outreachDraftSendersCleared += (
        await tx.outreachDraft.updateMany({
          where: { userId, sender: insensitive(address) },
          data: { sender: "" },
        })
      ).count;
    }

    // ── 2) 조직 기록의 작성자 표시만 비운다(내용은 조직 것) ─────────────
    const actionCompletions = await tx.actionCompletion.updateMany({
      where: { completedBy: userId },
      data: { completedBy: null },
    });
    const annotations = await tx.annotation.updateMany({
      where: { createdBy: userId },
      data: { createdBy: null },
    });
    const reviewEvents = await tx.contentReviewEvent.updateMany({
      where: { actorId: userId },
      data: { actorId: null },
    });
    const revisions = await tx.contentRevision.updateMany({
      where: { createdBy: userId },
      data: { createdBy: null },
    });

    // ── 3) 무료 진단·리드의 같은 이메일 — 확실히 본인 것일 때만 바꾼다 ─────
    let auditJobEmailsErased = 0;
    let leadEmailsErased = 0;
    let emailHoldReason: EmailHoldReason | null = null;
    let heldAuditJobIds: string[] = [];
    let heldLeadIds: string[] = [];
    if (email && email !== ERASED_EMAIL) {
      const emailWhere = { email: insensitive(email) };
      const othersWithSameEmail = await tx.user.count({
        where: { ...emailWhere, id: { not: userId } },
      });
      if (isRoleEmail(email)) {
        emailHoldReason = "role_address";
      } else if (othersWithSameEmail > 0) {
        emailHoldReason = "shared_with_other_user";
      }
      if (emailHoldReason) {
        heldAuditJobIds = (
          await tx.auditJob.findMany({
            where: emailWhere,
            select: { id: true },
            take: HELD_ID_LIMIT,
          })
        ).map((r) => r.id);
        heldLeadIds = (
          await tx.lead.findMany({
            where: emailWhere,
            select: { id: true },
            take: HELD_ID_LIMIT,
          })
        ).map((r) => r.id);
      } else {
        auditJobEmailsErased = (
          await tx.auditJob.updateMany({
            where: emailWhere,
            data: { email: ERASED_EMAIL },
          })
        ).count;
        leadEmailsErased = (
          await tx.lead.updateMany({
            where: emailWhere,
            data: { email: ERASED_EMAIL },
          })
        ).count;
      }
    }

    // ── 4) 소유 조직 목록만 읽는다 — 이전은 조직마다 별도 트랜잭션(transferOrgOwnership).
    const owned = await tx.organization.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });

    return {
      userFound: user !== null,
      usersDeleted: usersDeleted.count,
      partnerApplicationsDeleted: partner.count,
      mailboxConnectionsRevoked: mailbox.count,
      searchConnectionsRevoked: searchConnections.count,
      outreachDraftSendersCleared,
      actionCompletionsUnlinked: actionCompletions.count,
      annotationsUnlinked: annotations.count,
      contentReviewEventsUnlinked: reviewEvents.count,
      contentRevisionsUnlinked: revisions.count,
      auditJobEmailsErased,
      leadEmailsErased,
      emailHoldReason,
      heldAuditJobIds,
      heldLeadIds,
      ownedOrgIds: owned.map((org) => org.id),
    };
  }, TX_OPTIONS);
}
