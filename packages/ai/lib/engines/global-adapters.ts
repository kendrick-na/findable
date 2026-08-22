// 글로벌 4 엔진 어댑터 — Vercel AI Gateway 사용
//
// AI SDK v6: plain `"provider/model"` 문자열을 model 인자로 전달하면
// Gateway로 자동 라우팅 (gateway() 래퍼 불필요).
//
// 인증 (우선순위):
//   1. VERCEL_OIDC_TOKEN  ← 권장. Vercel 프로젝트에 연결 후 `vercel env pull .env.local`
//      자동 프로비저닝. 약 24시간 유효, 배포 시 자동 갱신, 수동 로테이션 불필요.
//   2. (fallback) 정적 키 — CI/비-Vercel 환경 등 OIDC 사용 불가 시에만.
//
// 둘 다 미설정 시 stub 응답 반환.
//
// 모델 슬러그 규칙: 버전은 점(.) 사용, 하이픈 X. 예: anthropic/claude-sonnet-4.6

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type LanguageModel } from "ai";
import { sanitizeEngineText } from "./sanitize";
import type {
  EngineAdapter,
  EngineId,
  EngineQuery,
  EngineResponse,
} from "./types";
import {
  detectBrandMention,
  estimateSentiment,
  estimateShareOfVoice,
  extractPerplexitySources,
  mapProviderSources,
  mentionPositionFields,
} from "./utils";

// 최신 모델 ID는 `gateway.getAvailableModels()` 또는
// curl https://ai-gateway.vercel.sh/v1/models 로 확인 후 ENV에 주입 권장.
const MODEL_DEFAULTS: Record<
  Extract<EngineId, "chatgpt" | "claude" | "perplexity" | "gemini">,
  string
> = {
  chatgpt: process.env.FINDABLE_MODEL_CHATGPT ?? "openai/gpt-5.4",
  claude: process.env.FINDABLE_MODEL_CLAUDE ?? "anthropic/claude-sonnet-4.6",
  perplexity: process.env.FINDABLE_MODEL_PERPLEXITY ?? "perplexity/sonar",
  gemini: process.env.FINDABLE_MODEL_GEMINI ?? "google/gemini-2.5-flash",
};

// 원가전략(2026-07-27): chatgpt·claude는 Letsur AI Gateway로 라우팅(사용자 크레딧 사용).
//   Letsur는 OpenAI 호환(POST /v1/chat/completions)이라 createOpenAI baseURL만 교체.
//   Vercel AI Gateway 크레딧을 아껴 파트너 측정 중 429(끊김)를 방지한다.
//   perplexity는 Letsur 미지원 → Vercel Gateway 유지(건당 저렴). gemini는 Google 무료 키.
// Letsur 에셋 슬러그(대시보드 확인): gpt-5.4, claude-sonnet-4-6 (하이픈, Vercel과 표기 다름).
const LETSUR_BASE_URL = "https://gw.letsur.ai/v1";
const LETSUR_MODEL_IDS: Record<"chatgpt" | "claude", string> = {
  chatgpt: process.env.FINDABLE_LETSUR_MODEL_CHATGPT ?? "gpt-5.4",
  claude: process.env.FINDABLE_LETSUR_MODEL_CLAUDE ?? "claude-sonnet-4-6",
};

// Letsur로 라우팅하는 엔진. 여기 없으면 Vercel Gateway 사용.
const LETSUR_ENGINES = new Set<EngineId>(["chatgpt", "claude"]);

let letsurProvider: ReturnType<typeof createOpenAI> | null = null;
function getLetsurProvider(): ReturnType<typeof createOpenAI> | null {
  const apiKey = process.env.LETSUR_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!letsurProvider) {
    letsurProvider = createOpenAI({ baseURL: LETSUR_BASE_URL, apiKey });
  }
  return letsurProvider;
}

