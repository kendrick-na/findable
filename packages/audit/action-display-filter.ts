// 저장된 과거 geoActions 의 표시 시점 필터 (2026-10-03 AG-0).
//
// 처방 카드는 측정 때 `AuditJob.result.geoActions` 에 저장되고, 화면은 그 스냅샷을
// 다시 그린다. 그래서 `actions.ts` 를 고쳐도 과거 회차에는 근거 없는 카드가 남는다.
// 저장 데이터는 고치지 않고(읽기 전용) 화면에 나가기 직전에만 걸러낸다.
//
// 거르는 것 — 잘못 그린 카드는 문구만 고쳐서는 살릴 수 없어 통째로 뺀다.
//   ① `rank_strategy` — 논문 Table 2 의 SERP 출처 순위 효과를 AI 답변의 브랜드 언급
//     순위에 옮겨 쓴 카드(−30.3%·+2.5%·+115.1%).
//   ② `source_portfolio` — 2026-09-26 전 회차는 외부 URL 을 귀속 확인 없이 셌고,
//     그 뒤 회차는 외부 URL 을 뺀 집계로 「자사 100%」만 남았다. 어느 쪽도 저장된
//     값만으로 출처 비중을 다시 검증할 수 없다.
//   ③ 그 밖에 출처가 Princeton 논문 수치인 카드(예: 「실험 평균 +41%」 content_fix).
//     원 논문은 출처 웹페이지 가시성을 쟀다 — 브랜드 언급·매출 기대효과가 아니다.
//     「하지 마세요」(avoid)는 효과를 약속하지 않으므로 남긴다.

interface StoredActionLike {
  kind?: unknown;
  source?: unknown;
  title?: unknown;
}

const PRINCETON_RE = /Princeton|프린스턴/i;

function isUnsupportedStoredAction(action: StoredActionLike): boolean {
  if (action.kind === "rank_strategy" || action.kind === "source_portfolio") {
    return true;
  }
  if (action.kind === "avoid") {
    return false;
  }
  return typeof action.source === "string" && PRINCETON_RE.test(action.source);
}

/** 저장된 처방 목록에서 근거 없는 카드를 뺀다. 남는 카드는 같은 객체·같은 순서. */
export function filterStoredGeoActions<T extends StoredActionLike>(
  actions: readonly T[] | null | undefined
): T[] {
  if (!Array.isArray(actions)) {
    return [];
  }
  return actions.filter(
    (action) =>
      Boolean(action) &&
      typeof action === "object" &&
      !isUnsupportedStoredAction(action)
  );
}

/**
 * Legacy PDFs/results also carry a string-only recommendation projection.
 * It has no `kind`/`source`, so only remove the known unsupported claim shapes;
 * this is a containment filter, not a semantic proof of every recommendation.
 */
export function filterStoredTopRecommendations(
  recommendations: readonly unknown[] | null | undefined
): string[] {
  if (!Array.isArray(recommendations)) {
    return [];
  }
  return recommendations.filter((recommendation): recommendation is string => {
    if (typeof recommendation !== "string") {
      return false;
    }
    const industryRedditClaim =
      /reddit|레딧/i.test(recommendation) &&
      /40(?:\.\d+)?\s*%/.test(recommendation) &&
      /모든|전체|업계|all\s|overall|across/i.test(recommendation);
    const unsupportedLift =
      /princeton|프린스턴/i.test(recommendation) &&
      /[+−-]?\s*\d+(?:\.\d+)?\s*%/.test(recommendation);
    return !(industryRedditClaim || unsupportedLift);
  });
}
