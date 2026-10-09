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
import { createOpenAI, openai } from "@ai-sdk/openai";
import { log } from "@repo/observability/log";
import { gateway, generateText, type LanguageModel } from "ai";
import {
  classifyLetsurUnavailable,
  GATEWAY_MESSAGES_URL,
  isGatewayFallbackAvailable,
  isLetsurCircuitOpen,
  type LetsurFallbackReason,
  letsurUnavailableReasonFromError,
  logLetsurFallback,
  readGatewayFallback,
  tripLetsurCircuit,
  withLetsurFallback,
} from "../letsur-fallback";
import { describeProviderError, isAbortError } from "./provider-error";
import { sanitizeEngineText } from "./sanitize";
import type {
  EngineAdapter,
  EngineId,
  EngineQuery,
  EngineResponse,
  EngineUsage,
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

// Perplexity는 2026년 Agent API로 이전됐다. Sonar/OpenAI 호환 채팅 경로는 새 프로젝트에서
// 폐기될 수 있으므로 `POST /v1/agent`를 직접 호출한다. 키가 없을 때만 Gateway로 폴백한다.
const PERPLEXITY_AGENT_URL = "https://api.perplexity.ai/v1/agent";
const PERPLEXITY_PRESET = process.env.FINDABLE_PERPLEXITY_PRESET ?? "fast";

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
export const CLAUDE_SEARCH_MAX_USES = 3;
// 🔴 운영 claude 요청의 max_tokens (아래 claudeSearchRequestBody 기본값과 같다).
export const CLAUDE_SEARCH_PROD_MAX_TOKENS = 1024;

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
export function parseAnthropicMessages(body: unknown): {
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
    // web_search_tool_result contains candidates, not answer citations.
  }
  return { sources, text: parts.join("\n").trim() };
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * `/v1/messages` 응답의 `usage` 에서 원가 재료를 뽑는다.
 * 웹검색 횟수 = `usage.server_tool_use.web_search_requests`
 *   (공식 문서 https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool 「Usage and pricing」).
 * ⚠️ 이 경로는 검색 도구를 **항상** 붙이므로, 횟수가 없으면 0 이 아니라 `null`(=미수집)이다.
 */
export function parseAnthropicUsage(body: unknown): {
  inputTokens: number | null;
  outputTokens: number | null;
  webSearchRequests: number | null;
} {
  const usage =
    body && typeof body === "object"
      ? (body as { usage?: Record<string, unknown> }).usage
      : undefined;
  const serverToolUse =
    usage && typeof usage.server_tool_use === "object"
      ? (usage.server_tool_use as Record<string, unknown> | null)
      : null;
  return {
    inputTokens: finiteNumberOrNull(usage?.input_tokens),
    outputTokens: finiteNumberOrNull(usage?.output_tokens),
    webSearchRequests: finiteNumberOrNull(serverToolUse?.web_search_requests),
  };
}

/**
 * `/v1/messages` 응답의 `stop_reason`(문자열). 없거나 문자열이 아니면 null.
 * `"max_tokens"` = 답이 토큰 상한에서 잘렸다는 뜻.
 */
export function parseAnthropicStopReason(body: unknown): string | null {
  const reason =
    body && typeof body === "object"
      ? (body as { stop_reason?: unknown }).stop_reason
      : undefined;
  return typeof reason === "string" ? reason : null;
}

/**
 * 웹검색 횟수 폴백 계산용: `content[]` 의 `server_tool_use` 블록 수.
 * content 가 배열이 아니면 null(미수집 — 0 으로 지어내지 않는다).
 */
export function countAnthropicServerToolUseBlocks(
  body: unknown
): number | null {
  const content =
    body && typeof body === "object"
      ? (body as { content?: unknown }).content
      : undefined;
  if (!Array.isArray(content)) {
    return null;
  }
  return content.filter(
    (b) =>
      typeof b === "object" &&
      b !== null &&
      (b as { type?: unknown }).type === "server_tool_use"
  ).length;
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
  return (
    Boolean(process.env.AI_GATEWAY_API_KEY) ||
    Boolean(process.env.VERCEL_OIDC_TOKEN)
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
//   perplexity → Agent API 키가 있으면 직접 호출(아래 어댑터), 없으면 Vercel Gateway.
// 어느 경로도 불가면 null(→ stub).
function resolveModel(engineId: GlobalEngineId): ResolvedModel | null {
  const letsur = LETSUR_ENGINES.has(engineId) ? getLetsurProvider() : null;
  if (letsur && (engineId === "chatgpt" || engineId === "claude")) {
    return {
      // 🔴 Letsur 불가(유닛 소진·만료·인증)면 같은 호출을 Gateway 로 명시적 폴백(letsur-fallback.ts).
      model: withLetsurFallback(letsur(LETSUR_MODEL_IDS[engineId]), {
        callSite: "engine",
        engineId,
        gatewayModelId: MODEL_DEFAULTS[engineId],
      }),
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
  // 🔴 차단기 열림(최근 Letsur 불가 확인) → Letsur 를 두드리지 않고 Gateway 웹검색으로 간다.
  if (isLetsurCircuitOpen()) {
    return await runClaudeSearchViaGateway(query, start, "circuit_open");
  }
  try {
    const res = await fetch(LETSUR_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "anthropic-version": "2023-06-01",
      },
      body: claudeSearchRequestBody(LETSUR_MODEL_IDS.claude, query),
      signal: query.signal,
    });
    // 🔴 Letsur 불가(유닛 소진·만료·인증) → **같은 웹검색 호출**을 Gateway `/v1/messages` 로.
    //   본문은 분류에만 쓰고 저장·로그하지 않는다(사용자 데이터가 섞일 수 있다).
    const unavailable = res.ok
      ? null
      : classifyLetsurUnavailable(res.status, await res.text());
    if (unavailable) {
      tripLetsurCircuit(unavailable, "engine.claude.web_search");
      return await runClaudeSearchViaGateway(query, start, unavailable);
    }
    if (!res.ok) {
      return null;
    }
    return buildClaudeSearchResponse(await res.json(), query, start, {});
  } catch (error) {
    if (isAbortError(error) || query.signal?.aborted) {
      throw error;
    }
    return null;
  }
}

// ⚠️ 알려진 문제(2026-10-09 시험): 운영 claude 요청은 max_tokens 1024 라 답의 67%(8/12)가
//   max_tokens 로 **잘린다**. 본문이 비어 있지 않아 빈 본문 폴백(buildClaudeSearchResponse null)도
//   작동하지 않는다. 이 요청을 바꾸면 점수가 바뀌므로 **운영 값은 건드리지 않는다**(새 엔진 세트에서 처리).
//   섀도 후보 claude-search-v1(api-search-v1.ts)이 같은 빌더를 4096 토큰으로 호출해 비교한다.
export function claudeSearchRequestBody(
  model: string,
  query: EngineQuery,
  options: { maxTokens?: number; maxUses?: number } = {}
): string {
  return JSON.stringify({
    model,
    max_tokens: options.maxTokens ?? CLAUDE_SEARCH_PROD_MAX_TOKENS,
    messages: [{ role: "user", content: query.prompt }],
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: options.maxUses ?? CLAUDE_SEARCH_MAX_USES,
      },
    ],
  });
}

/**
 * Letsur 불가 시 claude 웹검색을 **Vercel AI Gateway 의 Anthropic Messages 호환 API** 로 보낸다.
 *   공식 문서: https://vercel.com/docs/ai-gateway/sdks-and-apis/anthropic-messages-api/advanced
 *   (같은 `web_search_20250305` 서버툴 지원 · 2026-10-07 확인)
 * ⚠️ fetch 는 토큰을 직접 넣어야 한다 → AI_GATEWAY_API_KEY 또는 VERCEL_OIDC_TOKEN 이 env 에
 *   없으면 이 경로는 건너뛰고 `null`(→ 일반 경로 = Gateway 채팅·검색 없음, `searchUnavailable` 표시).
 */
async function runClaudeSearchViaGateway(
  query: EngineQuery,
  start: number,
  reason: LetsurFallbackReason
): Promise<EngineResponse | null> {
  const token =
    process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "";
  const ctx = { callSite: "engine.claude.web_search", engineId: "claude" };
  if (!token) {
    return null;
  }
  try {
    const res = await fetch(GATEWAY_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
      },
      body: claudeSearchRequestBody(MODEL_DEFAULTS.claude, query),
      signal: query.signal,
    });
    if (!res.ok) {
      logLetsurFallback(ctx, reason, "failed");
      return null;
    }
    const response = buildClaudeSearchResponse(await res.json(), query, start, {
      provider: "gateway",
      modelId: MODEL_DEFAULTS.claude,
      fallback: "gateway",
    });
    logLetsurFallback(ctx, reason, response ? "ok" : "failed");
    return response;
  } catch (error) {
    if (isAbortError(error) || query.signal?.aborted) {
      throw error;
    }
    logLetsurFallback(ctx, reason, "failed");
    return null;
  }
}