// gemini는 Google AI Studio 무료 티어(GOOGLE_API_KEY, 하루 1,500회 무료·카드 불필요)로
// 직접 호출해 Vercel Gateway 크레딧을 아낀다. 키 없으면 Vercel Gateway로 폴백.
const GEMINI_GOOGLE_MODEL =
  process.env.FINDABLE_GEMINI_MODEL ?? "gemini-2.5-flash";
let googleProvider: ReturnType<typeof createGoogleGenerativeAI> | null = null;
function getGoogleProvider(): ReturnType<
  typeof createGoogleGenerativeAI
> | null {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!googleProvider) {
    googleProvider = createGoogleGenerativeAI({ apiKey });
  }
  return googleProvider;
}

// perplexity는 공식 API(PERPLEXITY_API_KEY, 신규 프로모션 크레딧 $10)로 직접 호출해
// Vercel Gateway 크레딧을 아낀다. OpenAI 호환(api.perplexity.ai). 키 없으면 Vercel 폴백.
const PERPLEXITY_BASE_URL = "https://api.perplexity.ai";
const PERPLEXITY_MODEL = process.env.FINDABLE_PERPLEXITY_MODEL ?? "sonar";
let perplexityProvider: ReturnType<typeof createOpenAI> | null = null;
function getPerplexityProvider(): ReturnType<typeof createOpenAI> | null {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!perplexityProvider) {
    perplexityProvider = createOpenAI({
      baseURL: PERPLEXITY_BASE_URL,
      apiKey,
    });
  }
  return perplexityProvider;
}

/**
 * 🔴🔴 **claude 웹검색 — Letsur Anthropic 네이티브 경로**(N-48 · 2026-08-20 실측).
 *
 * ## 왜 필요한가
 * claude 는 Letsur `/v1/chat/completions`(OpenAI 호환)로 도는 **일반 채팅**이라
 * 출처가 **구조적으로 0** 이었다(실측 80/81 공백 · `engineSourceState` 가 「출처 미수집」).
 * *"AI 가 무엇을 보고 우리를 말하는가"* 를 파는 제품에서 가장 비싼 엔진이 그 답을 못 냈다.
 *
 * ## 🔬 실측으로 확인한 것 (2026-08-20 · 라이브 Letsur 키)
 *
 * | 경로 | 결과 |
 * |---|---|
 * | `/v1/chat/completions` + anthropic 서버툴 | ❌ **검색 안 함**(`finish_reason: tool_calls` = 클라이언트가 실행하란 뜻) |
 * | `/v1/chat/completions` + function 래핑 | ❌ 검색 안 함 |
 * | **`/v1/messages`(Anthropic 네이티브) + `web_search_20250305`** | ✅ **HTTP 200 · 실제 검색 · 출처 18건** |
 *
 * ⭐ 그래서 **이 엔드포인트만** 쓴다. AI SDK 로는 못 간다(`@ai-sdk/anthropic` 미설치)
 *   → `fetch` 로 직접 호출한다. **새 의존성 0**(한국 엔진 어댑터도 같은 방식이다).
 *
 * ## 💰 원가 (실측 · Letsur 단가 in $3 / out $15 per 1M)
 *
 * | 질의 | in | out | 검색 | unit |
 * |---|---:|---:|---:|---:|
 * | 추천형 | 9,384 | 968 | 1 | 0.043 |
 * | 경쟁사 비교형 | 24,862 | 860 | 2 | 0.088 |
 *
 * 평균 **0.065 unit/호출** → 측정 1회(claude 4호출) **0.26 unit**.
 * 👤 보유 **191.87 unit**(KAIST 오버엣지 무상 200 · **만료 2026-09-30** · 콘솔 실측 08-20).
 *   ⚠️ 콘솔의 「유상」 라벨은 **발급 방식 표기**일 뿐 실제로는 무상 지원분이다.
 *   100 unit 묶음 2개(92.17 + 99.70)이며 **만료일이 둘 다 같다** → 실질 한 덩어리.
 * ⭐ 만료까지 하루 1~2회 측정이면 **12~24 unit(6~13%)** 만 쓴다 — **켜도 다 못 쓴다.**
 *   손익분기는 **하루 16회** 측정. 8월 실사용은 한 달 통틀어 5.37 unit(2.8%)이었다.
 *   ⚠️ 소진되면 초과사용이 **허용 안 됨**이라 호출이 중단된다 → 잔량 감시는 계속 필요.
 * 🔴 만료 후엔 이 플래그를 끄는 것으로 **부족하다** — 플래그는 「웹검색을 태우나」만
 *   제어하고, chatgpt·claude **호출 자체**가 LETSUR_API_KEY 에 붙어 있다(LETSUR_ENGINES).
 *   만료 시 두 엔진이 Vercel Gateway 로 폴백하는데 거기 크레딧이 0 이라 **동시에 죽는다**
 *   (📕 N-48 에서 perplexity 가 정확히 이 방식으로 죽었다).
 *
 * 🔴 **플래그 뒤에 둔다**(`FINDABLE_CLAUDE_WEB_SEARCH=1`) — 만료 후 유닛이 없으면
 *   끄고 예전 동작으로 돌아갈 수 있어야 한다(엔진을 잃지 않는다 — 📕 N-47 perplexity 교훈).
 */
