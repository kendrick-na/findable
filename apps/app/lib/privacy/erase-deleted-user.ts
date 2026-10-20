/**
 * 탈퇴 회원 정보 삭제 — 2026-10-20 (대표 결정 ① 「탈퇴 시 회원 정보 즉시 삭제」).
 *
 * 범위표: `docs/_적용/개인정보_삭제범위_20261020.md` — **표를 고치면 이 파일도 같이 고칠 것.**
 *
 * 규칙
 *  - 한 트랜잭션 안에서 전부 하거나 전부 안 한다(중간에 실패하면 아무것도 안 바뀜 → Clerk 재시도로 다시 처리).
 *  - 멱등: 모든 쓰기가 `deleteMany`/`updateMany` 라 두 번 돌려도 결과가 같다(이미 지운 건 0건으로 끝난다).
 *  - 조직 공유 데이터(브랜드·측정·리포트)와 결제·계약 기록은 **건드리지 않는다**.
 *  - 혼자 쓰던 조직은 지우지 않고 id 만 돌려준다(대표 결정 필요 — 범위표 3-1).
 *  - 스키마 변경 없음.
 */

import type { database } from "@repo/database";

/** 무료 진단·리드 이메일을 바꿔 넣는 자리표시. `.invalid` 는 예약 최상위 도메인이라 실제로 배달되지 않는다. */
export const ERASED_EMAIL = "deleted-user@deleted.invalid";

/** 메일함 연결을 끊었다는 표시. 화면·초안 API 는 `connected` 가 아니면 연결 안 됨으로 본다. */
export const REVOKED_MAILBOX_STATUS = "revoked";

const TX_OPTIONS = { maxWait: 5000, timeout: 15_000 } as const;

export interface EraseDeletedUserResult {
  actionCompletionsUnlinked: number;
  annotationsUnlinked: number;
  auditJobEmailsErased: number;
  contentReviewEventsUnlinked: number;
  contentRevisionsUnlinked: number;
  leadEmailsErased: number;
  mailboxConnectionsRevoked: number;
  partnerApplicationsDeleted: number;
  /** 탈퇴자가 소유자이고 남은 구성원이 0명인 조직 id — 지우지 않았다(대표 결정 필요). */
  soleOwnerOrgIds: string[];
  /** 회원 행이 있었는가. false 면 이미 지웠거나 처음부터 적재되지 않은 회원. */
  userFound: boolean;
  usersDeleted: number;
}

type EraseClient = Pick<typeof database, "$transaction">;

export async function eraseDeletedUser(
  client: EraseClient,
  userId: string
): Promise<EraseDeletedUserResult> {
  if (!userId) {
    throw new Error("eraseDeletedUser: userId 가 비어 있다");
  }
  return await client.$transaction(async (tx) => {
    // 이메일은 지우기 **전에** 읽는다 — 무료 진단 기록에서 같은 이메일을 찾는 열쇠다.
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const email = user?.email?.trim() ?? "";

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

    // 조직 기록의 작성자 표시만 비운다(내용은 조직 것).
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

    // 무료 진단을 직접 신청했던 회원이면 그 이메일도 지운다(측정 결과·집계 수는 유지).
    let auditJobEmailsErased = 0;
    let leadEmailsErased = 0;
    if (email && email !== ERASED_EMAIL) {
      const emailWhere = {
        email: { equals: email, mode: "insensitive" as const },
      };
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

    // 읽기만 한다: 혼자 쓰던 조직은 대표 결정 전까지 지우지 않는다.
    const owned = await tx.organization.findMany({
      where: { ownerId: userId },
      select: { id: true, _count: { select: { users: true } } },
    });
    const soleOwnerOrgIds = owned
      .filter((org) => org._count.users === 0)
      .map((org) => org.id);

    return {
      userFound: user !== null,
      usersDeleted: usersDeleted.count,
      partnerApplicationsDeleted: partner.count,
      mailboxConnectionsRevoked: mailbox.count,
      actionCompletionsUnlinked: actionCompletions.count,
      annotationsUnlinked: annotations.count,
      contentReviewEventsUnlinked: reviewEvents.count,
      contentRevisionsUnlinked: revisions.count,
      auditJobEmailsErased,
      leadEmailsErased,
      soleOwnerOrgIds,
    };
  }, TX_OPTIONS);
}