function buildClaudeSearchResponse(
  body: unknown,
  query: EngineQuery,
  start: number,
  route: Pick<EngineUsage, "fallback" | "modelId" | "provider">
): EngineResponse | null {
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
    // 🔴 웹검색 횟수까지 싣는다(원가모델 v2) — 검색료($10/1,000회)가 토큰과 **별도** 청구된다.
    usage: { ...parseAnthropicUsage(body), costModel: "token", ...route },
  };
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

interface PerplexityAgentResult {
  inputTokens: number | null;
  outputTokens: number | null;
  /** provider 가 계산해 준 이번 호출 총원가(USD) — `usage.cost.total_cost`. */
  providerCostUsd: number | null;
  sources: ReturnType<typeof mapProviderSources>;
  text: string;
  /** 웹검색 실행 횟수 — `usage.tool_calls_details.search_web.invocation`. 없으면 null. */
  webSearchRequests: number | null;
}

// Agent API 문서 예시의 도구 이름은 `search_web` 이다. 표기 흔들림에 대비해 `web_search` 도 본다.
const PERPLEXITY_SEARCH_TOOL_KEYS = ["search_web", "web_search"] as const;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Agent API `usage` 에서 원가 재료를 뽑는다.
 *   `usage.cost.total_cost`(USD) · `usage.tool_calls_details.<tool>.invocation`
 *   출처: https://docs.perplexity.ai/api-reference/agent-post (ResponsesUsage·ResponsesCost)
 */
