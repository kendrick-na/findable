/**
 * SoV → 매출/트래픽 "번역" 추정 로직 v2 (2026-07-30 재설계).
 *
 * 배경: 지불의사 시뮬레이션에서 "SoV가 돈으로 번역 안 됨"이 최대 전환장벽으로 지목됐고,
 * v1(직접 클릭만 계산)은 사용자 실측 피드백대로 결과가 비현실적으로 낮았다
 * (대기업 프리셋조차 월 ₩336만). 원인: SEO 시대 체인(클릭→방문→전환)만 계산하고
 * AI 검색의 실제 가치 경로 2개(제로클릭 영향·노출 자체의 광고가치)를 누락.
 *
 * v2 = 3요소 합산 (2025-2026 실측 벤치마크 기반, 각 계수 출처 명시):
 *   C1 직접 유입 손실  = 노출 × 손실점유 × 클릭률 × AI방문전환율 × 객단가
 *      - 클릭률 8%: Pew Research 2025(AI 요약 노출 시 링크 클릭 8%),
 *        Hashmeta GEO ROI 벤치마크 8~22% 밴드의 하단.
 *      - AI방문전환율 5%: 일반 2%의 2.5배. Semrush 2025 "AI 방문자 가치 4.4배",
 *        Adobe Analytics 2026 "AI 유입 전환 +54%", Shopify RPV +37% 근거의 보수치.
 *   C2 제로클릭 영향 손실 = 노출 × 손실점유 × 영향률 × 영향전환율 × 객단가
 *      - 영향률 20%: Bain 2025(검색자 80%가 40%+의 검색에서 AI 요약 의존,
 *        검색의 ~60%가 클릭 없이 종료), Adobe(AI 사용자 73%가 1차 조사수단) 근거의 보수치.
 *      - 영향전환율 1%: 클릭 없이 다른 채널(매장·직접방문·지명검색)로 전환하는 비율.
 *   C3 광고 환산 가치(바닥값) = 노출 × 손실점유 × 클릭률 × 네이버 CPC 환산단가
 *      - 한국 마케터가 파워링크 지출과 직접 비교 가능한 프레임(Similarweb ABMV·
 *        "Citation Value" 방식). CPC 기본: 소규모 ₩300 / 중견 ₩500 / 대기업 ₩800
 *        (네이버 검색광고 통상 ₩100~1,000, 경쟁 키워드 ₩1,500+ 밴드의 보수 구간).
 *
 * 노출 프리셋 근거: 네이버 AI 브리핑=전체 질의의 27%(2026-07, 전자신문)·한국 ChatGPT
 * 3개월 사용률 54.5%(오픈서베이 2026) → 브랜드/카테고리 월 검색량의 ~25-35%가 AI 답변
 * 노출로 전환된다고 보고, 소규모 1만 / 중견 10만 / 대기업 100만 노출/월로 캘리브레이션.
 *
 * ⚠️ 원칙(feedback_no_fabricated_facts): 모든 값은 추정이며 가정을 명시하고
 * 범위(±40%)로 제공. UI는 반드시 "추정·가정 기반"과 출처를 표기할 것.
 * 헤드라인 숫자 = C1+C2(매출 손실). C3는 별도 병기(매출과 합산 금지 — 이중계상).
 */

// 유저가 실측값을 주면 대입, 없으면 보수적 기본값. 전부 "가정"으로 UI에 노출할 것.
export interface RevenueAssumptions {
  // AI 경유 방문의 전환율. 일반 2%의 2.5배(Semrush 4.4x·Adobe +54% 보수 반영).
  aiVisitorConversionRate: number;
  // AI 답변 노출 → 사이트 클릭 비율. Pew 8%(AI 요약 노출 시 링크 클릭).
  answerClickThroughRate: number;
  // 광고 환산용 클릭당 단가(원). 네이버 검색광고 밴드 기준.
  cpcKrw: number;
  // 영향받은 사람이 다른 채널(매장·직접방문·지명검색)로 전환하는 비율.
  influencedConversionRate: number;
  // 내 브랜드/카테고리 관련 월간 AI 답변 노출 수(추정).
  monthlyAiQueries: number;
  // 고객 1인당 매출(객단가).
  revenuePerConversion: number;
  // 클릭 없이 답변만 보고 구매 결정에 영향받는 비율(제로클릭). Bain·Adobe 근거 보수치.
  zeroClickInfluenceRate: number;
}

