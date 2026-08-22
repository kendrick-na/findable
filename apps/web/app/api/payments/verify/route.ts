/**
 * POST /api/payments/verify — 포트원 V2 결제 서버 검증
 *
 * 서버에서 포트원 API로 결제 단건 조회 → 금액 일치 + 상태 PAID 검증.
 * 이 검증 없이 결제 완료 처리하면 클라이언트 위변조 위험. 표준 패턴.
 *
 * ⚠️ 2026-08-03 현재 **앱 내 호출부 없음**(레거시). 유일한 호출부였던 www
 *   `/[locale]/checkout` 데모 페이지를 폐기했고, 실 결제 검증은 로그인 컨텍스트의
 *   서버액션 `apps/app/app/actions/billing/checkout.ts` 의 verifyPaymentAndGrant 가
 *   담당한다(세션 uid 대조 + grantPlan 까지 완결). 이 라우트는 plan 을 부여하지 않는다.
 *   과거 www 경로 결제 이력 확인(포트원 콘솔) 후 제거 예정 — 그때까지 유지.
 */
import {
  getPortOnePayment,
  isPortOneConfigured,
  planForAmount,
} from "@repo/payments";
import { NextResponse } from "next/server";
import { z } from "zod";

const RequestSchema = z.object({
  paymentId: z.string().min(1),
  expectedAmount: z.number().int().positive(),
});

export async function POST(request: Request) {
  if (!isPortOneConfigured()) {
    console.error("[payments/verify] PORTONE_API_SECRET not configured");
    return NextResponse.json(
      { ok: false, message: "PortOne is not configured (server)" },
      { status: 500 }
    );
  }

  let parsed: z.infer<typeof RequestSchema>;
  try {
    const body = await request.json();
    parsed = RequestSchema.parse(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.warn("[payments/verify] invalid body:", msg);
    return NextResponse.json(
      { ok: false, message: `Invalid request body: ${msg}` },
      { status: 400 }
    );
  }

  const { paymentId, expectedAmount } = parsed;

  try {
    const payment = await getPortOnePayment(paymentId);

    // 1) 상태 검증
    if (payment.status !== "PAID") {
      console.warn(
        `[payments/verify] not paid: ${paymentId} status=${payment.status}`
      );
      return NextResponse.json(
        {
          ok: false,
          message: `Payment not paid (status: ${payment.status})`,
        },
        { status: 400 }
      );
    }

    // 2) 금액 검증 (위변조 차단)
    if (payment.amount.total !== expectedAmount) {
      console.error(
        `[payments/verify] amount mismatch: ${paymentId} expected=${expectedAmount} got=${payment.amount.total}`
      );
      return NextResponse.json(
        {
          ok: false,
          message: `Amount mismatch: server expected ${expectedAmount}, got ${payment.amount.total}`,
        },
        { status: 400 }
      );
    }

    // 3) 서버 카탈로그로 plan 역산 (위변조 차단 2차 — 클라 금액이 아니라
    //    "실제 결제된 금액"을 서버 표와 대조). KRW 아니거나 표에 없는 금액이면 거부.
    if (payment.amount.currency !== "KRW") {
      console.error(
        `[payments/verify] non-KRW currency: ${paymentId} ${payment.amount.currency}`
      );
      return NextResponse.json(
        {
          ok: false,
          message: `Unsupported currency: ${payment.amount.currency}`,
        },
        { status: 400 }
      );
    }
    const plan = planForAmount(payment.amount.total);
    if (!plan) {
      console.error(
        `[payments/verify] amount not in catalog: ${paymentId} ${payment.amount.total}KRW`
      );
      return NextResponse.json(
        {
          ok: false,
          message: `Paid amount ${payment.amount.total} does not match any plan`,
        },
        { status: 400 }
      );
    }

    // ⚠️ plan 자동 부여(grantPlan)는 여기서 하지 않는다:
    //    이 라우트는 apps/web(로그인 없음)이라 결제자의 Clerk userId 를 알 수 없다.
    //    구독 SaaS 표준 = 로그인 상태 결제 + 웹훅 grant. 결제 흐름을 apps/app 으로
    //    이관하는 작업(투두 3번 후속)에서 grantPlan(userId, plan) 을 연결한다.
    //    현재는 "PAID + 서버 금액 대조 + plan 역산"까지 안전하게 확정해 반환만 한다.
    console.log(
      `[payments/verify] paid: ${paymentId} amount=${payment.amount.total}${payment.amount.currency} plan=${plan}`
    );

    return NextResponse.json({
      ok: true,
      paymentId: payment.id,
      amount: payment.amount.total,
      currency: payment.amount.currency,
      plan,
      paidAt: payment.paidAt,
      receiptUrl: payment.receiptUrl,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error(`[payments/verify] verify failed: ${paymentId} ${msg}`);
    return NextResponse.json(
      { ok: false, message: `Verify failed: ${msg}` },
      { status: 500 }
    );
  }
}
