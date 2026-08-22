/**
 * 포트원 V2 (PortOne V2) 결제 모듈
 *
 * 한 번 통합하면 토스·카카오·네이버·KG이니시스 등 여러 PG를 동시 운영.
 * 추천패키지 가입 시 PG 가입비·연회비 0원 (월 거래액 5,000만 원 미만 무료).
 *
 * 클라이언트 결제 위젯은 apps/web/.../checkout 라우트에서 SDK 사용,
 * 서버는 결제 검증·승인 처리를 HTTP fetch로 직접 호출.
 *
 * 환경변수:
 *   PORTONE_API_SECRET  — 포트원 V2 API 시크릿 (콘솔 → 상점 → API 키)
 *   NEXT_PUBLIC_PORTONE_STORE_ID — 포트원 V2 상점 ID (클라이언트 위젯용)
 *   NEXT_PUBLIC_PORTONE_CHANNEL_KEY — 채널 키 (결제 수단별, 클라이언트 위젯용)
 *
 * 참고:
 *   - V2 API: https://developers.portone.io/api/rest-v2
 *   - V2 Migration: V1 imp_ 키 → V2 store-/channel- 키 체계로 변경됨
 */
import "server-only";
import { z } from "zod";
import { keys } from "./keys";

const PORTONE_API_BASE = "https://api.portone.io";

/** 결제 단건 조회 응답 (V2 부분) */
const PaymentSchema = z.object({
  id: z.string(),
  storeId: z.string(),
  status: z.enum([
    "READY",
    "PENDING",
    "VIRTUAL_ACCOUNT_ISSUED",
    "PAID",
    "FAILED",
    "PARTIAL_CANCELLED",
    "CANCELLED",
  ]),
  amount: z.object({
    total: z.number(),
    paid: z.number().optional(),
    cancelled: z.number().optional(),
    currency: z.string(),
  }),
  orderName: z.string().optional(),
  method: z.unknown().optional(),
  channel: z
    .object({
      type: z.string(),
      pgProvider: z.string().optional(),
    })
    .optional(),
  paidAt: z.string().optional(),
  receiptUrl: z.string().optional(),
});

export type PortOnePayment = z.infer<typeof PaymentSchema>;

/**
 * 결제 단건 조회 — 결제 위젯이 redirect 한 후 서버에서 paymentId로 조회.
 * 응답의 amount.total 과 서버 기대 금액을 반드시 비교 검증할 것.
 */
export async function getPayment(paymentId: string): Promise<PortOnePayment> {
  const { PORTONE_API_SECRET } = keys();
  if (!PORTONE_API_SECRET) {
    throw new Error("PORTONE_API_SECRET is not configured");
  }

  const res = await fetch(
    `${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: {
        Authorization: `PortOne ${PORTONE_API_SECRET}`,
        "Content-Type": "application/json",
      },
      // 60초 timeout 권장 (포트원 V2 가이드)
      signal: AbortSignal.timeout(60_000),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `PortOne payment lookup failed: ${data.code ?? res.status} ${data.message ?? ""}`
    );
  }

  return PaymentSchema.parse(data);
}

/**
 * 가상계좌·예약결제 등 비동기 결제 사전 등록.
 * 즉시 결제(카드·간편결제)는 클라이언트 SDK requestPayment 호출 후 getPayment로 검증 충분.
 */
export async function preRegisterPayment(input: {
  paymentId: string;
  totalAmount: number;
  taxFreeAmount?: number;
  currency: string;
}): Promise<void> {
  const { PORTONE_API_SECRET } = keys();
  if (!PORTONE_API_SECRET) {
    throw new Error("PORTONE_API_SECRET is not configured");
  }

  const res = await fetch(
    `${PORTONE_API_BASE}/payments/${encodeURIComponent(input.paymentId)}/pre-register`,
    {
      method: "POST",
      headers: {
        Authorization: `PortOne ${PORTONE_API_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        totalAmount: input.totalAmount,
        taxFreeAmount: input.taxFreeAmount ?? 0,
        currency: input.currency,
      }),
      signal: AbortSignal.timeout(60_000),
    }
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      `PortOne pre-register failed: ${data.code ?? res.status} ${data.message ?? ""}`
    );
  }
}

/** 포트원이 활성화됐는지 (API Secret 존재 여부) */
export function isPortOneConfigured(): boolean {
  const { PORTONE_API_SECRET } = keys();
  return Boolean(PORTONE_API_SECRET);
}

// ──────────────────────────────────────────────────────────────────
// 정기결제(빌링키) — 2026-08-11 세션N-18
//
// 카카오페이 심사관 요청: *"사이트 내 정기결제 상품이 없으면 심사 진행이 어렵다"*
//   → 테스트 채널(CID `TCSUBSCRIP`)로 정기결제 상품·결제흐름을 실제로 구현한다.
//
// 흐름: 브라우저 `requestIssueBillingKey` (빌링키 발급)
//        → 서버가 빌링키로 첫 결제 `POST /payments/{paymentId}/billing-key`
//        → 이후 갱신은 결제 예약(`/payments/{id}/schedule`) — 라이브 전환 후 켠다.
//
// 🔴 **해지 시 예약 취소를 반드시 함께** 할 것(`DELETE /payment-schedules`).
//   빌링키만 지우고 예약을 남기면 포트원 리커버리가 계속 청구를 시도한다(무한 과금 사고).
//   → `cancelBillingKeySchedules()` 를 먼저 부르고 `deleteBillingKey()` 를 부른다.
// ──────────────────────────────────────────────────────────────────