function perplexityUsageCost(usage: Record<string, unknown> | undefined): {
  providerCostUsd: number | null;
  webSearchRequests: number | null;
} {
  const cost = asRecord(usage?.cost);
  const totalCost = cost?.total_cost;
  const details = asRecord(usage?.tool_calls_details);
  let webSearchRequests: number | null = null;
  for (const key of PERPLEXITY_SEARCH_TOOL_KEYS) {
    const invocation = asRecord(details?.[key])?.invocation;
    if (typeof invocation === "number" && Number.isFinite(invocation)) {
      webSearchRequests = (webSearchRequests ?? 0) + invocation;
    }
  }
  // 도구 상세는 왔는데 검색 키가 없으면 = 검색 0회(미수집이 아니다).
  if (webSearchRequests === null && details) {
    webSearchRequests = 0;
  }
  return {
    providerCostUsd:
      typeof totalCost === "number" &&
      Number.isFinite(totalCost) &&
      totalCost >= 0
        ? totalCost
        : null,
    webSearchRequests,
  };
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === "object"
  );
}

function agentSearchSources(
  output: Record<string, unknown>[]
): ReturnType<typeof mapProviderSources> {
  const sources = output
    .filter((item) => item.type === "search_results")
    .flatMap((item) => records(item.results))
    .map((result) => ({
      sourceType: "url",
      url: typeof result.url === "string" ? result.url : undefined,
      title: typeof result.title === "string" ? result.title : undefined,
    }));
  return mapProviderSources(sources);
}

