/**
 * 엔진 표시 이름 — **실제로 무엇을 쟀는지** 그대로 부른다 (2026-09-29).
 *
 * 🔴 사실성 문제(코드 실측):
 *   · `naver` 는 네이버의 AI 답이 아니다. 네이버 검색 API(블로그·뉴스·웹문서·지식iN)
 *     결과를 **Findable 이 HyperCLOVA 로 요약해 재현**한 답이다
 *     (`packages/ai/lib/engines/korean-adapters.ts` — "Cue: 답변 합성").
 *     「Naver」라고만 쓰면 고객은 「네이버가 우리를 이렇게 말했다」로 읽는다.
 *     네이버가 직접 만든 AI 답은 `naver-briefing`(네이버 AI 브리핑) 하나뿐이다.
 *   · `daum` 은 AI 답이 아니라 카카오 다음 **검색 결과 조각**이다.
 *   · `chatgpt` 는 웹검색 도구 없이 호출한다(Letsur 일반 채팅) — 공개 JSON 5건에서
 *     성공 답변 18개 모두 출처 0건. 모델 지식만으로 답한 것이다.
 *   · `hyperclova` 도 검색 없이 모델 지식으로 답한다(CLOVA Studio 채팅 API).
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
  hyperclova: "HyperCLOVA X (검색 없음)",
  naver: "네이버 검색 기반 요약 (Findable 재현)",
  "naver-briefing": "네이버 AI 브리핑",
  daum: "다음 검색 노출",
};

export const ENGINE_LABELS_EN: Readonly<Record<string, string>> = {
  chatgpt: "ChatGPT (no web search)",
  "chatgpt-web": "ChatGPT (Web)",
  claude: "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  hyperclova: "HyperCLOVA X (no search)",
  naver: "Naver search summary (reproduced by Findable)",
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
    "HyperCLOVA X도 검색 없이 모델 지식만으로 답했어요.",
    "HyperCLOVA X also answered from model knowledge without search.",
  ],
  naver: [
    "‘네이버 검색 기반 요약’은 네이버 검색 결과를 Findable이 HyperCLOVA로 요약해 재현한 답이에요. 네이버가 직접 한 답이 아니에요 — 네이버의 실제 AI 답은 ‘네이버 AI 브리핑’뿐이에요.",
    "‘Naver search summary’ is Findable's reproduction: Naver search results summarized with HyperCLOVA. It is not Naver's own answer — only ‘Naver AI Briefing’ is.",
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
