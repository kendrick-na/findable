/**
 * Findable 요금제(plan) 모델 — 서버·클라이언트 공용.
 *
 * 저장 위치 = Clerk `user.publicMetadata.plan` (게이팅용 빠른 캐시).
 * 결제 연동 전이라 유료 전환은 Clerk 대시보드 > Users > Metadata > Public 에
 * `{ "plan": "growth" }` 처럼 수동 입력. 값이 없으면 "free" 로 폴백.
 *
 * ⚠️ 게이팅축 = 결제축. web pricing/checkout·DB Plan enum 과 동일 어휘를 쓴다
 *    (free/starter/growth/scale/enterprise). 과거 insider/pro 는 폐기.
 * ⚠️ 게이팅은 반드시 서버에서 plan 확인 후 데이터/기능을 반환할 것.
 *    클라이언트에서만 숨기면 우회 가능(=무료로 다 나오는 함정). 이 파일은 판단 기준만 제공.
 * ⚠️ 파트너(승인 파트너)의 접근권 진실은 DB PartnerApplication.status=approved.
 *    승인 시 plan="growth" 를 부여(캐시). "파트너 배지" 표시는 plan 과 별개(→ isPartnerPlan/배지 컴포넌트).
 */

// 코드에서 쓰는 plan 식별자. 저장값도 이 문자열. = DB Plan enum 과 일치.
export type Plan = "free" | "starter" | "growth" | "scale" | "enterprise";

export const PLANS: readonly Plan[] = [
  "free",
  "starter",
  "growth",
  "scale",
  "enterprise",
] as const;

// 권한 위계(높을수록 상위). 게이팅 비교에 사용.
const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  starter: 1,
  growth: 2,
  scale: 3,
  enterprise: 4,
};

export interface PlanMeta {
  // 짧은 설명(툴팁·요금제 표면).
  blurb: string;
  // 배지 라벨(UI 표기). 코드값(Plan)과 분리 → 라벨만 바꿔도 로직 무영향.
  label: string;
  // 배지 스타일 키. PlanBadge 가 이 키로 색을 고른다.
  tone: "neutral" | "accent" | "gradient" | "enterprise";
}

export const PLAN_META: Record<Plan, PlanMeta> = {
  free: {
    label: "Free",
    tone: "neutral",
    blurb: "AI 가시성 요약과 측정 이력을 확인할 수 있는 무료 플랜입니다.",
  },
  starter: {
    label: "Starter",
    tone: "accent",
    blurb:
      "1인 창업자·개인 브랜드를 위한 진입 유료 플랜입니다. 추적 프롬프트 30개.",
  },
  growth: {
    label: "Growth",
    tone: "gradient",
    blurb:
      "경쟁사 비교·자동 추적·리포트 Export가 열리는 성장 플랜입니다. 추적 프롬프트 150개·5 브랜드.",
  },
  scale: {
    label: "Scale",
    tone: "gradient",
    blurb: "추적 500개·무제한 브랜드·API까지 열리는 미드마켓 플랜입니다.",
  },
  enterprise: {
    label: "Enterprise",
    tone: "enterprise",
    blurb: "전담 매니저·API·SSO·맞춤 SLA가 포함된 대기업 플랜입니다.",
  },
};

// 임의 값을 안전하게 Plan 으로 좁힌다. 모르면 free.
export function normalizePlan(value: unknown): Plan {
  return typeof value === "string" &&
    (PLANS as readonly string[]).includes(value)
    ? (value as Plan)
    : "free";
}

// Clerk publicMetadata 에서 plan 추출. metadata 형태가 뭐든 안전.
export function planFromPublicMetadata(
  metadata: Record<string, unknown> | null | undefined
): Plan {
  return normalizePlan(metadata?.plan);
}

// current 플랜이 required 이상인가(게이팅 판정). 예: hasPlan(plan, "growth").
export function hasPlan(current: Plan, required: Plan): boolean {
  return PLAN_RANK[current] >= PLAN_RANK[required];
}

// ──────────────────────────────────────────────────
// 플랜 능력치(게이팅 단일 진실) — 2026-07-30 백로그 2·7.
//
// 업계 화폐 = "추적 프롬프트 수"(Peec 25/100/300식). PLAN_META blurb 에 이미
//   노출된 숫자(starter 30·growth 150·scale 500)를 코드가 강제하는 자리.
//   무료는 온보딩 체감용 소수(5)만. 자동 갱신 주기도 여기서 결정(free=수동만).
//
// ⚠️ 게이팅은 서버에서만 판정(plan.ts 는 기준만 제공). 프롬프트 저장·자동 갱신 cron 이
//    이 표를 읽어 강제한다. 클라 힌트로만 쓰면 우회 가능.
// ──────────────────────────────────────────────────

// 자동 재측정 주기(시간). null = 자동 갱신 없음(수동 버튼만).
type RefreshHours = number | null;

export interface PlanCapabilities {
  // 자동 재측정 주기(시간). null 이면 수동 측정만(무료).
  autoRefreshHours: RefreshHours;
  // 등록 가능한 브랜드 수. Infinity = 무제한.
  brandLimit: number;
  // 마법사로 저장 가능한 추적 프롬프트 상한.
  promptLimit: number;
}

// blurb 의 약속과 동일 어휘. 바꿀 땐 PLAN_META blurb 도 함께.
const PLAN_CAPABILITIES: Record<Plan, PlanCapabilities> = {
  free: { promptLimit: 5, brandLimit: 1, autoRefreshHours: null },
  starter: { promptLimit: 30, brandLimit: 3, autoRefreshHours: 168 }, // 주간
  growth: { promptLimit: 150, brandLimit: 5, autoRefreshHours: 24 }, // 데일리
  scale: {
    promptLimit: 500,
    brandLimit: Number.POSITIVE_INFINITY,
    autoRefreshHours: 24,
  },
  enterprise: {
    promptLimit: 2000,
    brandLimit: Number.POSITIVE_INFINITY,
    autoRefreshHours: 24,
  },
};

/** 플랜 능력치(프롬프트·브랜드 상한·자동 갱신 주기). 게이팅의 단일 진실. */
export function planCapabilities(plan: Plan): PlanCapabilities {
  return PLAN_CAPABILITIES[plan];
}

// 심화 기능(경쟁사 비교·자동 추적·Export) 접근권 = Growth 이상. 잠금 판정 단축용.
// (과거 isPaid=pro 이상 → 결제축 통일로 growth 로 정렬.)
export function isPaid(plan: Plan): boolean {
  return hasPlan(plan, "growth");
}

// ──────────────────────────────────────────────────
// 파트너 승인 상태 (표기 타입) — 진실은 DB PartnerApplication.status.
// 승인 시 plan="growth" 부여(캐시). "파트너인지"는 DB status 로 판정.
// ──────────────────────────────────────────────────

// none = 신청 전. 나머지는 DB status 와 1:1.
export type PartnerStatus = "none" | "pending" | "approved" | "rejected";

// 파트너 접근권이 이미 있는가(신청 버튼 노출 판정용). Growth 이상이면 신청 불필요
// (승인 파트너는 growth 를 받으므로 자동 제외).
export function hasPartnerAccess(plan: Plan): boolean {
  return hasPlan(plan, "growth");
}