const LETSUR_MESSAGES_URL = `${LETSUR_BASE_URL}/messages`;
const CLAUDE_SEARCH_MAX_USES = 3;

function isClaudeWebSearchEnabled(): boolean {
  return process.env.FINDABLE_CLAUDE_WEB_SEARCH === "1";
}

interface AnthropicSearchResult {
  title?: string;
  url?: string;
}
interface AnthropicBlock {
  citations?: AnthropicSearchResult[];
  content?: AnthropicSearchResult[];
  text?: string;
  type?: string;
}

/**
 * `/v1/messages` 응답에서 **본문 텍스트**와 **출처**를 뽑는다.
 * 출처는 두 자리에 온다 — `web_search_tool_result.content[]` 와 `text.citations[]`.
 * 둘 다 훑어 합치고, 중복은 `mapProviderSources` 가 걸러낸다(같은 정규화를 재사용).
 */
function parseAnthropicMessages(body: unknown): {
  sources: Array<{ sourceType: string; title?: string; url?: string }>;
  text: string;
} {
  const blocks =
    body && typeof body === "object"
      ? ((body as { content?: AnthropicBlock[] }).content ?? [])
      : [];
  const parts: string[] = [];
  const sources: Array<{ sourceType: string; title?: string; url?: string }> =
    [];
  const push = (items: AnthropicSearchResult[] | undefined) => {
    for (const it of items ?? []) {
      if (it?.url) {
        sources.push({ sourceType: "url", url: it.url, title: it.title });
      }
    }
  };
  for (const b of blocks) {
    if (b?.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
      push(b.citations);
    }
    if (b?.type === "web_search_tool_result") {
      push(b.content);
    }
  }
  return { sources, text: parts.join("\n").trim() };
}

const STUB_NOTICE =
  "[STUB] AI Gateway 인증 미설정 (VERCEL_OIDC_TOKEN 권장). 실제 엔진 호출 없이 더미 응답을 반환합니다.";

function makeStubResponse(
  engineId: EngineId,
  prompt: string,
  durationMs: number
): EngineResponse {
  return {
    engineId,
    rawResponse: `${STUB_NOTICE}\n질의: ${prompt.slice(0, 200)}`,
    brandMentioned: false,
    mentionPosition: null,
    mentionListSize: null,
    sentiment: null,
    citedSources: [],
    shareOfVoice: null,
    errorMessage: null,
    durationMs,
    isStub: true,
  };
}

