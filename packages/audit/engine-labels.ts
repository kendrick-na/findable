/**
 * 엔진 표시 이름 — **실제로 무엇을 쟀는지** 그대로 부른다 (2026-09-29).
 *
 * 🔴 사실성 문제(코드 실측) + 👤 대표 결정(2026-09-29):
 *   · `naver` 는 네이버의 AI 답이 아니다. 예전엔 네이버 검색 API 결과를 **Findable 이
 *     HyperCLOVA 로 합성**한 「Cue: 재현」이었고, 네이버 Cue:·클로바X 가 2026-04-09
 *     서비스 종료하면서 합성을 폐지했다. 이제 **검색 결과에 브랜드·공식 도메인이
 *     나오는지**만 잰다 → 「네이버 검색 노출」.
 *     네이버가 직접 만든 AI 답은 `naver-briefing`(네이버 AI 브리핑) 하나뿐이다.
 *   · `daum` 은 AI 답이 아니라 카카오 다음 **검색 결과 조각**이다.
 *   · `chatgpt` 는 웹검색 도구 없이 호출한다(Letsur 일반 채팅) — 공개 JSON 5건에서
 *     성공 답변 18개 모두 출처 0건. 모델 지식만으로 답한 것이다.
 *   · `hyperclova` 는 기본 측정에서 뺐다(서비스 종료). 과거 회차 표시용 이름만 남긴다.
 *
 * ⚠️ 이 파일이 표시 이름의 유일한 출처다. 화면·PDF 가 각자 지도를 두면
 *   한쪽만 고쳐진다(이 저장소의 「이름 4개」 사고).
 * ⚠️ claude·gemini·perplexity 는 현재 운영 설정에서 검색 출처가 실제로 붙어 온다
 *   (같은 공개 JSON: 16/18·20/20·16/16) → 꼬리표를 달지 않는다. 설정 플래그
 *   (`FINDABLE_CLAUDE_WEB_SEARCH`·`FINDABLE_ENGINE_GROUNDING`)를 끄면 이 판단도 바꿔야 한다.
 */

import { isApiSearchEngineSetActive } from "@repo/ai/lib/engines/engine-set";

export const ENGINE_LABELS_KO: Readonly<Record<string, string>> = {
  chatgpt: "ChatGPT (웹검색 없음)",
  "chatgpt-web": "ChatGPT (웹)",
  claude: "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  google: "Google 검색(AI 개요)",
  hyperclova: "HyperCLOVA X (서비스 종료 전 이전 측정)",
  naver: "네이버 검색 노출",
  "naver-briefing": "네이버 AI 브리핑",
  daum: "다음 검색 노출",
};

export const ENGINE_LABELS_EN: Readonly<Record<string, string>> = {
  chatgpt: "ChatGPT (no web search)",
  "chatgpt-web": "ChatGPT (Web)",
  claude: "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  google: "Google Search (AI features)",
  hyperclova: "HyperCLOVA X (earlier run, before shutdown)",
  naver: "Naver search exposure",
  "naver-briefing": "Naver AI Briefing",
  daum: "Daum search exposure",
};

/**
 * 메인 엔진 세트 `api-search-v1`(FINDABLE_ENGINE_SET) 일 때의 표시 이름 — 🔴 대표 승인 대기 문구.
 *   chatgpt·gemini 만 바뀐다(웹검색·구글 검색 연동을 켜고 잰 값이라서). claude 는 원래도 검색을 붙여 불러 그대로다.
 *   플래그가 꺼져 있으면 이 표는 **읽히지 않는다**(기존 문구 불변).
 */
export const ENGINE_LABELS_API_SEARCH_KO: Readonly<Record<string, string>> = {
  chatgpt: "ChatGPT (웹검색)",
  gemini: "Gemini (구글 검색 연동)",
};

export const ENGINE_LABELS_API_SEARCH_EN: Readonly<Record<string, string>> = {
  chatgpt: "ChatGPT (web search)",
  gemini: "Gemini (Google Search grounding)",
};

/** 표시 문맥. `engineSet` 을 주면 그 값을, 안 주면 지금 프로세스의 플래그를 따른다(한 곳에서만 읽는다). */
export interface EngineLabelContext {
  engineSet?: string | null;
}

function apiSearchSetActive(context?: EngineLabelContext): boolean {
  return context && "engineSet" in context
    ? isApiSearchEngineSetActive(context.engineSet ?? "")
    : isApiSearchEngineSetActive();
}

export function engineDisplayName(
  engineId: string,
  isKo = true,
  context?: EngineLabelContext
): string {
  if (apiSearchSetActive(context)) {
    const set = (
      isKo ? ENGINE_LABELS_API_SEARCH_KO : ENGINE_LABELS_API_SEARCH_EN
    )[engineId];
    if (set) {
      return set;
    }
  }
  return (isKo ? ENGINE_LABELS_KO : ENGINE_LABELS_EN)[engineId] ?? engineId;
}

/** 표시 이름만으로 부족한 엔진의 한 줄 설명(범례용). */
const ENGINE_NOTES: Readonly<Record<string, readonly [string, string]>> = {
  chatgpt: [
    "ChatGPT는 웹검색 없이 모델 지식만으로 답했어요(출처 0건).",
    "ChatGPT answered from model knowledge without web search (0 sources).",
  ],
  hyperclova: [
    "HyperCLOVA X 줄은 서비스 종료 전 이전 측정의 원문이에요. 헤드라인·4칸·점수 계산에는 넣지 않았어요.",
    "HyperCLOVA X rows are raw answers from earlier runs before the service ended. They are excluded from the headline, the four boxes and the score.",
  ],
  naver: [
    "‘네이버 검색 노출’은 AI 답이 아니라 네이버 검색 결과에 우리 브랜드·공식 도메인이 나오는지 본 값이에요. 네이버가 직접 한 답이 아니에요 — 네이버의 실제 AI 답은 ‘네이버 AI 브리핑’뿐이에요. (이전 측정의 이 줄은 검색 결과를 Findable이 요약한 재현 답이었어요.)",
    "‘Naver search exposure’ checks whether Naver search results show your brand or domain — not an AI answer. Only ‘Naver AI Briefing’ is Naver's own AI. (In earlier runs this row was Findable's summary of search results.)",
  ],
  daum: [
    "‘다음 검색 노출’은 AI 답이 아니라 카카오 다음 검색 결과 조각이에요.",
    "‘Daum search exposure’ is Daum search snippets, not an AI answer.",
  ],
};

/** api-search-v1 세트에서 chatgpt 의 한 줄 설명 — 🔴 대표 승인 대기 문구(플래그 off 면 읽히지 않는다). */
const ENGINE_NOTES_API_SEARCH: Readonly<
  Record<string, readonly [string, string]>
> = {
  chatgpt: [
    "ChatGPT는 웹검색을 켜고, 소비자 화면과 비슷한 길이로 답하도록 맞춰 측정했어요.",
    "ChatGPT was measured with web search on, tuned to answer at a length similar to the consumer screen.",
  ],
};

export function engineNote(
  engineId: string,
  isKo = true,
  context?: EngineLabelContext
): string | null {
  const note =
    (apiSearchSetActive(context) ? ENGINE_NOTES_API_SEARCH[engineId] : null) ??
    ENGINE_NOTES[engineId];
  if (!note) {
    return null;
  }
  return isKo ? note[0] : note[1];
}
