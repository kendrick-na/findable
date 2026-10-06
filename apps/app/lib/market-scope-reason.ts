import type { MarketScopeReasonCode } from "@repo/audit/market-scope";
import type { AppDictionary } from "@/lib/i18n";

type ReasonLabels = Pick<
  AppDictionary["brandForm"],
  | "scopeReasonBoth"
  | "scopeReasonDomesticIndustry"
  | "scopeReasonEnglishOnly"
  | "scopeReasonKoreaDomain"
  | "scopeReasonKoreanOnly"
>;

/**
 * 타깃 시장 추정 근거 문장 — `inferMarketScope` 의 `reasonCode` 를 사전 문장으로 바꾼다(2026-10-06).
 * 패키지의 `reason`(한국어 원문)을 화면에 그대로 내면 영어 화면에서도 한국어가 나온다.
 */
export function marketScopeReason(
  code: MarketScopeReasonCode,
  t: ReasonLabels
): string {
  const map: Record<MarketScopeReasonCode, string> = {
    korea_domain: t.scopeReasonKoreaDomain,
    domestic_industry: t.scopeReasonDomesticIndustry,
    korean_only: t.scopeReasonKoreanOnly,
    english_only: t.scopeReasonEnglishOnly,
    both: t.scopeReasonBoth,
  };
  return map[code];
}
