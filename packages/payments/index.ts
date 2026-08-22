import "server-only";
import Stripe from "stripe";
import { keys } from "./keys";

const { STRIPE_SECRET_KEY } = keys();

export const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2026-02-25.clover",
    })
  : undefined;

export type { Stripe } from "stripe";
// 정기결제 주기 계산(순수 함수 — 테스트로 고정됨).
export { addMonthsClamped, nextBillingDate } from "./billing-cycle";
// 결제 상품 카탈로그(순수 데이터 — 금액↔plan 서버 판정). 클라이언트에서 가격만
// 필요하면 서버 전용 index 대신 "@repo/payments/catalog" 서브패스를 직접 import.
export {
  amountForPlan,
  buildPaymentId,
  type CatalogEntry,
  PAYMENT_CATALOG,
  PAYMENT_ID_PREFIX,
  type PayablePlan,
  planForAmount,
  uidForPaymentId,
  userIdFromPaymentId,
} from "./catalog";
export {
  cancelBillingKeySchedules,
  deleteBillingKey,
  getPayment as getPortOnePayment,
  isPortOneConfigured,
  type PortOnePayment,
  payWithBillingKey,
  preRegisterPayment as preRegisterPortOnePayment,
  schedulePaymentWithBillingKey,
} from "./portone";
export {
  isPaidEvent,
  type PortOneWebhookBody,
  parseWebhookBody,
  verifyWebhookSignature,
  type WebhookHeaders,
} from "./webhook";