function agentMessageText(output: Record<string, unknown>[]): string {
  return output
    .filter((item) => item.type === "message")
    .flatMap((item) => records(item.content))
    .filter(
      (content): content is Record<string, string> =>
        content.type === "output_text" && typeof content.text === "string"
    )
    .map((content) => content.text)
    .join("\n")
    .trim();
}

/** Parses the documented Agent API response and its actual search sources. */
export function parsePerplexityAgentResponse(
  body: unknown
): PerplexityAgentResult {
  if (!body || typeof body !== "object") {
    return {
      text: "",
      sources: [],
      inputTokens: null,
      outputTokens: null,
      providerCostUsd: null,
      webSearchRequests: null,
    };
  }
  const root = body as Record<string, unknown>;
  const output = records(root.output);
  const usage = root.usage as Record<string, unknown> | undefined;
  return {
    text:
      typeof root.output_text === "string"
        ? root.output_text.trim()
        : agentMessageText(output),
    sources: agentSearchSources(output),
    inputTokens:
      typeof usage?.input_tokens === "number" ? usage.input_tokens : null,
    outputTokens:
      typeof usage?.output_tokens === "number" ? usage.output_tokens : null,
    ...perplexityUsageCost(usage),
  };
}

function makePerplexityFailure(
  message: string,
  durationMs: number
): EngineResponse {
  return {
    engineId: "perplexity",
    rawResponse: "",
    brandMentioned: false,
    mentionPosition: null,
    mentionListSize: null,
    sentiment: null,
    citedSources: [],
    shareOfVoice: null,
    errorMessage: message,
    durationMs,
    isStub: false,
  };
}

async function runPerplexityAgent(
  query: EngineQuery,
  start: number
): Promise<EngineResponse | null> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(PERPLEXITY_AGENT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ preset: PERPLEXITY_PRESET, input: query.prompt }),
      signal: query.signal,
    });
    if (!response.ok) {
      const detail = (await response.text())
        .replaceAll(/\s+/g, " ")
        .slice(0, 500);
      return makePerplexityFailure(
        `Perplexity Agent API ${response.status}: ${detail || response.statusText}`,
        Date.now() - start
      );
    }

    const parsed = parsePerplexityAgentResponse(await response.json());
    if (!parsed.text) {
      return makePerplexityFailure(
        "Perplexity Agent API returned no answer text.",
        Date.now() - start
      );
    }
    const text = sanitizeEngineText(parsed.text);
    const mention = detectBrandMention(
      text,
      query.brandName,
      query.brandVariants
    );
    return {
      engineId: "perplexity",
      rawResponse: text,
      brandMentioned: mention.mentioned,
      ...mentionPositionFields(text, query.brandName, query.brandVariants),
      sentiment: estimateSentiment(text, query.brandName),
      citedSources: parsed.sources,
      shareOfVoice: estimateShareOfVoice(
        text,
        query.brandName,
        query.brandVariants
      ),
      errorMessage: null,
      durationMs: Date.now() - start,
      isStub: false,
      usage: {
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        // 원가모델 v2: provider 원가가 있으면 그걸 쓰고, 없으면 토큰+검색료로 계산한다.
        providerCostUsd: parsed.providerCostUsd,
        webSearchRequests: parsed.webSearchRequests,
        costModel: "token",
      },
    };
  } catch (error) {
    if (isAbortError(error) || query.signal?.aborted) {
      throw error;
    }
    logProviderFailure("perplexity", true, error);
    return makePerplexityFailure(
      error instanceof Error ? error.message : String(error),
      Date.now() - start
    );
  }
}

