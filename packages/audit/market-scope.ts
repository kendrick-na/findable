// 시장 스코프 — 엔진 권역 분리 + 타깃 시장 선언 (세션M, 2026-08-02)
//
// 발단(사용자 질문): "한국에서만/미국에서만이 아니라 **전체적으로 자사 브랜드의 GEO 파워**를
//   키우자는 것인데 어떻게 분류·해결·제시해야 하나?"
//   → 실측: 한국에서만 보이는 브랜드와 해외에서만 보이는 브랜드가 **5축 전부 동일 39점**.
//     통합 점수 하나가 정반대 두 현실을 평균 내 가리고 있었다.
//
// ⚠️ 분해 축 교정(중요): 최초 처방은 "프롬프트 언어(ko/en)로 분해"였으나 **무효**였다.
//   프롬프트는 언어와 무관하게 항상 7 엔진 전부에 나가므로 ko/en 슬라이스의 엔진 구성이
//   동일해 점수가 똑같이 나온다(실측 40/40/40). 실제 축은 **엔진 권역**이다(40→한국87·글로벌0).
//   → 새 데이터·스키마·태깅 불필요. engineId 는 이미 모든 응답에 있다.
//
// 📕 설계 근거 = docs/_적용/타깃시장선언_SEO선례_2026-08-02.md
//   업계(Semrush)는 시장을 "가중치"가 아니라 **점수의 분모**로 다룬다:
//     "Visibility % is based on ... keywords from the current tracking campaign"
//   → 선언하지 않은 시장은 분모에서 빠져 **0 이 산출될 수 없다**(감점이 아니라 비해당).
//   Ahrefs 는 국가별 지표 API 에서 DR(권위 점수)을 **아예 제외**한다 — 종합 점수의 국가 분해를
//   하지 않는다는 업계 합의.
//
// 핵심 원칙: **0 과 N/A 를 구분한다.**
//   0 = "측정했는데 실패", N/A = "우리 시장이 아님". 지금 제품은 N/A 를 0 으로 렌더링해
//   국내 전용 고객(병원·학원·국내 B2B)에게 "글로벌 0점" 공포를 주고 있었다.

import type { EngineId } from "@repo/ai/lib/engines";

/** 시장 권역. 엔진을 이 둘 중 하나로 가른다. */
export type MarketRegion = "korea" | "global";

/**
 * 고객이 선언한 타깃 시장.
 * - korea : 국내 전용(병원·학원·국내 B2B 등). 글로벌 엔진은 **분모에서 제외**.
 * - global: 해외 전용.
 * - both  : 양쪽 다 본다.
 */
export type MarketScope = "korea" | "global" | "both";

/**
 * 한국 엔진 — 한국어권 AI 답변/검색을 대표한다.
 * ⚠️ naver-briefing 은 on-demand 별도 트리거(본류 7엔진에 없음)지만 권역상 한국이다.
 */
const KOREA_ENGINES = new Set<string>([
  "hyperclova",
  "naver",
  "naver-briefing",
  "daum",
]);

/**
 * 엔진의 권역 판정. 모르는 엔진은 글로벌로 본다(글로벌 LLM 이 계속 늘어나는 쪽이라).
 *
 * ⚠️ **이 함수를 "국내/해외 시장" 분해에 쓰지 않는다**(2026-08-03/2026-08-21 정정).
 *   "국내 중심"을 이 기준으로 필터하면 한국인이 가장 많이 쓰는 ChatGPT 가 빠진다.
 *   시장 분해는 `promptLanguageRegion`(질의 언어)을 쓴다. 이 함수는 **엔진 자체를
 *   그룹핑해 보여주는 화면**(예: `sources-board.tsx`의 "AI별 등장·출처",
 *   `naver-vs-ai-gap.tsx`의 "네이버 검색 vs 글로벌 AI" — 둘 다 엔진 국적이 정확한 축)
 *   에서만 쓴다.
 */
export function engineRegion(engineId: EngineId | string): MarketRegion {
  return KOREA_ENGINES.has(engineId) ? "korea" : "global";
}

