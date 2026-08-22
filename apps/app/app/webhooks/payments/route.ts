/**
 * PortOne V2 결제 웹훅 — 결제 완료 시 plan 자동 부여 (2026-08-07 세션N-10).
 *
 * 왜 필요한가(실제 손실 시나리오): 정상 흐름은 앱 안에서
 *   `verifyPaymentAndGrant`(actions/billing/checkout.ts)가 결제 직후 grantPlan 까지 끝낸다.
 *   그런데 **결제는 됐는데 그 호출이 실행되지 않는 경우**가 있다 —
 *   결제창에서 결제 후 브라우저를 닫음 · 리다이렉트 중 네트워크 끊김 · 앱 크래시.
 *   그러면 **고객은 돈을 냈는데 plan 이 free 로 남는다**(무료 티어 화면을 봄).
 *   웹훅은 브라우저와 무관하게 PortOne 서버가 직접 때리므로 이 구멍을 메운다.
 *
 * ⚠️ 이 파일은 원래 next-forge 템플릿의 **Stripe 보일러플레이트**였다
 *   (`checkout.session.completed`·`stripeCustomerId` 조회). Findable 은 PortOne 을 쓰므로
 *   실제로는 한 번도 동작한 적이 없는 죽은 코드였다 → PortOne 으로 교체.
 *
 * 🔒 보안·정합 불변식:
 *   1. **서명 검증**(Standard Webhooks, raw body) 통과 전엔 아무 것도 하지 않는다.
 *   2. plan 은 **PortOne 단건 조회 결과의 실결제 금액**으로 역산한다.
 *      웹훅 본문의 금액을 믿지 않는다(본문은 서명됐지만, 조회가 최종 진실).
 *   3. userId 는 paymentId 에 심긴 uid 에서 복원한다(세션이 없으므로).
 *      ⚠️ 이건 힌트일 뿐이라 **PAID + 카탈로그 금액 일치**를 함께 통과해야 부여한다.
 *   4. **멱등** — grantPlan 은 같은 값 재기록이 안전하다. PortOne 은 실패 시 재전송하므로
 *      같은 이벤트가 여러 번 와도 결과가 같아야 한다.
 *   5. 처리 실패라도 **재전송이 의미 없는 경우**(형식 오류 등)는 200 으로 닫는다.
 *      일시 장애(조회 실패 등)만 5xx 로 돌려 재전송을 유도한다.
 */

import { grantPlan } from "@repo/auth/plan-grant";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import {
  getPortOnePayment,
  isPaidEvent,
  parseWebhookBody,
  planForAmount,
  userIdFromPaymentId,
  verifyWebhookSignature,
} from "@repo/payments";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

/** 재전송해도 결과가 같은(=재시도 무의미) 종료. PortOne 이 재전송을 멈추도록 200. */
const done = (reason: string) => NextResponse.json({ ok: true, reason });

/** 일시 장애 — PortOne 이 재전송하도록 5xx. */
const retryable = (reason: string) =>
  NextResponse.json({ ok: false, reason }, { status: 500 });

export const POST = async (request: Request): Promise<Response> => {
  // 1) raw body — ⚠️ 반드시 text(). JSON.parse 후 재직렬화하면 서명이 깨진다.
  const rawBody = await request.text();
  const headerPayload = await headers();

  const verified = verifyWebhookSignature(rawBody, {
    id: headerPayload.get("webhook-id"),
    timestamp: headerPayload.get("webhook-timestamp"),
    signature: headerPayload.get("webhook-signature"),
  });
  if (!verified.ok) {
    // 시크릿 미설정은 운영 실수라 로그 레벨을 구분한다(위조 시도와 섞이면 안 됨).
    if (verified.reason === "webhook_secret_not_configured") {
      log.error("payments.webhook.not_configured");
      return done("not_configured");
    }
    log.warn("payments.webhook.invalid_signature", { reason: verified.reason });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = parseWebhookBody(rawBody);
  if (!body) {
    log.warn("payments.webhook.unparsable_body");
    return done("unparsable_body");
  }

  // 결제 완료 이벤트만 plan 을 올린다(가상계좌 발급·취소 등은 해당 없음).
  if (!isPaidEvent(body.type)) {
    log.info("payments.webhook.ignored_event", { type: body.type });
    return done(`ignored_event:${body.type}`);
  }

  const { paymentId } = body.data;
  const userId = userIdFromPaymentId(paymentId);
  if (!userId) {
    // 앱 밖(www 데모 체크아웃 등)에서 만든 결제는 uid 가 없다 → 부여 대상이 아니다.
    log.warn("payments.webhook.no_uid_in_payment_id", { paymentId });
    return done("no_uid_in_payment_id");
  }

  try {
    // 2) 최종 진실 = PortOne 단건 조회. 본문 금액을 믿지 않는다.
    const payment = await getPortOnePayment(paymentId);

    if (payment.status !== "PAID") {
      log.info("payments.webhook.not_paid", {
        paymentId,
        status: payment.status,
      });
      return done(`not_paid:${payment.status}`);
    }
    if (payment.amount.currency !== "KRW") {
      log.warn("payments.webhook.unsupported_currency", {
        paymentId,
        currency: payment.amount.currency,
      });
      return done("unsupported_currency");
    }

    const plan = planForAmount(payment.amount.total);
    if (!plan) {
      // 카탈로그에 없는 금액 = 위변조 또는 가격 변경 누락. 부여하지 않고 크게 남긴다.
      log.error("payments.webhook.amount_not_in_catalog", {
        paymentId,
        amount: payment.amount.total,
      });
      return done("amount_not_in_catalog");
    }

    // 3) 부여(멱등). 이미 verify 경로가 올렸어도 같은 값이라 안전하다.
    const granted = await grantPlan(userId, plan);
    if (!granted) {
      // Clerk push 실패 = 일시 장애일 수 있다 → 재전송으로 복구 기회를 준다.
      log.error("payments.webhook.grant_failed", { userId, paymentId, plan });
      return retryable("grant_failed");
    }

    log.info("payments.webhook.granted", {
      userId,
      paymentId,
      plan,
      amount: payment.amount.total,
    });
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    // 조회 실패 등 일시 장애 → 재전송 유도.
    log.error("payments.webhook.failed", {
      paymentId,
      error: parseError(error),
    });
    return retryable("lookup_failed");
  }
};
