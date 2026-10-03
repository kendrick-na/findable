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
  evidence?: unknown;
  guide?: unknown;
  how?: unknown;
  kind?: unknown;
  source?: unknown;
  title?: unknown;
  verification?: unknown;
  where?: unknown;
}

const PRINCETON_RE = /Princeton|프린스턴/i;
const TOP_RECOMMENDATION_REDDIT_RE = /reddit|레딧/i;
const TOP_RECOMMENDATION_FORTY_RE = /40(?:\.\d+)?\s*%/;
const TOP_RECOMMENDATION_SCOPE_RE = /모든|전체|업계|all\s|overall|across/i;
const TOP_RECOMMENDATION_PRINCETON_RE = /princeton|프린스턴/i;
const TOP_RECOMMENDATION_PERCENT_RE = /[+−-]?\s*\d+(?:\.\d+)?\s*%/;
const LEGACY_CAUSAL_CLAIM_RE =
  /AI가 인용하기 좋습니다|그대로 쓰는 것이 핵심|채택할 확률이 올라갑니다|인용하기 좋다는/i;
const LEGACY_NAVER_EXTRAPOLATION_RE =
  /(?:49\.3\s*%|272건)[\s\S]*(?:매주|주\s*1회)[\s\S]*(?:인용될 수|언급될 수|인용합니다|언급합니다)|(?:매주|주\s*1회)[\s\S]*(?:인용될 수|언급될 수|인용합니다|언급합니다)[\s\S]*(?:49\.3\s*%|272건)/i;
const LEGACY_NAVER_POSITIVE_SENTENCE_RE =
  /(?:49\.3\s*%|272건|매주|주\s*1회)[^\.\n]*(?:인용될 수|언급될 수|인용합니다|언급합니다)|(?:인용될 수|언급될 수|인용합니다|언급합니다)[^\.\n]*(?:49\.3\s*%|272건|매주|주\s*1회)/i;
const LEGACY_NAVER_POSITIVE_HOW_RE =
  /(?:매주|주\s*1회)[\s\S]{0,400}(?:절반\s*가까이|49\.3\s*%)[\s\S]{0,120}(?:인용|언급)[^—-]{0,20}[—-]\s*순위보다/i;
const LEGACY_CONTENT_FIX_TEMPLATE_RE =
  /(?:질문\s*마다[^.\n]{0,40}(?:페이지|문서)[^.\n]{0,20}(?:하나씩|한\s*개씩)|(?:제목|URL|주소)[^.\n]{0,20}(?:질문|질문 문구)[^.\n]{0,20}(?:그대로|복사)|(?:질문|질문 문구)[^.\n]{0,20}(?:제목|URL|주소)[^.\n]{0,20}(?:그대로|복사))/i;
const LEGACY_BING_PREREQUISITE_RE =
  /(?:필수|필요조건|안 잡히면[\s\S]*(?:나오기|노출)[\s\S]*(?:어렵|불가))/i;
const BING_RE = /Bing/i;
const CHATGPT_RE = /ChatGPT/i;
const LEGACY_LLMS_BAN_RE =
  /llms\.txt[\s\S]*(?:파일 만들기|밝힌 적이 없고)|(?:파일 만들기|밝힌 적이 없고)[\s\S]*llms\.txt/i;
const LEGACY_NEGATION_RE =
  /필요\s*없|(?:하지|지)\s*말|않(?:습니다|는다|음)?|아니(?:다|어서|지만)?|보장[^.\n]*(?:없|않)|근거[^.\n]*(?:없|않)/i;
const LEGACY_EFFECT_LAG_COPY: Record<string, string> = {
  "몇 주~몇 달. 글이 쌓여야 보입니다.":
    "게시 후 몇 주~몇 달. 실제 반영 시점과 변화는 같은 질문으로 확인하세요.",
  "몇 달. 가장 느리지만 오래 갑니다.":
    "외부 언급 후 몇 달 이상. 실제 반영 시점과 변화는 같은 질문으로 확인하세요.",
};

function actionText(action: StoredActionLike): string {
  return [
    action.title,
    action.source,
    action.evidence,
    action.how,
    action.verification,
    action.where,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function hasUnnegatedLegacySentence(
  text: string,
  legacyPattern: RegExp
): boolean {
  return text
    .split(/[\n.!?。！？]/)
    .some(
      (sentence) =>
        legacyPattern.test(sentence) && !LEGACY_NEGATION_RE.test(sentence)
    );
}

function projectStoredAction<T extends StoredActionLike>(action: T): T {
  if (!action.guide || typeof action.guide !== "object") {
    return action;
  }
  const guide = action.guide as Record<string, unknown>;
  if (
    typeof guide.effectLag !== "string" ||
    !LEGACY_EFFECT_LAG_COPY[guide.effectLag]
  ) {
    return action;
  }
  return {
    ...action,
    guide: {
      ...guide,
      effectLag: LEGACY_EFFECT_LAG_COPY[guide.effectLag],
    },
  } as T;
}

function isUnsupportedStoredAction(action: StoredActionLike): boolean {
  if (action.kind === "rank_strategy" || action.kind === "source_portfolio") {
    return true;
  }
  const text = actionText(action);
  if (LEGACY_CAUSAL_CLAIM_RE.test(text)) {
    return true;
  }
  if (
    action.kind === "naver_blog" &&
    LEGACY_NAVER_EXTRAPOLATION_RE.test(text) &&
    (hasUnnegatedLegacySentence(text, LEGACY_NAVER_POSITIVE_SENTENCE_RE) ||
      LEGACY_NAVER_POSITIVE_HOW_RE.test(text))
  ) {
    return true;
  }
  if (
    action.kind === "content_fix" &&
    LEGACY_CONTENT_FIX_TEMPLATE_RE.test(text) &&
    hasUnnegatedLegacySentence(text, LEGACY_CONTENT_FIX_TEMPLATE_RE)
  ) {
    return true;
  }
  if (
    action.kind === "bing_webmaster" &&
    BING_RE.test(text) &&
    CHATGPT_RE.test(text) &&
    LEGACY_BING_PREREQUISITE_RE.test(text)
  ) {
    return true;
  }
  if (action.kind === "avoid" && LEGACY_LLMS_BAN_RE.test(text)) {
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
  return actions
    .filter(
      (action) =>
        Boolean(action) &&
        typeof action === "object" &&
        !isUnsupportedStoredAction(action)
    )
    .map(projectStoredAction);
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
      TOP_RECOMMENDATION_REDDIT_RE.test(recommendation) &&
      TOP_RECOMMENDATION_FORTY_RE.test(recommendation) &&
      TOP_RECOMMENDATION_SCOPE_RE.test(recommendation);
    const unsupportedLift =
      TOP_RECOMMENDATION_PRINCETON_RE.test(recommendation) &&
      TOP_RECOMMENDATION_PERCENT_RE.test(recommendation);
    return !(industryRedditClaim || unsupportedLift);
  });
}
