import { isFreeAuditPublicEnabled } from "@repo/audit/free-audit-public";

/**
 * www 의 공개 무료 진단 노출 여부 — **이 앱에서 플래그를 읽는 유일한 자리.**
 *
 * 판정 규칙(env `FREE_AUDIT_PUBLIC_ENABLED`, 기본 꺼짐)은
 * `@repo/audit/free-audit-public` 한 곳에 있다(앱 `apps/app` 도 같은 규칙을 쓴다).
 * 👤 CEO 결정(2026-10-07): 꺼져 있으면 `/audit` 폼·`POST /api/audit` 는 404,
 *   랜딩·요금제·사례·리포트·llms.txt·sitemap·robots 에서 무료 진단 동선을 숨긴다.
 */
export function freeAuditPublicEnabled(): boolean {
  return isFreeAuditPublicEnabled();
}

/** 요금제의 Free Audit 등급 이름(ko·en 공통 — 상품명이라 번역하지 않는다). */
const FREE_AUDIT_TIER = "Free Audit";
/** 상위 등급의 "Free Audit 모든 기능" 줄 — 숨기면 가리킬 대상이 없다. */
const INCLUDES_FREE_AUDIT = new Set([
  "Free Audit 모든 기능",
  "Everything in Free Audit",
]);
/** 요금제 FAQ 중 무료 진단 자체를 묻는 문항. */
const FREE_AUDIT_FAQ = new Set([
  "무료 진단은 정말 무료인가요?",
  "Is the free audit really free?",
]);

/**
 * 요금제 표에서 보일 등급. 꺼져 있으면 Free Audit 등급과 그걸 가리키는 줄을 뺀다.
 * ⚠️ 원본 데이터(`pricing/page.tsx` 의 `TIERS_*`)는 지우지 않는다 — 켜면 그대로 돌아온다.
 */
export function visiblePricingTiers<
  T extends { features: string[]; name: string },
>(tiers: T[], freeAuditPublic: boolean): T[] {
  if (freeAuditPublic) {
    return tiers;
  }
  return tiers
    .filter((tier) => tier.name !== FREE_AUDIT_TIER)
    .map((tier) => ({
      ...tier,
      features: tier.features.filter((f) => !INCLUDES_FREE_AUDIT.has(f)),
    }));
}

/** 요금제 FAQ. 꺼져 있으면 무료 진단 문항을 뺀다. */
export function visibleFaq<T extends { q: string }>(
  faq: T[],
  freeAuditPublic: boolean
): T[] {
  return freeAuditPublic
    ? faq
    : faq.filter((item) => !FREE_AUDIT_FAQ.has(item.q));
}