/** 빌링키로 즉시 결제. 성공하면 결제된 실제 금액(KRW)을 돌려준다. */
export async function payWithBillingKey(input: {
  billingKey: string;
  channelKey: string;
  currency: string;
  customerEmail?: string;
  customerName: string;
  orderName: string;
  paymentId: string;
  totalAmount: number;
}): Promise<void> {
  const { PORTONE_API_SECRET } = keys();
  if (!PORTONE_API_SECRET) {
    throw new Error("PORTONE_API_SECRET is not configured");
  }

  const res = await fetch(
    `${PORTONE_API_BASE}/payments/${encodeURIComponent(input.paymentId)}/billing-key`,
    {
      method: "POST",
      headers: {
        Authorization: `PortOne ${PORTONE_API_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        billingKey: input.billingKey,
        channelKey: input.channelKey,
        orderName: input.orderName,
        customer: {
          fullName: input.customerName,
          email: input.customerEmail,
        },
        amount: { total: input.totalAmount },
        currency: input.currency,
      }),
      signal: AbortSignal.timeout(60_000),
    }
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      `PortOne billing-key payment failed: ${data.code ?? res.status} ${data.message ?? ""}`
    );
  }
}

/**
 * 다음 회차 결제를 **예약**한다(2회차 이후 자동 청구).
 *
 * 왜 필요한가: `payWithBillingKey` 는 **그 순간 1회**만 청구한다. 예약을 걸지 않으면
 *   "구독"이라 팔면서 2회차부터 청구가 없는 상태가 된다(표시와 실제가 다름).
 *
 * 🔴 **라이브 전환 전에는 호출하지 말 것.** 카카오페이 심사 회신(2026-08-11)에
 *   「2회차 이후 자동 청구는 라이브 채널키로 전환한 뒤 연결할 예정」이라고 고지했다.
 *   테스트 채널은 실제 청구가 없어 동작 검증도 안 된다.
 *   → 지금은 **정의만 해 두고 호출부를 연결하지 않는다**(승인 후 연결).
 *
 * ⚠️ `paymentId` 는 **매 회차 새 값**이어야 한다. 같은 값으로 두 번 예약하면
 *   포트원이 `PAYMENT_SCHEDULE_ALREADY_EXISTS` 로 거절한다.
 *
 * 근거(2026-08-12 공식 문서 확인): `POST /payments/{paymentId}/schedule`
 *   · https://developers.portone.io/api/rest-v2/payment.paymentSchedule
 */
export async function schedulePaymentWithBillingKey(input: {
  billingKey: string;
  channelKey: string;
  currency: string;
  customerEmail?: string;
  customerName: string;
  orderName: string;
  paymentId: string;
  /** 청구 시각. 과거 시각이면 포트원이 거절한다. */
  timeToPay: Date;
  totalAmount: number;
}): Promise<void> {
  const { PORTONE_API_SECRET } = keys();
  if (!PORTONE_API_SECRET) {
    throw new Error("PORTONE_API_SECRET is not configured");
  }

  const res = await fetch(
    `${PORTONE_API_BASE}/payments/${encodeURIComponent(input.paymentId)}/schedule`,
    {
      method: "POST",
      headers: {
        Authorization: `PortOne ${PORTONE_API_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payment: {
          billingKey: input.billingKey,
          channelKey: input.channelKey,
          orderName: input.orderName,
          customer: {
            fullName: input.customerName,
            email: input.customerEmail,
          },
          amount: { total: input.totalAmount },
          currency: input.currency,
        },
        timeToPay: input.timeToPay.toISOString(),
      }),
      signal: AbortSignal.timeout(60_000),
    }
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      `PortOne payment schedule failed: ${data.code ?? res.status} ${data.message ?? ""}`
    );
  }
}

/**
 * 이 빌링키에 걸린 **결제 예약을 전부 취소**한다(해지 1단계).
 * 🔴 빌링키 삭제보다 **먼저** 부를 것 — 순서가 바뀌면 남은 예약이 계속 청구를 시도한다.
 */
export async function cancelBillingKeySchedules(
  billingKey: string
): Promise<void> {
  const { PORTONE_API_SECRET } = keys();
  if (!PORTONE_API_SECRET) {
    throw new Error("PORTONE_API_SECRET is not configured");
  }

  const res = await fetch(`${PORTONE_API_BASE}/payment-schedules`, {
    method: "DELETE",
    headers: {
      Authorization: `PortOne ${PORTONE_API_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ billingKey }),
    signal: AbortSignal.timeout(60_000),
  });

  // 예약이 하나도 없으면 404/400 이 올 수 있다 — 해지 자체는 계속 진행해야 하므로 삼킨다.
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    // 취소할 예약이 없다는 뜻이면 정상으로 본다.
    if (data.type !== "PAYMENT_SCHEDULE_NOT_FOUND") {
      throw new Error(
        `PortOne schedule cancel failed: ${data.code ?? res.status} ${data.message ?? ""}`
      );
    }
  }
}

/** 빌링키 삭제(해지 2단계). 🔴 `cancelBillingKeySchedules` 이후에 부를 것. */
export async function deleteBillingKey(billingKey: string): Promise<void> {
  const { PORTONE_API_SECRET } = keys();
  if (!PORTONE_API_SECRET) {
    throw new Error("PORTONE_API_SECRET is not configured");
  }

  const res = await fetch(
    `${PORTONE_API_BASE}/billing-keys/${encodeURIComponent(billingKey)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `PortOne ${PORTONE_API_SECRET}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(60_000),
    }
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      `PortOne billing key delete failed: ${data.code ?? res.status} ${data.message ?? ""}`
    );
  }
}