/**
 * 🔴🔴 **검색 근거(출처)를 실제로 받아오는 스위치** — 기본 **off**(N-47 · 2026-08-19).
 *
 * ## 무엇이 문제였나 (프로덕션 382건 실측)
 *
 * | 엔진 | 출처 0건 | 원인 |
 * |---|---|---|
 * | perplexity | **47/47 (100%)** | `createOpenAI` 껍데기로 호출 → Perplexity 의 citation 을 **읽을 줄 모른다** |
 * | gemini | 64/65 (98%) | **검색 그라운딩을 안 켰다** — 근거로 삼은 웹페이지가 애초에 없다 |
 * | claude·chatgpt | 99%·71% | Letsur 경유 **일반 채팅**(웹 검색 없음) |
 * | naver·daum | **0%** ✅ | 검색 문서를 직접 매핑 — 정상 |
 *
 * 공식 문서(AI SDK v6 `05-generating-text.mdx:609`): *"sources are limited to
 * **web pages that ground the response**"*. 즉 **그라운딩 없이는 sources 가 존재할 수 없다.**
 * Google 은 `google.tools.googleSearch({})` 가 **필수**다(`@ai-sdk/google` 문서 :541).
 *
 * ## 왜 플래그로 감쌌나
 * 그라운딩·검색은 **호출 단가가 오른다**. 👤 결정: *"먼저 비용부터 재고 결정"*.
 * → 코드는 준비하되 **기본 off**. 켜서 1건 측정해 실제 청구액을 잰 뒤 판단한다.
 *
 * ⚠️ **로컬에서 검증 불가** — 엔진 키가 전부 프로덕션 전용이다(실측). 배포 후 실측이 유일한 길.
 */
function isGroundingEnabled(): boolean {
  return process.env.FINDABLE_ENGINE_GROUNDING === "1";
}

/**
 * 🔴🔴 **「키가 있다」 ≠ 「Gateway 가 응답한다」** (N-47 · 2026-08-20 실측).
 *
 * 이 함수는 **키 존재만** 본다. 그런데 실제 호출은 이렇게 죽는다:
 *
 *   > A positive credit balance is required for all requests, including BYOK…
 *
 * **Vercel AI Gateway 크레딧이 0** 이다(2026-08-20 확인). 즉 이 함수가 `true` 를 줘도
 * Gateway 로 보낸 요청은 **전부 실패**한다. perplexity 를 Gateway 로 돌렸다가
 * **엔진이 통째로 죽은**(행 0건) 원인이 바로 이것이었다.
 *
 * ⚠️ **지금 살아 있는 엔진은 전부 직접 호출이라 무사하다** —
 *   chatgpt·claude=Letsur · gemini=Google · perplexity=Perplexity 공식 API.
 *   Gateway 는 **아무 키도 없을 때의 폴백**(`:238`)으로만 남아 있는데,
 *   그 폴백이 도는 상황이면 **이미 크레딧 없이 죽는다**.
 *
 * 🔴 **새 엔진을 Gateway 경로로 붙이지 말 것** — 크레딧을 충전하기 전까지는 반드시 실패한다.
 *   충전 링크는 Vercel 대시보드 → AI → Top up.
 *
 * ⚠️⚠️ **단, 충전이 perplexity 출처를 고치는 건 아니다**(N-48 정정 · 👤 지적).
 *   perplexity 출처 공백의 원인은 **크레딧이 아니라 응답 파싱**이었다
 *   (`createOpenAI` 껍데기가 규격 밖 인용 필드를 잘라냄 → `extractPerplexitySources` 로 해결).
 *   여기 적힌 크레딧 0 은 **「Gateway 를 새로 쓰려 할 때」의 제약**일 뿐,
 *   지금 라이브 엔진들의 동작과는 **무관**하다. 두 문제를 섞지 말 것.
 */
