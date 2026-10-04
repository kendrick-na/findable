/**
 * 결제 권한 기간 만료 — 해지한 구독과 1회 결제(2026-10-05 컨트롤타워 승인 정책).
 *
 * 왜: 결제 권한은 Clerk `publicMetadata.plan` + 비공개 결제 출처에만 있다. 출처가 남아 있으면
 *   `resolveEffectivePlan` 이 Clerk plan 을 그대로 인정하므로(화면·자동 측정 cron 모두),
 *   만료를 코드가 지우지 않으면 "영구 유료"가 된다.
 *
 * 정책:
 *   - 해지(`unsubscribe`): 이미 결제한 기간 끝(`billingNextPaymentAt`)까지 유지 → 그 뒤 만료.
 *     유예 없음. DB 는 갱신 실패 유예 만료와 같은 `billingStatus = "expired"` 로 닫는다
 *     (canceled = "기간 남은 해지", expired = "권한까지 회수됨" 으로 구분).
 *   - 1회 결제(`checkout.ts`): 결제 시각(paymentId) + 1개월(nextBillingDate) 뒤 만료.
 *     카탈로그·주문명이 "월 구독" 기준가라 한 달 이용권으로 본다.
 *   - 파트너·초대·관리자 권한은 결제 출처가 없으므로(grantPlan 이 비운다) 건드리지 않는다.
 *
 * 안전장치:
 *   - 한 실행에서 Clerk 쓰기는 단계별 MAX_EXPIRIES_PER_RUN 건까지.
 *   - Clerk 실패 ⇒ DB 를 그대로 두고 다음 cron(30분 뒤)이 재시도. 권한을 늘리는 경로는 없다.
 *   - 살아 있는 구독(active · 유예 중 past_due · 기간 남은 canceled)의 사용자는 1회 결제
 *     스윕에서 건너뛴다. 그 권한은 갱신·유예·해지 단계가 각자 관리한다.
 */

import { normalizePlan } from "@repo/auth/plan";
import {
  expirePaymentGrants,
  paymentGrantAfterExpiry,
} from "@repo/auth/plan-grant";
import { clerkClient } from "@repo/auth/server";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { userIdFromPaymentId } from "@repo/payments";
import { isPaidPeriodOver } from "./renewal-grace";

/** 단계별 한 실행 최대 처리 수(renewal grace 와 같은 값). */
const MAX_EXPIRIES_PER_RUN = 20;
/** Clerk getUserList 한 번에 묻는 사용자 수. */
const CLERK_USER_PAGE = 100;

interface ExpiryResult {
  expired: number;
  failed: number;
  scanned: number;
}

/** 해지 후 이미 결제한 기간이 끝난 조직의 결제 권한을 회수한다. */
export async function expireCancelledSubscriptions(
  now = new Date()
): Promise<ExpiryResult> {
  const candidates = await database.organization.findMany({
    where: {
      billingStatus: "canceled",
      billingLastPaymentId: { not: null },
      billingNextPaymentAt: { lte: now },
    },
    orderBy: { billingNextPaymentAt: "asc" },
    select: {
      id: true,
      billingLastPaymentId: true,
      billingNextPaymentAt: true,
    },
    take: MAX_EXPIRIES_PER_RUN,
  });

  let expired = 0;
  let failed = 0;
  for (const org of candidates) {
    const lastPaymentId = org.billingLastPaymentId;
    const periodEnd = org.billingNextPaymentAt;
    if (!(lastPaymentId && periodEnd)) {
      continue;
    }
    try {
      const userId = userIdFromPaymentId(lastPaymentId);
      if (userId) {
        const result = await expirePaymentGrants(userId, (paymentId) =>
          isPaidPeriodOver(paymentId, now)
        );
        if (result.reason === "push_failed") {
          failed += 1;
          log.error("billing.period_end.cancelled_revoke_failed", {
            organizationId: org.id,
            paymentId: lastPaymentId,
          });
          continue;
        }
      }
      const closed = await database.organization.updateMany({
        where: {
          id: org.id,
          billingStatus: "canceled",
          billingLastPaymentId: lastPaymentId,
          billingNextPaymentAt: periodEnd,
        },
        data: { billingStatus: "expired" },
      });
      expired += closed.count;
      log.info("billing.period_end.cancelled_expired", {
        organizationId: org.id,
        paymentId: lastPaymentId,
      });
    } catch (error) {
      failed += 1;
      log.error("billing.period_end.cancelled_expire_failed", {
        organizationId: org.id,
        paymentId: lastPaymentId,
        error: parseError(error),
      });
    }
  }
  return { expired, scanned: candidates.length, failed };
}

