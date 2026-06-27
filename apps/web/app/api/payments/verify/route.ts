/**
 * POST /api/payments/verify — 포트원 V2 결제 서버 검증
 *
 * 클라이언트 결제 위젯이 결제 완료 후 호출.
 * 서버에서 포트원 API로 결제 단건 조회 → 금액 일치 + 상태 PAID 검증.
 *
 * 이 검증 없이 결제 완료 처리하면 클라이언트 위변조 위험. 표준 패턴.
 */
import { getPortOnePayment, isPortOneConfigured } from "@repo/payments";
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

  let parsed;
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

    console.log(
      `[payments/verify] paid: ${paymentId} amount=${payment.amount.total}${payment.amount.currency}`
    );

    return NextResponse.json({
      ok: true,
      paymentId: payment.id,
      amount: payment.amount.total,
      currency: payment.amount.currency,
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