function isGatewayConfigured(): boolean {
  // 인증 우선순위 (AI SDK v6 기본 동작):
  //   1. AI_GATEWAY_API_KEY — Vercel Dashboard에서 발급한 정적 키. production 권장.
  //   2. VERCEL_OIDC_TOKEN — 로컬 개발용. `vercel env pull` 자동 프로비저닝.
  //   3. FINDABLE_FORCE_LIVE=1 — 강제 라이브 모드.
  return (
    Boolean(process.env.AI_GATEWAY_API_KEY) ||
    Boolean(process.env.VERCEL_OIDC_TOKEN) ||
    process.env.FINDABLE_FORCE_LIVE === "1"
  );
}

type GlobalEngineId = Extract<
  EngineId,
  "chatgpt" | "claude" | "perplexity" | "gemini"
>;

interface ResolvedModel {
  // AI SDK model: provider 모델 객체(Letsur/Google) 또는 Vercel Gateway plain string.
  model: LanguageModel;
  /**
   * 검색 그라운딩 도구(N-47). 있으면 `generateText({ tools })` 로 넘긴다.
   * 🔴 **이게 있어야 `sources` 가 채워진다** — 공식 문서: *"sources are limited to
   *   web pages that **ground** the response"*. 도구 없이는 근거 웹페이지가 없다.
   */
  tools?: Record<string, unknown>;
  // useDirectProvider=true면 Letsur/Google 직접 호출(gateway providerOptions 미부착).
  useDirectProvider: boolean;
}

// 엔진의 호출 경로를 결정한다.
//   chatgpt·claude → Letsur 키 있으면 Letsur, 없으면 Vercel Gateway.
//   gemini → Google 키 있으면 Google 무료, 없으면 Vercel Gateway.
//   perplexity → 항상 Vercel Gateway.
// 어느 경로도 불가면 null(→ stub).
function resolveModel(engineId: GlobalEngineId): ResolvedModel | null {
  const letsur = LETSUR_ENGINES.has(engineId) ? getLetsurProvider() : null;
  if (letsur && (engineId === "chatgpt" || engineId === "claude")) {
    return {
      model: letsur(LETSUR_MODEL_IDS[engineId]),
      useDirectProvider: true,
    };
  }
  if (engineId === "gemini") {
    const google = getGoogleProvider();
    if (google) {
      return {
        model: google(GEMINI_GOOGLE_MODEL),
        // 🔴 **검색 그라운딩을 켜야 `sources` 가 나온다**(N-47 · `@ai-sdk/google` 문서 :541).
        //   지금까지 도구를 안 넘겨서 **65건 중 64건이 출처 0** 이었다.
        //   ⚠️ 켜면 단가가 오른다 → 👤 결정 전까지 기본 off(비용 실측 후 판단).
        ...(isGroundingEnabled()
          ? { tools: { google_search: google.tools.googleSearch({}) } }
          : {}),
        useDirectProvider: true,
      };
    }
  }
  if (engineId === "perplexity") {
    // 🔴 **그라운딩 모드에서는 직접 호출을 쓰지 않는다**(N-47).
    //   아래 `createOpenAI` 경로는 OpenAI 호환 껍데기라 **Perplexity 의 citation 필드를
    //   해석하지 못한다** → `sources` 가 항상 비어 프로덕션 47/47 이 출처 0 이었다.
    //   Gateway 경로(`perplexity/sonar` 문자열)는 Gateway 의 Perplexity provider 를 타서
    //   sources 를 정상 매핑한다. ⭐ **새 의존성 없이** 고칠 수 있는 이유다.
    //   ⚠️ 워크스페이스의 `@ai-sdk/perplexity@2.0.30` 은 SDK **v5** 용이라 쓰지 않는다
    //     (우리는 `@ai-sdk/google@3`·`openai@3` = v6 계열).
    // 🔴🔴 **되돌렸다 — 라이브 실측이 이 분기를 반증했다**(N-47 · 2026-08-20).
    //   그라운딩을 켜고 측정하니 perplexity 가 **행 0건**이 됐다(직전 회차는 3건·₩1.5).
    //   Gateway 경로로 보냈는데 **응답이 아예 안 왔다** — 출처를 얻기는커녕
    //   **엔진 하나를 통째로 잃었다.** 고치려던 것보다 나쁜 상태다.
    //   ⭐ 직접 호출(아래)은 **출처는 못 주지만 답변은 준다** — 등장·순위·감성은 계속 잰다.
    //     출처 하나 얻자고 나머지 지표를 전부 버릴 수는 없다.
    //   ⚠️ 다시 시도하려면 **Gateway 에서 perplexity 가 실제로 응답하는지 먼저 확인**할 것
    //     (크레딧·모델 슬러그·권한 중 무엇이 막았는지 미규명).
    //   📕 이 저장소 규율: *"고치기 전보다 나빠지면 되돌린다."*
    const perplexity = getPerplexityProvider();
    if (perplexity) {
      // .chat()으로 /chat/completions 경로 강제. 기본 provider()는 /responses를
      // 쓰는데 Perplexity는 그 경로가 없어 404(Not Found). Perplexity는 chat만 지원.
      return {
        model: perplexity.chat(PERPLEXITY_MODEL),
        useDirectProvider: true,
      };
    }
  }
  if (isGatewayConfigured()) {
    return { model: MODEL_DEFAULTS[engineId], useDirectProvider: false };
  }
  return null;
}