/** 구독 상태가 권한을 관리 중인 사용자(1회 결제 스윕에서 제외). */
async function loadSubscriptionManagedUsers(now: Date): Promise<Set<string>> {
  const orgs = await database.organization.findMany({
    where: {
      OR: [
        { billingStatus: "active" },
        { billingStatus: "past_due", billingNextPaymentId: { not: null } },
        { billingStatus: "canceled", billingNextPaymentAt: { gt: now } },
      ],
    },
    select: {
      ownerId: true,
      billingLastPaymentId: true,
      users: { select: { id: true } },
    },
  });
  const managed = new Set<string>();
  for (const org of orgs) {
    managed.add(org.ownerId);
    for (const user of org.users) {
      managed.add(user.id);
    }
    const subscriber = org.billingLastPaymentId
      ? userIdFromPaymentId(org.billingLastPaymentId)
      : null;
    if (subscriber) {
      managed.add(subscriber);
    }
  }
  return managed;
}

/**
 * 1회 결제(및 구독 기록이 지워진 예전 해지)의 결제 권한 중 1개월이 지난 것을 회수한다.
 * DB 에 1회 결제 기록이 없으므로 DB 사용자 → Clerk 결제 출처를 훑어 대상을 찾는다.
 */
export async function expireOneOffPaymentGrants(
  now = new Date()
): Promise<ExpiryResult> {
  const isExpired = (paymentId: string) => isPaidPeriodOver(paymentId, now);
  const managed = await loadSubscriptionManagedUsers(now);
  const users = await database.user.findMany({
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const userIds = users.map((u) => u.id).filter((id) => !managed.has(id));

  const targets: string[] = [];
  try {
    const clerk = await clerkClient();
    for (
      let i = 0;
      i < userIds.length && targets.length < MAX_EXPIRIES_PER_RUN;
      i += CLERK_USER_PAGE
    ) {
      const chunk = userIds.slice(i, i + CLERK_USER_PAGE);
      const page = await clerk.users.getUserList({
        userId: chunk,
        limit: CLERK_USER_PAGE,
      });
      for (const user of page.data) {
        const privateMetadata = user.privateMetadata as Record<
          string,
          unknown
        > | null;
        const next = paymentGrantAfterExpiry(
          normalizePlan(user.publicMetadata?.plan),
          privateMetadata,
          isExpired
        );
        if (next.expired && targets.length < MAX_EXPIRIES_PER_RUN) {
          targets.push(user.id);
        }
      }
    }
  } catch (error) {
    log.error("billing.period_end.one_off_scan_failed", {
      users: userIds.length,
      error: parseError(error),
    });
    return { expired: 0, scanned: userIds.length, failed: 1 };
  }

  let expired = 0;
  let failed = 0;
  for (const userId of targets) {
    // expirePaymentGrants 가 최신 Clerk 값을 다시 읽어 판정한다(목록 이후 결제 반영).
    const result = await expirePaymentGrants(userId, isExpired);
    if (result.reason === "push_failed") {
      failed += 1;
      log.error("billing.period_end.one_off_revoke_failed", { userId });
      continue;
    }
    if (result.expired) {
      expired += 1;
      log.info("billing.period_end.one_off_expired", { userId });
    }
  }
  return { expired, scanned: userIds.length, failed };
}