export const DEFAULT_ASSUMPTIONS: RevenueAssumptions = {
  monthlyAiQueries: 10_000,
  answerClickThroughRate: 0.08,
  aiVisitorConversionRate: 0.05,
  zeroClickInfluenceRate: 0.2,
  influencedConversionRate: 0.01,
  cpcKrw: 300,
  revenuePerConversion: 50_000,
};

// 브랜드 규모 프리셋 — 노출 수와 CPC를 함께 조정.
export type BrandSizeKey = "small" | "mid" | "large";

export const SIZE_PRESETS: Record<
  BrandSizeKey,
  {
    labelKo: string;
    labelEn: string;
    monthlyAiQueries: number;
    cpcKrw: number;
  }
> = {
  small: {
    labelKo: "소규모·로컬",
    labelEn: "Small / local",
    monthlyAiQueries: 10_000,
    cpcKrw: 300,
  },
  mid: {
    labelKo: "중소·중견",
    labelEn: "Mid-size",
    monthlyAiQueries: 100_000,
    cpcKrw: 500,
  },
  large: {
    labelKo: "대기업·글로벌",
    labelEn: "Enterprise / global",
    monthlyAiQueries: 1_000_000,
    cpcKrw: 800,
  },
};

/**
 * 측정 신호로 브랜드 규모 프리셋을 추정한다 (전수감사 2026-08-02 §A-1).
 *
 * 배경: 규모 디폴트가 "small" 하드코딩이라 SK하이닉스(8/8 엔진 인지·SoV 79)에도
 *   "₩63만/월" 같은 소상공인 숫자가 나왔다. 측정이 이미 가진 신호로 초기값을 고른다.
 *
 * 신호 해석: AI 엔진이 브랜드를 "학습으로 이미 안다"는 건 대중 인지도의 대리 지표다.
 *   - 전 엔진 인지 + SoV 절반 이상 → 대기업·글로벌
 *   - 과반 인지 또는 SoV 30 이상   → 중소·중견
 *   - 그 외                        → 소규모(보수적 기본 유지)
 * 사용자는 언제든 수동 변경 가능 — 이건 어디까지나 **초기값**이다.
 */
export function inferBrandSize(
  recognitionRate: number, // 인지 엔진 수 / 측정 성공 엔진 수 (0~1)
  sov: number // 0~100
): BrandSizeKey {
  if (recognitionRate >= 1 && sov >= 50) {
    return "large";
  }
  if (recognitionRate >= 0.6 || sov >= 30) {
    return "mid";
  }
  return "small";
}

export interface RevenueImpactEstimate {
  // C3: 이 노출을 검색광고로 사려면 드는 월 비용(바닥값). 매출과 합산 금지.
  adEquivalentKrwPerMonth: number;
  // 계산에 쓴 가정(UI 투명 표기용).
  assumptions: RevenueAssumptions;
  // C1: 직접 유입 손실(월, 원).
  directRevenuePerMonth: number;
  // C2: 제로클릭 영향 손실(월, 원).
  influenceRevenuePerMonth: number;
  missedRevenueHigh: number;
  // 불확실성 범위(±40%).
  missedRevenueLow: number;
  // 헤드라인: 놓치는 매출 추정(월, 원) = C1 + C2.
  missedRevenuePerMonth: number;
  // 매월 놓치는 것으로 추정되는 방문 세션 수(C1의 클릭분).
  missedSessionsPerMonth: number;
  // 목표 SoV까지 올렸을 때 회복 가능으로 추정되는 월 매출(C1+C2 기준).
  recoverableRevenuePerMonth: number;
  // 이 추정이 기댔던 목표 SoV.
  targetSov: number;
}

