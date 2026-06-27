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
    },
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `PortOne payment lookup failed: ${data.code ?? res.status} ${data.message ?? ""}`,
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
    },
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      `PortOne pre-register failed: ${data.code ?? res.status} ${data.message ?? ""}`,
    );
  }
}

/** 포트원이 활성화됐는지 (API Secret 존재 여부) */
export function isPortOneConfigured(): boolean {
  const { PORTONE_API_SECRET } = keys();
  return Boolean(PORTONE_API_SECRET);
}
