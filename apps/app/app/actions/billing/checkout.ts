"use server";

import { grantPlan } from "@repo/auth/plan-grant";
import { auth, currentUser } from "@repo/auth/server";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import {
  amountForPlan,
  buildPaymentId,
  getPortOnePayment,
  isPortOneConfigured,
  PAYMENT_ID_PREFIX,
  type PayablePlan,
  planForAmount,
  uidForPaymentId,
} from "@repo/payments";

/**
 * 앱 내 결제(로그인 상태) — 결제→plan 자동 부여의 완결 지점 (투두 "payments 자동화", 2026-07-30).
 *
 * 배경: 기존 www /checkout 은 로그인 밖(데모)이라 결제자의 Clerk userId 를 알 수 없어
 *   verify 라우트가 plan 부여를 의도적으로 생략했다(결제↔plan 단절). 여기는 (authenticated)
 *   컨텍스트라 userId 가 세션에서 재도출되므로 검증 후 grantPlan 까지 안전하게 잇는다.
 *
 * 🔒 불변식:
 *   - plan 판정은 서버 카탈로그 역산(planForAmount)만 신뢰(클라 금액·plan 문자열 불신).
 *   - paymentId 에 세션 uid 를 심는다 → verify 때 세션과 대조해 "남의 결제 재사용(리플레이)" 차단.
 *   - grantPlan 은 멱등(같은 값 재기록 안전). push 실패는 granted=false 로 표면화.
 *
 * ⚠️ 현재 PortOne 채널 = 토스 테스트 채널(실과금 아님). 실결제 전 라이브 채널 키 교체 필요.
 * ⚠️ 구독 자동 갱신(빌링키/정기결제)은 아직 아님 — 단건 결제 기준. 갱신은 후속 과제.
 */

// ⚠️ paymentId 형식(`fdbl-<plan>-<uid>-<ts>`)은 **@repo/payments/catalog 가 단일 진실**이다.
//   결제 웹훅이 세션 없이 이 형식에서 userId 를 되찾으므로, 여기서 따로 만들면 두 곳이 어긋난다
//   (세션N-10에서 공용화). 발급=buildPaymentId · 해석=userIdFromPaymentId.

export interface CheckoutIntent {
  amount: number;
  customerEmail?: string;
  customerName: string;
  orderName: string;
  paymentId: string;
}

export type CheckoutIntentResult =
  | ({ ok: true } & CheckoutIntent)
  | { error: string };

/**
 * 결제 시작 — 서버가 paymentId·금액·주문명을 확정해 클라이언트 위젯에 넘긴다.
 * (금액을 클라이언트가 정하지 않게 하는 지점.)
 */
export const createCheckoutIntent = async (
  plan: PayablePlan
): Promise<CheckoutIntentResult> => {
  const { userId } = await auth();
  if (!userId) {
    return { error: "로그인 후 이용해 주세요." };
  }

  const amount = amountForPlan(plan);
  if (!amount) {
    return { error: "결제할 수 없는 플랜입니다." };
  }

  if (!isPortOneConfigured()) {
    return {
      error: "결제 모듈이 아직 설정되지 않았습니다. 상담으로 문의해 주세요.",
    };
  }

  const user = await currentUser();
  const customerEmail = user?.emailAddresses?.[0]?.emailAddress;
  const customerName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    customerEmail ||
    "Findable 고객";

  // uid 를 심어 verify 때 세션 대조(리플레이 차단) + 웹훅이 세션 없이 사용자를 찾는 근거.
  const paymentId = buildPaymentId(plan, userId);

  return {
    ok: true,
    paymentId,
    amount,
    orderName: `Findable ${plan} 월 구독`,
    customerName,
    customerEmail,
  };
};

export type VerifyAndGrantResult =
  | { ok: true; plan: PayablePlan; granted: boolean }
  | { error: string };

/**
 * 결제 검증 + plan 부여 — 위젯 성공 후 호출.
 * PortOne 단건 조회로 PAID·KRW·카탈로그 금액을 검증하고, 실결제 금액으로 역산한 plan 을
 * 세션 userId 에 grantPlan(멱등). granted=false 면 결제는 유효하나 Clerk push 실패(재시도 안내).
 */
export const verifyPaymentAndGrant = async (
  paymentId: string
): Promise<VerifyAndGrantResult> => {
  const { userId } = await auth();
  if (!userId) {
    return { error: "로그인 후 이용해 주세요." };
  }

  // 리플레이 가드: 이 결제가 이 세션 사용자용으로 발급된 paymentId 인지.
  if (
    !(
      paymentId.startsWith(`${PAYMENT_ID_PREFIX}-`) &&
      paymentId.includes(uidForPaymentId(userId))
    )
  ) {
    log.warn("billing.verify.replay_blocked", { userId, paymentId });
    return { error: "이 계정의 결제가 아닙니다." };
  }

  try {
    const payment = await getPortOnePayment(paymentId);

    if (payment.status !== "PAID") {
      return { error: `결제가 완료되지 않았습니다. (상태: ${payment.status})` };
    }
    if (payment.amount.currency !== "KRW") {
      return {
        error: `지원하지 않는 통화입니다. (${payment.amount.currency})`,
      };
    }
    const plan = planForAmount(payment.amount.total);
    if (!plan) {
      log.error("billing.verify.amount_not_in_catalog", {
        paymentId,
        amount: payment.amount.total,
      });
      return {
        error: "결제 금액이 요금제와 일치하지 않습니다. 문의해 주세요.",
      };
    }

    const granted = await grantPlan(userId, plan);
    log.info("billing.verify.granted", {
      userId,
      paymentId,
      plan,
      amount: payment.amount.total,
      granted,
    });

    return { ok: true, plan, granted };
  } catch (error) {
    log.error("billing.verify.failed", {
      paymentId,
      error: parseError(error),
    });
    return { error: "결제 검증에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
};
