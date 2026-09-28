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

export const ENGINE_LABELS_KO: Readonly<Record<string, string>> = {
  chatgpt: "ChatGPT (웹검색 없음)",
  "chatgpt-web": "ChatGPT (웹)",
  claude: "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  hyperclova: "HyperCLOVA X (이전 측정)",
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
  hyperclova: "HyperCLOVA X (earlier runs)",
  naver: "Naver search exposure",
  "naver-briefing": "Naver AI Briefing",
  daum: "Daum search exposure",
};

export function engineDisplayName(engineId: string, isKo = true): string {
  return (isKo ? ENGINE_LABELS_KO : ENGINE_LABELS_EN)[engineId] ?? engineId;
}

/** 표시 이름만으로 부족한 엔진의 한 줄 설명(범례용). */
const ENGINE_NOTES: Readonly<Record<string, readonly [string, string]>> = {
  chatgpt: [
    "ChatGPT는 웹검색 없이 모델 지식만으로 답했어요(출처 0건).",
    "ChatGPT answered from model knowledge without web search (0 sources).",
  ],
  hyperclova: [
    "HyperCLOVA X 줄은 서비스 종료 전 이전 측정에만 있어요(검색 없이 모델 지식으로 답함). 새 측정에서는 재지 않아요.",
    "HyperCLOVA X rows exist only in earlier runs (answered without search). New runs no longer measure it.",
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

export function engineNote(engineId: string, isKo = true): string | null {
  const note = ENGINE_NOTES[engineId];
  if (!note) {
    return null;
  }
  return isKo ? note[0] : note[1];
}