/**
 * 🔴 **시장(국내/해외) 분해는 이 함수로 한다**(2026-08-21, 언어축 재설계).
 *
 * 실측(2026-08-21, 라이브 Tracking 701건): "언급 여부"로 언어별 비교하면 유명
 * 브랜드는 ko/en 모두 90%대로 비슷해 판별력이 없다(F11과 같은 함정). 그러나
 * **감성·출처량**으로 보면 뚜렷이 갈린다 — 한국어 질문에서 훨씬 긍정적이고 근거도
 * 풍부하며, 영어 질문에서는 존재감이 옅어진다(일부는 출처 0). 즉 언어축 자체는
 * 유효하다 — 2026-08-02 "언어축 무효" 결론은 그 시점 F5(언어→엔진 라우팅)가
 * 아직 없어 모든 질문이 7 엔진 전부로 갔기 때문이었다(측정이 고장난 것이었지
 * 축이 틀린 게 아니었다). F5 수정(2026-08-03) 이후 언어별로 엔진 구성이 실제로
 * 달라지므로 이제 유효하게 분해된다.
 *
 * 상세: `docs/_적용/시장축_언어재설계_2026-08-21.md`
 */
export function promptLanguageRegion(lang: "ko" | "en"): MarketRegion {
  return lang === "ko" ? "korea" : "global";
}

/**
 * 🔴 **출처를 구조적으로 못 내는 엔진** — 인용 0 이 "우리를 안 읽었다"는 뜻이 **아닌** 곳.
 *
 * 발단(2026-08-17 세션N-38): 권역 분리를 하면 한국 엔진이 한 그룹에 모인다.
 *   그런데 `hyperclova` 는 인용이 **항상 0** 이라, 모아 놓으면 우리 유일 차별점인
 *   한국 그룹이 *"출처를 하나도 못 따오는 곳"* 처럼 보인다.
 *   → 차별점을 드러내려던 화면이 차별점을 **약점으로 보이게 만드는 역설**.
 *
 * ⚠️ **재설계안 v4 §4「탭4 함정」의 "chatgpt·claude·hyperclova 3종"은 틀렸다.**
 *   코드 실측(`packages/ai/lib/engines/`)으로 판정한 결과 **구조적 0 은 hyperclova 하나뿐**이다:
 *
 *     hyperclova       `analyzeText(..., [], ...)`  ← **하드코딩 빈 배열**. 인용이 나올 길이 없다
 *     chatgpt·claude   provider sources 없으면 `extractCitedSources(text)` **본문 URL 폴백**
 *                      → 답변에 URL 을 적으면 인용이 **잡힌다**. 0 은 "이번엔 안 적었다"는 뜻
 *     perplexity·gemini`mapProviderSources(sources)` — 검색 기반이라 정상 인용
 *     naver·daum·briefing  검색 문서를 인용으로 매핑
 *
 * 🔴 그래서 chatgpt·claude 까지 *"출처를 안 밝히는 AI"* 라고 적으면 **사실이 아닌 안내**가 된다
 *   (0 인 이유가 다른데 같은 변명을 붙이는 것 = 이 저장소가 반복해 온 "이름 하나로 뭉개기").
 *   목록을 늘리려면 **어댑터 코드를 열어 빈 배열을 확인한 뒤**에만 늘린다.
 */
const NO_CITATION_ENGINES = new Set<string>(["hyperclova"]);

/**
 * 이 엔진이 출처를 반환할 수 **있는가**. `false` 면 인용 0 을 성과로 읽으면 안 된다.
 * 🔒 화면은 이 함수로만 판단한다 — 엔진 id 를 직접 비교하면 사설 목록이 또 생긴다(N-34 사고).
 */
export function engineReturnsCitations(engineId: EngineId | string): boolean {
  return !NO_CITATION_ENGINES.has(engineId);
}

/**
 * 🔴 **검색 그라운딩이 있어야만 출처를 내는 엔진** (N-47 · 2026-08-19 프로덕션 실측).
 *
 * 이 엔진들은 「출처를 못 내는 API」가 **아니다**. 낼 수 있는데 **우리가 안 켰다**.
 *
 * | 엔진 | 실측 | 왜 비었나 |
 * |---|---|---|
 * | perplexity | **47/47 (100%)** | `createOpenAI` 껍데기로 호출 → citation 필드를 못 읽었다 |
 * | gemini | **64/65 (98%)** | `googleSearch` 도구 미전달 → 근거 웹페이지가 없다 |
 *
 * ⚠️ **이 구분이 왜 중요한가**: 화면이 이 둘에 `인용 0` 을 찍으면 고객은
 *   *"이 AI 가 우리를 안 읽었다"* 로 읽는다. 진실은 *"우리가 아직 안 받아왔다"* 다.
 *   📕 이 저장소 최다 사고 유형 — **못 잰 것을 0이라 부르기**. 같은 실수를 반복하지 않는다.
 *
 * ⭐ **그라운딩을 켜면 이 목록은 의미가 없어진다**(아래 `engineSourceState` 가 플래그를 본다).
 *   즉 이건 영구 목록이 아니라 **"지금 꺼져 있다"는 상태 표시**다.
 */