/**
 * provider 가 준 인용을 **한 곳에서** 결정한다.
 *
 * 🔴🔴 **Perplexity 는 표준 `sources` 가 비어서 온다**(N-48 정정 · 2026-08-20).
 *   자체 API 키 **직접 호출** + `createOpenAI` **호환 껍데기** 조합이라, 인용이 실린
 *   **OpenAI 규격 밖 필드**(`search_results`·`citations`)가 잘려나간다.
 *   → 원시 응답 body 에서 직접 꺼낸다(`extractPerplexitySources`).
 *
 * ⚠️ **크레딧 문제가 아니었다** — 라이브 경로는 Gateway 를 **타지 않는다**
 *   (`PERPLEXITY_API_KEY` 가 프로덕션에 있어 `resolveModel` 이 직접 호출로 끝낸다).
 *   N-47 이 「Gateway 크레딧 0」 탓으로 적은 것은 **인과가 틀렸다** — 👤 가 지적해 정정.
 *
 * ⭐ **표준 `sources` 가 있으면 그게 이긴다** — gemini 그라운딩·naver 경로를 망치지 않는다.
 */
function resolveProviderCited(
  sources: Parameters<typeof mapProviderSources>[0],
  rawBody: unknown
): ReturnType<typeof mapProviderSources> {
  const standardCited = mapProviderSources(sources);
  if (standardCited.length > 0) {
    return standardCited;
  }
  return extractPerplexitySources(rawBody);
}

/**
 * 🔴 **claude 웹검색 전용 경로** — Letsur `/v1/messages`(Anthropic 네이티브).
 *
 * AI SDK 를 안 쓰고 `fetch` 로 직접 부른다. 이유는 위 `LETSUR_MESSAGES_URL` 주석 참조
 * (OpenAI 호환 경로로는 **서버툴이 실행되지 않는다** — 실측).
 *
 * ⭐ 판정·집계 함수는 **일반 경로와 똑같은 것을 쓴다**(`detectBrandMention`·
 *   `estimateSentiment`·`mentionPositionFields`·`mapProviderSources`·`sanitizeEngineText`).
 *   여기서 따로 계산하면 같은 지표가 두 벌이 된다 — 📕 이 저장소 규율.
 *
 * ⚠️ 실패하면 `null` 을 돌려 **일반 경로로 폴백**한다. 웹검색을 얻으려다 엔진을
 *   통째로 잃는 건 고치기 전보다 나쁘다(📕 N-47 perplexity 사고).
 */
