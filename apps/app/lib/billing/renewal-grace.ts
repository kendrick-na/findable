/**
 * 갱신 결제 실패 유예 만료 — auto-refresh cron 이 매 실행마다 호출한다(2026-10-05).
 *
 * 흐름:
 *   1) 결제 웹훅이 `Transaction.Failed`(예약된 갱신 회차)를 받으면 조직을
 *      `billingStatus = past_due` 로 표시한다. 권한은 그대로 둔다(유예).
 *   2) 실패한 회차의 청구 예정 시각(`billingNextPaymentAt`) + RENEWAL_FAILURE_GRACE_DAYS 가
 *      지나면 여기서 회수한다.
 *
 * 왜 Clerk 를 내리나: 결제 권한은 `Organization.plan` 에 쓰이지 않는다. 결제 경로는
 *   Clerk `publicMetadata.plan` + 비공개 결제 출처(findablePaymentId)만 쓰고,
 *   `resolveEffectivePlan` 은 결제 출처가 있으면 Clerk plan 을 그대로 인정한다.
 *   그래서 `planExpiresAt` 만 바꿔서는 결제 권한이 내려가지 않는다(초대 기간까지 망가진다).
 *   → Clerk 결제 출처를 지우고, DB 는 `billingStatus = expired` 로 닫는다.
 *
 * 부분 실패: Clerk push 가 실패하면 DB 를 past_due 로 남겨 다음 cron(30분 뒤)이 다시 시도한다.
 * 멱등: DB 갱신은 past_due + 같은 회차 ID 조건부라 중복 실행돼도 한 번만 닫힌다.
 */

import { expirePaymentGrants } from "@repo/auth/plan-grant";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import {
  nextBillingDate,
  paymentIssuedAtFromPaymentId,
  renewalGraceCutoff,
  userIdFromPaymentId,
} from "@repo/payments";

/** 한 번의 cron 실행에서 처리할 최대 조직 수(Clerk 호출 한도 보호). */
const MAX_EXPIRIES_PER_RUN = 20;

/** 이보다 먼 미래 시각이 심긴 결제 출처는 위변조로 본다(정상 회차는 결제 시각 ≈ ID 시각). */
const FUTURE_ISSUED_TOLERANCE_MS = 60 * 60 * 1000;

/**
 * 이 결제가 대가를 치른 한 달 이용 기간이 `now` 까지 끝났는가.
 *
 * 🔒 P1-1(2026-10-05): 결제 출처로 저장된 ID 의 시각을 읽을 수 없거나 먼 미래면 **끝난 것**으로 본다.
 *   예전엔 "판단 불가 → 끝나지 않음"이라, 브라우저가 고친 ID 로 받은 권한이 영구히 남았다.
 *   파트너·초대·관리자 권한은 결제 출처가 null 이라 이 함수에 오지 않는다(paymentGrantAfterExpiry).
 */
export function isPaidPeriodOver(paymentId: string, now: Date): boolean {
  const issuedAt = paymentIssuedAtFromPaymentId(paymentId);
  if (!issuedAt) {
    return true;
  }
  if (issuedAt.getTime() - now.getTime() > FUTURE_ISSUED_TOLERANCE_MS) {
    return true;
  }
  return nextBillingDate(issuedAt).getTime() <= now.getTime();
}

export async function expireLapsedRenewalGrants(
  now = new Date()
): Promise<{ expired: number; scanned: number; failed: number }> {
  const candidates = await database.organization.findMany({
    where: {
      billingStatus: "past_due",
      billingNextPaymentId: { not: null },
      billingNextPaymentAt: { lte: renewalGraceCutoff(now) },
    },
    orderBy: { billingNextPaymentAt: "asc" },
    select: { id: true, billingNextPaymentId: true },
    take: MAX_EXPIRIES_PER_RUN,
  });

  let expired = 0;
  let failed = 0;
  for (const org of candidates) {
    const failedPaymentId = org.billingNextPaymentId;
    if (!failedPaymentId) {
      continue;
    }
    try {
      const userId = userIdFromPaymentId(failedPaymentId);
      if (userId) {
        const result = await expirePaymentGrants(userId, (paymentId) =>
          isPaidPeriodOver(paymentId, now)
        );
        if (result.reason === "push_failed") {
          failed += 1;
          log.error("billing.renewal_grace.revoke_failed", {
            organizationId: org.id,
            paymentId: failedPaymentId,
          });
          continue;
        }
      }
      const closed = await database.organization.updateMany({
        where: {
          id: org.id,
          billingStatus: "past_due",
          billingNextPaymentId: failedPaymentId,
        },
        data: { billingStatus: "expired" },
      });
      expired += closed.count;
      log.info("billing.renewal_grace.expired", {
        organizationId: org.id,
        paymentId: failedPaymentId,
      });
    } catch (error) {
      failed += 1;
      log.error("billing.renewal_grace.expire_failed", {
        organizationId: org.id,
        paymentId: failedPaymentId,
        error: parseError(error),
      });
    }
  }
  return { expired, scanned: candidates.length, failed };
}