const GROUNDING_DEPENDENT_ENGINES = new Set<string>(["gemini"]);

/**
 * 🔴 **웹 검색 없이 도는 엔진 — 구조적으로 출처를 못 낸다**(N-47 · 2026-08-20 실측).
 *
 * | 엔진 | 경로 | 실측 |
 * |---|---|---|
 * | claude | Letsur 일반 채팅 | sources **0** · 본문 URL **없음** → 인용이 나올 길이 없다 |
 *
 * ✅ **perplexity 는 N-48 에 이 목록에서 빠졌다**(2026-08-20).
 *   원인은 Gateway 크레딧이 **아니었다** — 라이브는 자체 키 **직접 호출**이라 Gateway 를
 *   안 탄다(👤 지적 → 코드 실측). 진짜 원인은 `createOpenAI` 껍데기가 Perplexity 의
 *   **규격 밖 인용 필드**(`search_results`·`citations`)를 잘라낸 것이고, 원시 `response.body`
 *   에서 직접 꺼내도록 고쳤다(`extractPerplexitySources`).
 *
 * 🔴🔴 **그래서 이 목록에서도 빼야 한다.** 안 빼면 출처를 되살려놓고 화면은 계속
 *   「출처 미수집」이라 말한다 — 📕 *"가드가 버그의 호위병이 된다"* 의 전형이다.
 *   ⚠️ perplexity 가 이제 `collected` 이므로 **「인용 0」이 정직한 0** 이 된다
 *   (실제로 아무것도 인용되지 않았다는 뜻). 라이브 측정으로 확인한다.
 *
 * 🔴🔴 **chatgpt 를 N-48 에 넣었다** — 이 주석은 예전에 *"폴백이 실제로 인용을 건진다
 *   (실측 29%)"* 라며 제외했지만, **그 29% 의 정체를 확인하니 전부 가짜였다.**
 *   위 주석 자신의 조건 *"어댑터를 열어 확인한 뒤에만"* 을 **충족해서** 넣는다.
 *
 * ### 근거 — 독립적인 두 방법이 일치했다(프로덕션 `Tracking` 107건 전수)
 *
 * | 검증 | 결과 | 뜻 |
 * |---|---|---|
 * | ① `title` 보유율 | **0/107 (0%)** | 폴백은 `{url,domain}` 만 넣는다 — provider citation 은 title 을 준다 |
 * | ② 인용 URL 이 답변 본문에 있나 | **107/107 (100%)** | 폴백은 본문에서 정규식으로 뽑는다 |
 * | 대조군 perplexity ② | **1/58 (2%)** | 본문에 **없는** 출처 = 진짜 provider citation |
 *
 * 즉 chatgpt 인용은 **AI 가 답변에 타이핑한 브랜드 홈페이지**다(`www.laneige.com` 등
 * 경쟁사 루트 URL·제목 없음). *"AI 가 무엇을 **보고** 말하는가"* 에 답하지 못한다 —
 * 읽은 게 아니라 **적은 것**이고, 남의 사이트라 **고객이 고칠 수도 없다**.
 *
 * 🔴🔴 **폴백 제거와 이 판정은 반드시 같이 간다.** 하나만 하면 사고다:
 *   폴백만 막으면 화면이 「인용 0」을 찍는데, chatgpt 는 등장 4/4 다 →
 *   고객은 *"ChatGPT 가 우리를 안 읽었다"* 로 읽는다. **거짓이다**(출처를 안 밝힐 뿐).
 *   📕 이 저장소 최다 사고 — **못 잰 것을 0이라 부르기**. 그래서 `not_collected` 로 말한다.
 *
 * ⚠️ 되돌릴 조건: chatgpt 가 **진짜 provider citation** 을 주기 시작하면(= title 이 붙으면)
 *   이 목록에서 빼야 한다. 판정 근거는 **title 유무**로 재실측할 것.
 */
/**
 * 🔴🔴 **claude 는 플래그로 갈린다**(N-48 · 2026-08-20).
 *   `FINDABLE_CLAUDE_WEB_SEARCH=1` 이면 Letsur `/v1/messages` 로 **실제 웹검색**을 태워
 *   출처를 받는다(실측: 출처 18건) → 그때는 `collected` 여야 한다.
 *   꺼져 있으면 일반 채팅이라 구조적 0 → `not_collected`.
 *
 * ⚠️ **환경값을 테스트가 단정하지 않는다** — 📕 N-47 사고: `expect(process.env.X)
 *   .toBeUndefined()` 가 👤 승인으로 플래그를 켜자 **빌드를 실패**시켰다.
 *   테스트는 「플래그를 읽어 갈래가 나뉜다」만 못박고, 실값은 환경이 정한다.
 */