async function tryPerplexityAgent(
  engineId: GlobalEngineId,
  query: EngineQuery,
  start: number
): Promise<EngineResponse | null> {
  if (engineId !== "perplexity") {
    return null;
  }
  return await runPerplexityAgent(query, start);
}

async function tryDirectEngine(
  engineId: GlobalEngineId,
  query: EngineQuery,
  start: number
): Promise<EngineResponse | null> {
  const claudeResponse = await tryClaudeWebSearch(engineId, query, start);
  if (claudeResponse) {
    return claudeResponse;
  }
  return await tryPerplexityAgent(engineId, query, start);
}

function makeGatewayAdapter(engineId: GlobalEngineId): EngineAdapter {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: provider routing and failure handling stay at one adapter boundary.
  return async (query) => {
    const start = Date.now();

    const directResponse = await tryDirectEngine(engineId, query, start);
    if (directResponse) {
      return directResponse;
    }

    const resolved = resolveModel(engineId);
    if (!resolved) {
      return makeStubResponse(engineId, query.prompt, Date.now() - start);
    }
    const { model, useDirectProvider, tools } = resolved;

    try {
      if (query.signal?.aborted) {
        throw query.signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      const {
        providerMetadata,
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
        abortSignal: query.signal,
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
          costModel:
            engineId === "gemini" && useDirectProvider ? "free" : "token",
          ...gatewayRoute(engineId, useDirectProvider, providerMetadata),
        },
      };
    } catch (error) {
      if (isAbortError(error) || query.signal?.aborted) {
        throw error;
      }
      logProviderFailure(engineId, useDirectProvider, error);
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

/**
 * 이 호출이 실제로 Vercel AI Gateway 를 탔는지 → 원가(cost.ts)가 **실제 모델 단가**로 계산하게 한다.
 *   · Letsur→Gateway 폴백: `fallback: "gateway"` + Gateway 모델 슬러그.
 *     claude 웹검색 플래그가 켜져 있었다면 이 경로는 **검색 없는 채팅**이다 →
 *     `searchUnavailable: true` 로 남겨 「출처 0」을 「출처 없음」으로 오해하지 않게 한다.
 *   · 처음부터 Gateway 경로(직접 키 없음): `provider: "gateway"` + 기본 슬러그.
 *   · Letsur·Google 직접 호출: 아무것도 안 붙인다(기존 기록과 동일).
 */
function gatewayRoute(
  engineId: GlobalEngineId,
  useDirectProvider: boolean,
  providerMetadata: unknown
): Pick<
  EngineUsage,
  "fallback" | "modelId" | "provider" | "searchUnavailable"
> {
  const fallback = readGatewayFallback(providerMetadata);
  if (fallback) {
    return {
      provider: "gateway",
      modelId: fallback.modelId,
      fallback: "gateway",
      ...(engineId === "claude" && isClaudeWebSearchEnabled()
        ? { searchUnavailable: true }
        : {}),
    };
  }
  if (!useDirectProvider) {
    return { provider: "gateway", modelId: MODEL_DEFAULTS[engineId] };
  }
  return {};
}

function logProviderFailure(
  engineId: GlobalEngineId,
  useDirectProvider: boolean,
  error: unknown
): void {
  log.warn("audit.engine.provider_failure", {
    engineId,
    provider: useDirectProvider ? "direct" : "vercel-gateway",
    ...describeProviderError(error),
  });
}

export const chatgptAdapter: EngineAdapter = makeGatewayAdapter("chatgpt");

// ──────────────────────────────────────────────────────────────────
// 🔎 ChatGPT API + 웹검색(2026-10-07) — `CHATGPT_SOURCE=web` 일 때 **웹 수집 실패 폴백** 전용.
//
// 공식 근거(2026-10-07 확인):
//   · OpenAI Responses API 웹검색 = `tools: [{ type: "web_search" }]`, 답의 출처는
//     `output_text.annotations[].type === "url_citation"`.
//     https://developers.openai.com/api/docs/guides/tools-web-search
//   · 요금: 웹검색 $10 / 1,000회 + 검색 결과 토큰은 모델 입력 단가.
//     https://developers.openai.com/api/docs/pricing
//   · AI SDK `@ai-sdk/openai` 의 기본 모델 = Responses 모델(`createLanguageModel → createResponsesModel`,
//     설치본 3.0.54 dist 실측) → 기존 chatgpt 호출도 이미 Letsur `/v1/responses` 를 탄다.
//     웹검색은 `provider.tools.webSearch({})` 하나만 더 붙이면 된다(새 의존성 0).
//   · Vercel AI Gateway 도 OpenAI provider-executed 도구를 그대로 받는다
//     (`@ai-sdk/gateway` docs「Provider-Executed Tools」: `web_search: openai.tools.webSearch({})`).
// ⚠️ [확인필요] Letsur 가 `web_search` 도구를 OpenAI 로 그대로 넘기는지는 라이브로 확인 못 했다.
//   그래서 Letsur 가 **어떤 이유로든** 실패하면(불가 분류 여부와 무관) Gateway 로 한 번 더 간다.
// ──────────────────────────────────────────────────────────────────

const CHATGPT_SEARCH_TOOL = "web_search";

interface SearchAttempt {
  model: LanguageModel;
  route: Pick<EngineUsage, "fallback" | "modelId" | "provider">;
  tools: Record<string, unknown>;
  via: "letsur" | "gateway";
}

function chatgptSearchAttempts(): SearchAttempt[] {
  const attempts: SearchAttempt[] = [];
  const letsur = getLetsurProvider();
  const letsurUsable = Boolean(letsur) && !isLetsurCircuitOpen();
  if (letsur && letsurUsable) {
    attempts.push({
      via: "letsur",
      model: letsur(LETSUR_MODEL_IDS.chatgpt),
      tools: { [CHATGPT_SEARCH_TOOL]: letsur.tools.webSearch({}) },
      route: {},
    });
  }
  if (isGatewayFallbackAvailable()) {
    attempts.push({
      via: "gateway",
      model: gateway(MODEL_DEFAULTS.chatgpt),
      tools: { [CHATGPT_SEARCH_TOOL]: openai.tools.webSearch({}) },
      route: {
        provider: "gateway",
        modelId: MODEL_DEFAULTS.chatgpt,
        // Letsur 를 원래 경로로 쓸 수 있는 환경에서 Gateway 로 갔다면 폴백이다.
        ...(letsur ? { fallback: "gateway" as const } : {}),
      },
    });
  }
  return attempts;
}

/** 결과에서 provider 가 실행한 웹검색 호출 수. 못 세면 null(= 미수집, 0원 아님). */
export function countChatgptWebSearchCalls(
  content: unknown,
  sourceCount: number
): number | null {
  const parts = Array.isArray(content) ? content : [];
  const calls = parts.filter(
    (part) =>
      typeof part === "object" &&
      part !== null &&
      (part as { type?: unknown }).type === "tool-call" &&
      (part as { toolName?: unknown }).toolName === CHATGPT_SEARCH_TOOL
  ).length;
  if (calls === 0 && sourceCount > 0) {
    return null; // 출처는 있는데 호출 기록이 없다 → SDK 표현 차이. 횟수를 지어내지 않는다.
  }
  return calls;
}

async function runChatgptSearchAttempt(
  attempt: SearchAttempt,
  query: EngineQuery,
  start: number
): Promise<EngineResponse> {
  const result = await generateText({
    model: attempt.model,
    tools: attempt.tools as never,
    prompt: query.prompt,
    abortSignal: query.signal,
    ...(attempt.via === "gateway"
      ? {
          providerOptions: {
            gateway: {
              tags: [
                "findable",
                "engine:chatgpt",
                "chatgpt:api_fallback",
                `lang:${query.language}`,
              ],
            },
          },
        }
      : {}),
  });
  const text = sanitizeEngineText(result.text);
  if (text.length === 0) {
    throw new Error("chatgpt web_search: empty answer");
  }
  const citedSources = mapProviderSources(result.sources);
  const mention = detectBrandMention(
    text,
    query.brandName,
    query.brandVariants
  );
  return {
    engineId: "chatgpt",
    rawResponse: text,
    brandMentioned: mention.mentioned,
    ...mentionPositionFields(text, query.brandName, query.brandVariants),
    sentiment: estimateSentiment(text, query.brandName),
    // 🔴 provider 가 준 url_citation 만 신뢰한다(본문 URL 폴백 금지 — N-48).
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
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      costModel: "token",
      webSearchRequests: countChatgptWebSearchCalls(
        result.content,
        citedSources.length
      ),
      ...attempt.route,
    },
  };
}

const CHATGPT_SEARCH_CTX = {
  callSite: "engine.chatgpt.web_search",
  engineId: "chatgpt",
};

/** 실패한 시도를 기록하고 다음 Gateway 시도의 폴백 사유를 돌려준다. */
function noteSearchAttemptFailure(
  attempt: SearchAttempt,
  error: unknown,
  fallbackReason: LetsurFallbackReason | null
): LetsurFallbackReason | null {
  logProviderFailure("chatgpt", attempt.via === "letsur", error);
  if (attempt.via === "letsur") {
    const reason = letsurUnavailableReasonFromError(error);
    if (reason) {
      tripLetsurCircuit(reason, CHATGPT_SEARCH_CTX.callSite);
    }
    // 분류 안 된 실패(예: 도구 미지원 400)도 Gateway 로 한 번 더 간다.
    //   단 `ai.letsur.fallback` 로그는 「Letsur 불가」로 분류된 경우만 남긴다(사유를 지어내지 않는다).
    return reason;
  }
  if (fallbackReason) {
    logLetsurFallback(CHATGPT_SEARCH_CTX, fallbackReason, "failed");
  }
  return fallbackReason;
}

/**
 * ChatGPT 를 **API + 웹검색**으로 부른다. Letsur → (어떤 실패든) Gateway 순.
 * 절대 throw 하지 않는다(측정 마감 abort 제외) — 전부 실패하면 오류 응답.
 */
export const chatgptApiSearchAdapter: EngineAdapter = async (query) => {
  const start = Date.now();
  const attempts = chatgptSearchAttempts();
  if (attempts.length === 0) {
    return makeStubResponse("chatgpt", query.prompt, Date.now() - start);
  }
  let lastError: unknown = null;
  // Letsur 를 건너뛰었으면(차단기 열림) 그 사실이 폴백 사유다.
  let fallbackReason: LetsurFallbackReason | null =
    attempts[0]?.via === "gateway" && getLetsurProvider()
      ? "circuit_open"
      : null;
  for (const attempt of attempts) {
    try {
      const response = await runChatgptSearchAttempt(attempt, query, start);
      if (attempt.via === "gateway" && fallbackReason) {
        logLetsurFallback(CHATGPT_SEARCH_CTX, fallbackReason, "ok");
      }
      return response;
    } catch (error) {
      if (isAbortError(error) || query.signal?.aborted) {
        throw error;
      }
      fallbackReason = noteSearchAttemptFailure(attempt, error, fallbackReason);
      lastError = error;
    }
  }
  return {
    engineId: "chatgpt",
    rawResponse: "",
    brandMentioned: false,
    mentionPosition: null,
    mentionListSize: null,
    sentiment: null,
    citedSources: [],
    shareOfVoice: null,
    errorMessage:
      lastError instanceof Error ? lastError.message : String(lastError),
    durationMs: Date.now() - start,
    isStub: false,
  };
};
export const claudeAdapter: EngineAdapter = makeGatewayAdapter("claude");
export const perplexityAdapter: EngineAdapter =
  makeGatewayAdapter("perplexity");
export const geminiAdapter: EngineAdapter = makeGatewayAdapter("gemini");
