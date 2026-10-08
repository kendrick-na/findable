// 놓친 매출 기회(가정 기반) v2 (2026-10-05, 측정 알고리즘 v3 §2-⑥)
//
// v1(revenue-impact.ts)을 고치지 않고 새로 둔다 — v1 은 10/3 모든 화면에서 내렸고, 이유가
//   ① CTR 8% 오인용(AI 요약 안 출처 클릭은 1%) ② 월 노출수 임의 프리셋 ③ 100% 노출 대비 결손을
//   전부 손실로 셈 ④ 근거 없는 ±40% 였다. v2 는 **실측 입력이 없으면 숫자를 만들지 않는다.**
//
//   월 기회 = D × A × ΔS × CTR × CVR × AOV
//     D   월 검색 수요 — 네이버(+구글) 키워드 검색량 [실측 필수]
//     A   그 검색에 AI 답변이 뜨는 비율        13.1 / 20.5 / 24.9 %  (Ahrefs, 구글 기준)
//     ΔS  AI 답변 속 언급률 개선폭(목표 − 현재). 목표를 주지 않으면 +10/+20/+30%p [AI가설]
//     CTR AI 답변에서 사이트로 클릭             1 / 2.07 / 8 %   (Pew 2025, Seer 2026)
//     CVR 방문 → 구매 전환                     1.5 / 2.93 / 7 %  (고객 GA 값이 있으면 그 값)
//     AOV 객단가 — 공식몰 가격 중앙값 [실측 필수]
// 표기 원칙: 「놓친 매출 기회(가정 기반)」. 「확정 손실」이라고 쓰지 않는다.

export interface OpportunityInputs {
  /** 객단가(원). 공식몰 가격 중앙값 등 실측값. */
  averageOrderValue: number | null;
  /** 현재 언급률(0~1) — Findable 측정. */
  currentMentionRate: number;
  /** 고객이 준 전환율(0~1). 있으면 세 구간 모두 이 값. */
  customerConversionRate?: number | null;
  /** 월 검색 수요(건). 키워드 검색량 합. */
  monthlyDemand: number | null;
  /** 목표 언급률(0~1) — 예: 같은 질문에서 가장 많이 언급된 경쟁사. 없으면 개선폭 가정. */
  targetMentionRate?: number | null;
}

export interface OpportunityScenario {
  monthlyRevenue: number;
}

export interface Assumption {
  base: number;
  high: number;
  label: string;
  low: number;
  source: string;
}

export interface RevenueOpportunity {
  assumptions: Assumption[];
  base: OpportunityScenario;
  high: OpportunityScenario;
  low: OpportunityScenario;
}