function claudeReadsWeb(): boolean {
  return process.env.FINDABLE_CLAUDE_WEB_SEARCH === "1";
}

const NO_WEB_SEARCH_ENGINES = new Set<string>(["claude", "chatgpt"]);

/** 화면이 「인용 0」을 어떻게 말해야 하는가. */
export type EngineSourceState =
  /** API 가 출처를 아예 반환하지 않는다(hyperclova) — 0 은 성과와 무관. */
  | "never"
  /** 낼 수 있는데 **우리가 안 켰다**(그라운딩 off) — 0 이 아니라 「미수집」. */
  | "not_collected"
  /** 정상 수집 경로 — 0 이면 **진짜로** 아무것도 인용되지 않은 것. */
  | "collected";

/**
 * 이 엔진의 인용 0 을 뭐라고 불러야 하는가 — **판정은 여기 한 곳에서만** 한다.
 * 🔒 화면이 엔진 id 를 직접 비교하면 사설 목록이 또 생긴다(N-34 사고).
 *
 * @param groundingEnabled 검색 그라운딩이 켜져 있는가(`FINDABLE_ENGINE_GROUNDING`).
 *   켜져 있으면 `not_collected` 는 나오지 않는다 — 실제로 받아오고 있으므로.
 */
export function engineSourceState(
  engineId: EngineId | string,
  groundingEnabled: boolean
): EngineSourceState {
  if (NO_CITATION_ENGINES.has(engineId)) {
    return "never";
  }
  // 🔴 웹 검색 없이 도는 엔진 — 그라운딩을 켜든 말든 **출처가 나올 길이 없다**(N-47 실측).
  //   claude(Letsur 일반 채팅)만 해당. ✅ perplexity 는 N-48 파싱 수정으로 빠졌다.
  //   여기에 「인용 0」을 찍으면 *"이 AI 가 우리를 안 읽었다"* 로 읽힌다 — 사실이 아니다.
  // 🔴 claude 만 플래그로 갈린다 — 웹검색을 켜면 출처를 실제로 받아온다(N-48).
  //   ⭐ 여기서 갈라야 한다: 안 갈라면 출처를 받아놓고 화면이 계속 「출처 미수집」이라
  //   말한다(📕 *"가드가 버그의 호위병"* — perplexity 에서 똑같이 당했다).
  if (engineId === "claude" && claudeReadsWeb()) {
    return "collected";
  }
  if (NO_WEB_SEARCH_ENGINES.has(engineId)) {
    return "not_collected";
  }
  if (!groundingEnabled && GROUNDING_DEPENDENT_ENGINES.has(engineId)) {
    return "not_collected";
  }
  return "collected";
}

/** 선언한 시장이 이 권역을 포함하는가 = 이 권역을 점수 분모에 넣는가. */
export function scopeIncludes(
  scope: MarketScope,
  region: MarketRegion
): boolean {
  return scope === "both" || scope === region;
}

/** 선언한 시장에 해당하는 권역 목록(표시 순서 = 한국 먼저). */
export function regionsForScope(scope: MarketScope): MarketRegion[] {
  if (scope === "korea") {
    return ["korea"];
  }
  if (scope === "global") {
    return ["global"];
  }
  return ["korea", "global"];
}

/** 화면 표기용 라벨. ⚠️ 점수 옆 시장 라벨은 **의무**다(라벨 없는 62점은 의미가 고객마다 달라진다). */
export const REGION_LABEL: Record<MarketRegion, string> = {
  korea: "한국 시장",
  global: "글로벌 시장",
};

export const SCOPE_LABEL: Record<MarketScope, string> = {
  korea: "국내 중심",
  global: "해외 중심",
  both: "국내·해외 병행",
};

/**
 * 응답 배열을 **엔진 국적**으로 필터. `engineRegion` 과 마찬가지로 "AI 별 등장·출처"
 * 처럼 엔진 자체를 그룹핑하는 화면에서만 쓴다 — 시장(국내/해외) 분해에는
 * `filterByLanguageRegion` 을 쓴다(위 `promptLanguageRegion` 주석 참조).
 */
export function filterByRegion<T extends { engineId: EngineId | string }>(
  responses: T[],
  region: MarketRegion
): T[] {
  return responses.filter((r) => engineRegion(r.engineId) === region);
}