/**
 * 대시보드와 공개 리포트가 같은 회차를 서로 다른 규모로 환산하지 않도록 하는
 * 유입 추정의 단일 진입점이다.
 */
export function buildMeasurementImpact({
  appearanceRate,
  coverage,
}: {
  appearanceRate: number;
  coverage: { mentioned: number; total: number };
}): { estimate: RevenueImpactEstimate; sizeKey: BrandSizeKey } {
  const recognitionRate =
    coverage.total > 0 ? coverage.mentioned / coverage.total : 0;
  const sizeKey = inferBrandSize(recognitionRate, appearanceRate);
  const preset = SIZE_PRESETS[sizeKey];

  return {
    sizeKey,
    estimate: estimateRevenueImpact(appearanceRate, {
      ...DEFAULT_ASSUMPTIONS,
      monthlyAiQueries: preset.monthlyAiQueries,
      cpcKrw: preset.cpcKrw,
    }),
  };
}

// 범위 계수: 추정 불확실성(±40%)을 명시적으로 넓게. 과대약속 방지.
const UNCERTAINTY = 0.4;

// 점유 손실분(0~1)에 대한 월 매출 손실(C1+C2)·세션·광고환산 계산.
function lossForShare(share: number, a: RevenueAssumptions) {
  const exposures = a.monthlyAiQueries * share;
  const sessions = exposures * a.answerClickThroughRate;
  const direct = sessions * a.aiVisitorConversionRate * a.revenuePerConversion;
  const influence =
    exposures *
    a.zeroClickInfluenceRate *
    a.influencedConversionRate *
    a.revenuePerConversion;
  const adEquivalent = sessions * a.cpcKrw;
  return { sessions, direct, influence, adEquivalent };
}

/**
 * SoV(0~100)와 가정으로 "놓치는 매출" 추정.
 * @param sov 현재 SoV (0~100)
 * @param assumptions 유저 실측 or 기본 가정
 * @param targetSov 회복 시나리오 목표 SoV(기본 60). 이미 60 이상이면 현재+10%p.
 */
export function estimateRevenueImpact(
  sov: number,
  assumptions: RevenueAssumptions = DEFAULT_ASSUMPTIONS,
  targetSov = 60
): RevenueImpactEstimate {
  const clampedSov = Math.max(0, Math.min(100, sov));
  // SoV>60이어도 "+10%p 개선" 시나리오를 보여주되, 100%에서만 진짜 0.
  const clampedTarget = Math.min(
    100,
    Math.max(clampedSov + 10, Math.min(100, targetSov))
  );

  const lostShare = (100 - clampedSov) / 100;
  const lost = lossForShare(lostShare, assumptions);
  const missedRevenue = lost.direct + lost.influence;

  const recoverable = lossForShare(
    (clampedTarget - clampedSov) / 100,
    assumptions
  );

  return {
    missedSessionsPerMonth: Math.round(lost.sessions),
    directRevenuePerMonth: Math.round(lost.direct),
    influenceRevenuePerMonth: Math.round(lost.influence),
    adEquivalentKrwPerMonth: Math.round(lost.adEquivalent),
    missedRevenuePerMonth: Math.round(missedRevenue),
    missedRevenueLow: Math.round(missedRevenue * (1 - UNCERTAINTY)),
    missedRevenueHigh: Math.round(missedRevenue * (1 + UNCERTAINTY)),
    recoverableRevenuePerMonth: Math.round(
      recoverable.direct + recoverable.influence
    ),
    assumptions,
    targetSov: clampedTarget,
  };
}

// 원화 축약 표기(₩1.2천만 등). UI 공용.
export function formatKrwCompact(value: number): string {
  if (value >= 100_000_000) {
    return `₩${(value / 100_000_000).toFixed(1)}억`;
  }
  if (value >= 10_000_000) {
    return `₩${(value / 10_000_000).toFixed(1)}천만`;
  }
  if (value >= 10_000) {
    return `₩${Math.round(value / 10_000).toLocaleString()}만`;
  }
  return `₩${Math.round(value).toLocaleString()}`;
}