async function runClaudeWithWebSearch(
  query: EngineQuery,
  start: number
): Promise<EngineResponse | null> {
  const apiKey = process.env.LETSUR_API_KEY;
  if (!apiKey) {
    return null;
  }
  try {
    const res = await fetch(LETSUR_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: LETSUR_MODEL_IDS.claude,
        max_tokens: 1024,
        messages: [{ role: "user", content: query.prompt }],
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: CLAUDE_SEARCH_MAX_USES,
          },
        ],
      }),
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as {
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const { sources, text: rawText } = parseAnthropicMessages(body);
    if (rawText.length === 0) {
      return null;
    }
    const text = sanitizeEngineText(rawText);
    const mention = detectBrandMention(
      text,
      query.brandName,
      query.brandVariants
    );
    return {
      engineId: "claude",
      rawResponse: text,
      brandMentioned: mention.mentioned,
      ...mentionPositionFields(text, query.brandName, query.brandVariants),
      sentiment: estimateSentiment(text, query.brandName),
      // 🔴 **폴백을 쓰지 않는다** — 웹검색이 준 실제 출처만 신뢰한다(N-48).
      citedSources: mapProviderSources(sources),
      shareOfVoice: estimateShareOfVoice(
        text,
        query.brandName,
        query.brandVariants
      ),
      errorMessage: null,
      durationMs: Date.now() - start,
      isStub: false,
      usage: {
        inputTokens: body.usage?.input_tokens ?? null,
        outputTokens: body.usage?.output_tokens ?? null,
        costModel: "token",
      },
    };
  } catch {
    return null;
  }
}

/**
 * claude + 플래그 ON 일 때만 웹검색 경로를 탄다. 그 외에는 `null`(= 일반 경로).
 * ⭐ 조건을 어댑터 본문에서 빼낸 이유: 렌더·집계 함수 하나에 분기를 더 쌓으면
 *   복잡도 한도를 넘는다(실측). 판정을 한 곳에 모아 두면 읽기도 쉽다.
 */
async function tryClaudeWebSearch(
  engineId: GlobalEngineId,
  query: EngineQuery,
  start: number
): Promise<EngineResponse | null> {
  if (engineId !== "claude" || !isClaudeWebSearchEnabled()) {
    return null;
  }
  return await runClaudeWithWebSearch(query, start);
}

