/**
 * 결제 한 건이 대가를 치른 이용 기간 판정(순수 함수, 2026-10-05).
 *
 * 만료 cron 단계(renewal-grace · period-end-expiry)와 자동 측정 대상 선정
 * (auto-refresh-eligibility)이 같은 잣대를 쓰도록 여기 한 곳에 둔다.
 */

import {
  nextBillingDate,
  paymentIssuedAtFromPaymentId,
  renewalGraceEndsAt,
} from "@repo/payments";

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

/**
 * 이 조직에서 결제 권한이 아직 살아 있는가 — 결제 기간 안이거나, 갱신 실패 7일 유예 중.
 *
 * 유예: 웹훅이 갱신 실패를 받으면 `billingStatus = past_due` + 실패 회차 청구 예정 시각
 * (`billingNextPaymentAt`)을 남긴다. 그 시각 + RENEWAL_FAILURE_GRACE_DAYS 전까지는 직전 결제
 * 기간이 끝났어도 유료로 본다(만료 cron 이 출처를 지우는 시점과 같은 경계).
 */
export function isPaymentAccessActive(input: {
  billingNextPaymentAt: Date | null;
  billingStatus: string | null;
  now: Date;
  paymentId: string;
}): boolean {
  if (!isPaidPeriodOver(input.paymentId, input.now)) {
    return true;
  }
  return (
    input.billingStatus === "past_due" &&
    input.billingNextPaymentAt !== null &&
    renewalGraceEndsAt(input.billingNextPaymentAt).getTime() >
      input.now.getTime()
  );
}