/**
 * 응답 배열을 **질의 언어**로 필터 — 시장(국내/해외) 분해는 이 함수로 한다
 * (2026-08-21 재설계, `promptLanguageRegion` 참조). aggregateAudit·geoAxisScores 에
 * 그대로 넘기면 시장별 점수가 나온다(기존 순수 함수 재호출 — 새 채점 로직 0).
 */
export function filterByLanguageRegion<T extends { promptLang: "ko" | "en" }>(
  responses: T[],
  region: MarketRegion
): T[] {
  return responses.filter((r) => promptLanguageRegion(r.promptLang) === region);
}

/**
 * 선언한 시장에 해당하는 응답만 남긴다(= 점수 분모 결정).
 * 국내 전용 고객은 글로벌 엔진이 여기서 빠지므로 "글로벌 0점"이 **산출될 수 없다**.
 */
export function filterByScope<T extends { engineId: EngineId | string }>(
  responses: T[],
  scope: MarketScope
): T[] {
  if (scope === "both") {
    return responses;
  }
  return responses.filter((r) => engineRegion(r.engineId) === scope);
}

// ──────────────────────────────────────────────────────────────────
// 시장 자동 추정
//
// 사용자 결정(2026-08-02): 무료진단 폼에 입력칸을 **늘리지 않는다**(게이팅 추가 = 이탈 요인,
// 원가방어 리서치 결론과 동일 원칙). 도메인·업종으로 기본값을 추정하고, 틀리면 앱에서 고친다.
// 업종 자동감지(industry-profile.ts)와 같은 패턴.
// ──────────────────────────────────────────────────────────────────

/** 한국 시장 전용 성격이 강한 TLD. */
const KOREA_TLD_RE = /\.(kr|co\.kr|or\.kr|ne\.kr|re\.kr|go\.kr|ac\.kr)$/;

/**
 * 내수 성격이 강한 업종 — 해외 AI 답변에 안 나오는 게 정상이라 글로벌 점수를 보여주면 오해를 낳는다.
 * (industry-profile.ts 의 IndustryKey 와 같은 문자열을 쓴다.)
 */
const DOMESTIC_LEANING_INDUSTRIES = new Set<string>([
  "healthcare",
  "education",
  "finance",
]);

const PROTOCOL_RE = /^https?:\/\//;
const WWW_RE = /^www\./;

function normalizeHost(domain: string): string {
  return (
    domain.replace(PROTOCOL_RE, "").replace(WWW_RE, "").split("/")[0] ?? domain
  ).toLowerCase();
}

export interface InferMarketScopeInput {
  domain: string;
  /** 감지·저장된 업종(IndustryKey). 없으면 도메인만으로 판단. */
  industry?: string | null;
  /** 측정 언어. ko 전용 측정은 국내 의도가 강하다. */
  language?: "ko" | "en" | "both";
}

export interface InferredMarketScope {
  /** 추정 확신도. low 면 UI 가 "맞나요?" 확인을 더 강하게 띄운다. */
  confidence: "high" | "low";
  /** 추정 근거(화면에 "왜 이렇게 잡혔는지" 설명하고 수정 유도). */
  reason: string;
  scope: MarketScope;
}

/**
 * 타깃 시장 추정 — 도메인 TLD · 업종 · 측정 언어 순으로 본다.
 *
 * ⚠️ 확신 없으면 **both**(기존 동작과 동일). 잘못 좁혀 글로벌을 숨기는 것보다,
 *    넓게 두고 고객이 좁히게 하는 쪽이 안전하다(정보를 지우는 실수가 더 비싸다).
 */
export function inferMarketScope(
  input: InferMarketScopeInput
): InferredMarketScope {
  const host = normalizeHost(input.domain);

  if (KOREA_TLD_RE.test(host)) {
    return {
      scope: "korea",
      reason: "한국 도메인(.kr)이라 국내 중심으로 잡았습니다.",
      confidence: "high",
    };
  }

  if (input.industry && DOMESTIC_LEANING_INDUSTRIES.has(input.industry)) {
    return {
      scope: "korea",
      reason:
        "국내 고객을 주로 상대하는 업종이라 국내 중심으로 잡았습니다. 해외 진출 중이라면 바꿔주세요.",
      confidence: "low",
    };
  }

  if (input.language === "ko") {
    return {
      scope: "korea",
      reason: "한국어로만 측정해 국내 중심으로 잡았습니다.",
      confidence: "low",
    };
  }

  if (input.language === "en") {
    return {
      scope: "global",
      reason: "영어로만 측정해 해외 중심으로 잡았습니다.",
      confidence: "low",
    };
  }

  return {
    scope: "both",
    reason: "국내·해외를 함께 봅니다. 한쪽만 보시려면 바꿔주세요.",
    confidence: "low",
  };
}
