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