export const OPPORTUNITY_ASSUMPTIONS = {
  aiAnswerShare: {
    label: "검색에 AI 답변이 뜨는 비율",
    low: 0.131,
    base: 0.205,
    high: 0.249,
    source:
      "Ahrefs 1.46억 SERP 분석(2025-09, 구글 기준 · 네이버 AI 브리핑 비율은 확인 필요) https://ahrefs.com/blog/ai-overview-triggers/",
  },
  clickThrough: {
    label: "AI 답변에서 사이트로 클릭",
    low: 0.01,
    base: 0.0207,
    high: 0.08,
    source:
      "Pew 2025(요약 안 링크 1%·아무 링크 8%) https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/ · Seer 2026(인용 브랜드 2.07%) https://www.seerinteractive.com/insights/aio-impact-on-google-ctr-2026-update",
  },
  conversion: {
    label: "방문 → 구매 전환",
    low: 0.015,
    base: 0.0293,
    high: 0.07,
    source:
      "국내 뷰티 2.93%(빅인사이트 2021) https://www.beautynury.com/news/view/95109/cat/10 · 높음 7%는 생성형 AI 유입 전환(Similarweb 2025, 원문 확인 필요) · 고객 GA 전환율이 있으면 대체",
  },
  mentionGain: {
    label: "AI 답변 속 언급률 개선폭(목표 미지정 시)",
    low: 0.1,
    base: 0.2,
    high: 0.3,
    source: "가정 — 목표(경쟁사 최고 언급률)를 넣으면 실측 차이로 대체",
  },
} as const;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 실측 수요(D)와 객단가(AOV)가 없으면 null — 숫자를 지어내지 않는다. */
export function estimateRevenueOpportunity(
  inputs: OpportunityInputs
): RevenueOpportunity | null {
  const { monthlyDemand, averageOrderValue } = inputs;
  if (
    !(
      monthlyDemand &&
      monthlyDemand > 0 &&
      averageOrderValue &&
      averageOrderValue > 0
    )
  ) {
    return null;
  }
  const current = clamp01(inputs.currentMentionRate);
  const a = OPPORTUNITY_ASSUMPTIONS;
  const gain = (level: "low" | "base" | "high") =>
    inputs.targetMentionRate == null
      ? Math.min(a.mentionGain[level], 1 - current)
      : Math.max(0, clamp01(inputs.targetMentionRate) - current);
  const cvr = (level: "low" | "base" | "high") =>
    inputs.customerConversionRate ?? a.conversion[level];
  const scenario = (level: "low" | "base" | "high"): OpportunityScenario => ({
    monthlyRevenue: Math.round(
      monthlyDemand *
        a.aiAnswerShare[level] *
        gain(level) *
        a.clickThrough[level] *
        cvr(level) *
        averageOrderValue
    ),
  });
  return {
    low: scenario("low"),
    base: scenario("base"),
    high: scenario("high"),
    assumptions: [
      a.aiAnswerShare,
      a.clickThrough,
      inputs.customerConversionRate == null
        ? a.conversion
        : {
            label: a.conversion.label,
            low: inputs.customerConversionRate,
            base: inputs.customerConversionRate,
            high: inputs.customerConversionRate,
            source: "고객 제공 전환율",
          },
      inputs.targetMentionRate == null
        ? a.mentionGain
        : {
            label: "AI 답변 속 언급률 개선폭(목표 − 현재)",
            low: gain("low"),
            base: gain("base"),
            high: gain("high"),
            source: "Findable 측정: 목표 언급률 − 현재 언급률",
          },
    ],
  };
}

// ── 헤드라인 v3 (2026-10-05 대표 승인) → v4 (2026-10-07 대표 확정 공식) ─────────────
// v3: 「AI 추천을 거치는 매출」 = 고객사 실제 연매출 × AI 관여 구매 비중 7%.
// v4(지금부터 모든 곳에서 이 공식): 「AI 추천에서 빠져서 놓치는 매출」
//   놓치는 매출 = 확인된 연매출 × 7% × (1 − 정확 노출률)
//   정확 노출률 = AI 답변 중 브랜드를 정확히 설명·추천한 비율(Findable 측정 ok_n / n).
// 위 D×A×ΔS×CTR×CVR×AOV 는 가정이 여섯 개라 「근거가 뭐냐」에 답하기 어려워, 고객사 자기 매출에서 출발한다.
// 🔴 연매출은 출처·연도가 붙은 확인값만 받는다(추정 금지). 없으면 null — 표지·메일의 돈 문장이 통째로 빠진다.
// 화면 단위: 큰 숫자는 연 단위(「연 약 3.8억 원」), 월은 작은 보조 글씨.

/** 한국 소비자 중 AI 쇼핑 도우미를 주로 쓰는 비율 — 크리테오 2026 뷰티 쇼퍼 조사. */
export const AI_INVOLVED_PURCHASE_SHARE = 0.07;
export const AI_INVOLVED_PURCHASE_SOURCE =
  "크리테오 「5 beauty shopper trends 2026」 — 한국 소비자 7%가 AI 쇼핑 도우미를 주로 사용 https://www.criteo.com/blog/5-beauty-shopper-trends-2026/";

export interface ConfirmedRevenue {
  /** 연매출(원). */
  annual: number;
  /** 예: "NICE평가정보(사람인 기업정보)". */
  source: string;
  /** 회계 연도. */
  year: number;
}

