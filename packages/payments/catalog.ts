/**
 * 결제 상품 카탈로그 — 서버 신뢰 원본(single source of truth).
 *
 * ⚠️ 금액→plan 매핑은 반드시 이 서버 카탈로그로 판정한다.
 *    클라이언트가 보낸 금액/plan 문자열을 그대로 믿으면 위변조로 상위 plan 을
 *    무료 취득할 수 있다(예: 99,000 결제 후 scale 요청). verify·webhook 둘 다
 *    "결제된 실제 금액"을 이 표와 대조해 plan 을 역산한다.
 *
 * 🔴 **표시가(세전) ≠ 청구가(VAT 포함)** — 2026-08-10 정정.
 *   D-003(2026-04-30) 가격 결정과 리서치 E 가 **"VAT 별도"** 로 확정했는데
 *   이 표는 세전가를 그대로 청구하고 있었다(= 부가세 10% 를 못 걷는 상태).
 *   listKrw  = 화면에 크게 쓰는 기준가(세전). 경쟁사(Profound $99 등) 정렬용 anchor.
 *   amountKrw = PG 에 실제로 청구하는 금액(VAT 포함). **결제창·영수증 금액이 이것이다.**
 *
 *   starter 99,000 → 108,900 · growth 390,000 → 429,000 · scale 990,000 → 1,089,000.
 *   enterprise 는 영업 계약(결제 위젯 대상 아님)이라 카탈로그에서 제외.
 *
 * ⚠️ 금액을 바꿀 땐 `planForAmount` 역산도 같이 본다. 웹훅은 **결제된 실제 금액**으로
 *    plan 을 되찾으므로, 표시가(세전)로 역산하면 결제해도 plan 이 안 켜진다.
 */

// packages/auth 의 Plan 과 동일 어휘. 순환 의존을 피하려 여기선 리터럴 유니온으로 둔다
// (payments 는 auth 를 import 하지 않는다). 값은 auth Plan 과 반드시 일치.
export type PayablePlan = "starter" | "growth" | "scale";

/** 부가가치세율. 부가가치세법 제30조 = 10%. */
export const VAT_RATE = 0.1;

/** 세전 기준가 → VAT 포함 청구가. 원 단위 절사(PG 는 정수 KRW 만 받는다). */
export function withVat(listKrw: number): number {
  return Math.floor(listKrw * (1 + VAT_RATE));
}

export interface CatalogEntry {
  /** PG 청구액(KRW, **VAT 포함**). 결제창·웹훅이 다루는 금액. */
  amountKrw: number;
  /** 화면 표시용 월 구독 기준가(KRW, **세전**). */
  listKrw: number;
  plan: PayablePlan;
}

export const PAYMENT_CATALOG: readonly CatalogEntry[] = [
  { plan: "starter", listKrw: 99_000, amountKrw: 108_900 },
  { plan: "growth", listKrw: 390_000, amountKrw: 429_000 },
  { plan: "scale", listKrw: 990_000, amountKrw: 1_089_000 },
] as const;

/**
 * 결제된 실제 금액(KRW, VAT 포함)으로 plan 을 역산. 표에 없는 금액이면 null(=부여 거부).
 * currency 는 호출부에서 KRW 임을 먼저 확인할 것.
 *
 * 🔒 **세전가로도 역산해 준다** — VAT 정정(2026-08-10) 이전에 결제된 건이 있다면
 *    그 금액은 세전가다. 표에 없다고 plan 을 거부하면 "돈은 냈는데 무료" 가 된다.
 *    (정정 시점 실결제 0건이라 현재는 해당 없음. 방어적으로만 남긴다.)
 */
export function planForAmount(amountKrw: number): PayablePlan | null {
  const entry = PAYMENT_CATALOG.find(
    (e) => e.amountKrw === amountKrw || e.listKrw === amountKrw
  );
  return entry ? entry.plan : null;
}

/** plan 의 청구 금액(KRW, VAT 포함). 클라이언트 금액과 대조·주문 생성 검증용. */
export function amountForPlan(plan: PayablePlan): number | null {
  const entry = PAYMENT_CATALOG.find((e) => e.plan === plan);
  return entry ? entry.amountKrw : null;
}

/** plan 의 표시 기준가(KRW, 세전). 요금제 화면이 크게 쓰는 숫자. */
export function listPriceForPlan(plan: PayablePlan): number | null {
  const entry = PAYMENT_CATALOG.find((e) => e.plan === plan);
  return entry ? entry.listKrw : null;
}

// ──────────────────────────────────────────────────────────────────
// paymentId 형식 — 단일 진실 (2026-08-07 세션N-10)
//
// 형식: `fdbl-<plan>-<clerk uid(user_ 제거)>-<base36 시각>`
// 이 규칙이 **두 곳에서 쓰인다**:
//   ① 발급 = apps/app/app/actions/billing/checkout.ts (결제 시작)
//   ② 해석 = 결제 웹훅 (세션이 없어 paymentId 에서 userId 를 되찾아야 한다)
// 형식을 한쪽만 바꾸면 웹훅이 조용히 사용자 매칭에 실패한다 → 여기 한 곳에 둔다.
// ──────────────────────────────────────────────────────────────────

export const PAYMENT_ID_PREFIX = "fdbl";

const CLERK_USER_PREFIX_RE = /^user_/;

/** Clerk userId(`user_xxx`) → paymentId 에 심을 uid 조각. */
export function uidForPaymentId(userId: string): string {
  return userId.replace(CLERK_USER_PREFIX_RE, "");
}

/** 결제 시작 시 서버가 만드는 paymentId. `now` 는 테스트 주입용. */
export function buildPaymentId(
  plan: PayablePlan,
  userId: string,
  now: number = Date.now()
): string {
  return `${PAYMENT_ID_PREFIX}-${plan}-${uidForPaymentId(userId)}-${now.toString(36)}`;
}

/**
 * paymentId → Clerk userId 복원(웹훅 전용).
 *
 * ⚠️ uid 자체에 `-` 가 들어갈 수 있으므로 **앞 2조각·뒤 1조각을 제외한 나머지 전부**를
 *   uid 로 본다(단순 `split("-")[2]` 는 uid 가 잘린다).
 * ⚠️ 이 값은 "누구 결제인지"의 힌트일 뿐 **권위가 아니다** — 금액 검증(planForAmount)과
 *   PortOne 단건 조회(PAID)를 반드시 함께 통과시킬 것.
 */
export function userIdFromPaymentId(paymentId: string): string | null {
  const parts = paymentId.split("-");
  // [fdbl, plan, ...uid, ts] → 최소 4조각
  if (parts.length < 4 || parts[0] !== PAYMENT_ID_PREFIX) {
    return null;
  }
  const uid = parts.slice(2, -1).join("-");
  return uid.length > 0 ? `user_${uid}` : null;
}