function makeGatewayAdapter(engineId: GlobalEngineId): EngineAdapter {
  return async (query) => {
    const start = Date.now();

    // 🔴 claude + 플래그 ON → Anthropic 네이티브 경로로 **웹검색**을 태운다.
    //   실패하면 `null` 이 와서 아래 일반 경로로 내려간다(엔진을 잃지 않는다).
    const searched = await tryClaudeWebSearch(engineId, query, start);
    if (searched) {
      return searched;
    }

    const resolved = resolveModel(engineId);
    if (!resolved) {
      return makeStubResponse(engineId, query.prompt, Date.now() - start);
    }
    const { model, useDirectProvider, tools } = resolved;

    try {
      const {
        response: providerResponse,
        text: rawText,
        sources,
        usage,
      } = await generateText({
        model,
        // 🔴 검색 그라운딩 도구(N-47). 없으면 `sources` 는 원리적으로 빌 수밖에 없다.
        ...(tools ? { tools: tools as never } : {}),
        system:
          query.language === "ko"
            ? "당신은 한국어 사용자를 위한 검색 어시스턴트입니다. 사실 기반으로 답하고, 구체적인 브랜드와 출처를 명시하세요."
            : "You are a search assistant. Provide factual, brand-aware answers with concrete recommendations and sources when available.",
        prompt: query.prompt,
        // Vercel Gateway 경로에서만 태그 부착(Letsur·Google 직접 호출은 미해당).
        ...(useDirectProvider
          ? {}
          : {
              providerOptions: {
                gateway: {
                  tags: [
                    "findable",
                    `engine:${engineId}`,
                    `lang:${query.language}`,
                  ],
                },
              },
            }),
      });

      // 🔴 세션N-13: 판정·저장·표시가 **같은 정제 텍스트**를 쓰게 한다.
      //   실측 32건(perplexity·gemini·claude)에서 마크다운 링크가 그대로 화면에 노출됐고,
      //   perplexity 는 `<br>` 태그까지 보냈다. 인용 URL 은 citedSources 에 따로 남는다.
      const text = sanitizeEngineText(rawText);
      const mention = detectBrandMention(
        text,
        query.brandName,
        query.brandVariants
      );
      // P1-e(2026-07-27) 출처 오염 방지: provider가 실제 citation(sources)을 주면
      // 그것을 신뢰(perplexity·gemini 검색모델). 없으면 본문 URL 폴백(오염 도메인 필터됨).
      const providerCited = resolveProviderCited(
        sources,
        providerResponse?.body
      );
      // 🔴🔴 **본문 URL 폴백을 끊었다**(N-48 · 2026-08-20 · 프로덕션 107건 전수 근거).
      //
      //   폴백이 만든 「출처」의 정체를 **독립적인 두 방법**으로 확인했다:
      //     ① `title` 보유율 **0/107** — 폴백은 title 을 안 넣는다(provider citation 은 넣는다)
      //     ② 인용 URL 이 답변 본문에 있나 **107/107** (대조군 perplexity 는 **1/58**)
      //   → 전량이 **AI 가 답변에 타이핑한 브랜드 홈페이지**였다(`www.laneige.com` 등).
      //
      //   ⭐ *"AI 가 무엇을 **보고** 우리를 말하는가"* 를 파는 제품에서 이건 **오답**이다:
      //     읽은 게 아니라 **적은 것**이고, 남의 사이트라 **고객이 고칠 수도 없다**.
      //     N-47 이 자사 도메인만 뺐는데(`brandDomain` 인자), 남긴 «외부 URL» 이
      //     바로 이 경쟁사 홈페이지들이었다.
      //
      // 🔴 **판정(`engineSourceState`)과 반드시 같이 간다** — 여기만 끊으면 화면이
      //   「인용 0」을 찍고, 등장 4/4 인 엔진에 대해 *"AI 가 우리를 안 읽었다"* 는
      //   **거짓말**이 된다. `market-scope.ts` 에서 chatgpt 를 `not_collected` 로 옮겼다.
      //   📕 이 저장소 최다 사고 — 못 잰 것을 0이라 부르기.
      //
      // ⚠️ `extractCitedSources` 는 **지우지 않는다** — 네이버·다음 어댑터가 쓰고,
      //   chatgpt 가 진짜 citation 을 주게 되면 판정과 함께 되살릴 자리다.
      const citedSources = providerCited;
      return {
        engineId,
        rawResponse: text,
        brandMentioned: mention.mentioned,
        ...mentionPositionFields(text, query.brandName, query.brandVariants),
        sentiment: estimateSentiment(text, query.brandName),
        citedSources,
        shareOfVoice: estimateShareOfVoice(
          text,
          query.brandName,
          query.brandVariants
        ),
        errorMessage: null,
        durationMs: Date.now() - start,
        isStub: false,
        usage: {
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          // gemini=Google 무료티어, 나머지=토큰 과금.
          costModel: engineId === "gemini" ? "free" : "token",
        },
      };
    } catch (error) {
      return {
        engineId,
        rawResponse: "",
        brandMentioned: false,
        mentionPosition: null,
        mentionListSize: null,
        sentiment: null,
        citedSources: [],
        shareOfVoice: null,
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
        isStub: false,
      };
    }
  };
}

export const chatgptAdapter: EngineAdapter = makeGatewayAdapter("chatgpt");
export const claudeAdapter: EngineAdapter = makeGatewayAdapter("claude");
export const perplexityAdapter: EngineAdapter =
  makeGatewayAdapter("perplexity");
export const geminiAdapter: EngineAdapter = makeGatewayAdapter("gemini");