/** Findable 측정 — AI 답변 중 브랜드를 정확히 설명·추천한 건수 / 전체 답변 수. */
export interface MeasuredAccuracy {
  accurate: number;
  total: number;
}

/** 리포트 config.revenue_opportunity 와 같은 모양(저장값만 화면에 쓴다). */
export interface AiRoutedRevenue {
  /** 연매출 × 7% — AI 추천을 거치는 연 매출(원). */
  ai_routed_annual: number;
  ai_share_pct: number;
  annual_revenue: number;
  basis: string[];
  future: string;
  /** AI가 정확히 소개하지 못한 비율(%, 반올림). 측정값이 없으면 없음. */
  miss_pct?: number;
  /** 놓치는 매출(연, 원) = ai_routed_annual × (1 − 정확 노출률). */
  missed_annual?: number;
  /** 놓치는 매출(월, 원) = missed_annual ÷ 12. */
  missed_monthly?: number;
  /** AI 추천을 거치는 월 매출(원) — v3 호환. */
  monthly: number;
  revenue_source: string;
}

/** 1 − 정확 노출률. 측정이 없거나 이상하면 null. */
export function missRatio(
  accuracy: MeasuredAccuracy | null | undefined
): number | null {
  if (
    !(
      accuracy &&
      Number.isFinite(accuracy.total) &&
      Number.isFinite(accuracy.accurate)
    ) ||
    accuracy.total <= 0 ||
    accuracy.accurate < 0 ||
    accuracy.accurate > accuracy.total
  ) {
    return null;
  }
  return 1 - accuracy.accurate / accuracy.total;
}

export function aiRoutedRevenue(
  revenue: ConfirmedRevenue | null | undefined,
  accuracy?: MeasuredAccuracy | null
): AiRoutedRevenue | null {
  if (
    !(revenue && Number.isFinite(revenue.annual)) ||
    revenue.annual <= 0 ||
    !revenue.source.trim()
  ) {
    return null;
  }
  const aiRoutedAnnual = Math.round(
    revenue.annual * AI_INVOLVED_PURCHASE_SHARE
  );
  const miss = missRatio(accuracy);
  const missed =
    miss === null || !accuracy
      ? null
      : {
          miss_pct: Math.round(miss * 100),
          missed_annual: Math.round(aiRoutedAnnual * miss),
          missed_monthly: Math.round((aiRoutedAnnual * miss) / 12),
          basis: `AI가 정확히 소개하지 못한 비율 ${Math.round(miss * 100)}%: Findable 측정 — AI 답변 ${accuracy.total}건 중 ${accuracy.accurate}건만 브랜드를 정확히 설명·추천`,
        };
  return {
    annual_revenue: revenue.annual,
    revenue_source: `${revenue.source}, ${revenue.year}년`,
    ai_share_pct: Math.round(AI_INVOLVED_PURCHASE_SHARE * 100),
    ai_routed_annual: aiRoutedAnnual,
    monthly: Math.round((revenue.annual * AI_INVOLVED_PURCHASE_SHARE) / 12),
    ...(missed
      ? {
          miss_pct: missed.miss_pct,
          missed_annual: missed.missed_annual,
          missed_monthly: missed.missed_monthly,
        }
      : {}),
    basis: [
      `연매출: ${revenue.source} 공개 기업정보 ${revenue.year}년 값`,
      `AI가 관여하는 구매 비중 7%: ${AI_INVOLVED_PURCHASE_SOURCE}`,
      ...(missed ? [missed.basis] : []),
      "AI 답변에 출처로 인용된 브랜드는 클릭이 약 35% 더 많습니다 — Seer Interactive 2025-09 https://www.seerinteractive.com/insights/aio-impact-on-google-ctr-september-2025-update",
    ],
    future:
      "2030년에는 온라인 매출의 10~20%가 AI 에이전트를 거쳐 판매될 것이라는 전망도 있습니다(모건스탠리, 미국 기준 전망).",
  };
}
