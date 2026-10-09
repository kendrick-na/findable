// api-search-v1 — 소비자 화면에 가까운 API 후보 엔진 2종 (섀도 전용 · 2026-10-09 · 1단계)
//
//   (A) ChatGPT-search 후보: LETSUR `/v1/responses` + `web_search` 도구 (모델 기본 gpt-6-luna)
//   (B) Gemini-search 후보 : Google `generateContent` + `google_search` 도구 **항상 on**
//   (C) Claude-search 후보 : LETSUR `/v1/messages` + `web_search_20250305` (모델 기본 claude-sonnet-5-5 · max_tokens 4096)
//       env FINDABLE_CLAUDE_MODEL_SEARCH · FINDABLE_CLAUDE_SEARCH_MAX_TOKENS(기본 4096, 1024~8192)
//
// 🔴 전부 기본 off. 아무 플래그도 안 켜면 이 파일의 코드는 **한 줄도 실행되지 않는다**(운영 동작 불변).
//   API_SEARCH_SHADOW=true  → chatgpt·gemini 질문마다 후보를 **메인과 동시에** 돌려 비교만 저장한다.
//   API_SEARCH_SHADOW_BRANDS → 허용 도메인(쉼표·공백 구분). **비어 있으면 아무도 안 돈다.**
//   API_SEARCH_TIMEOUT_MS (기본 90000) · API_SEARCH_SHADOW_GRACE_MS (기본 0 — 메인이 끝난 뒤 더 기다릴 시간)
//   FINDABLE_LETSUR_MODEL_CHATGPT_SEARCH (기본 gpt-6-luna) · FINDABLE_GEMINI_MODEL_SEARCH (기본 gemini-3.5-flash-lite)
//
// 🔴 결과는 chatgpt·gemini 행의 `shadowApiSearch` 에만 붙는다. 점수·집계·판정·PDF·비교키에 쓰지 않는다.
//   (이 파일은 1단계 — 비교키 변경은 2단계.) 허용 목록은 `EngineQuery.brandDomain` 으로만 판정한다
//   (queryAllEngines 가 브랜드 ID 를 모른다 → ID 형태 항목은 매칭되지 않는다).
//
// ⭐ 본문 URL 폴백 금지(N-48): 출처는 provider 가 준 `url_citation` / `groundingChunks` 만 쓴다.
// ⭐ 판정·집계 함수는 기존 것(detectBrandMention 등)을 재사용한다 — 같은 지표를 두 벌 만들지 않는다.

import { log } from "@repo/observability/log";
import {
  classifyLetsurUnavailable,
  isLetsurCircuitOpen,
  LETSUR_BASE_URL,
  tripLetsurCircuit,
} from "../letsur-fallback";
import { LETSUR_KRW_PER_UNIT } from "./cost";
import { API_SEARCH_ENGINE_SET } from "./engine-set";
import {
  CLAUDE_SEARCH_MAX_USES,
  claudeSearchRequestBody,
  countAnthropicServerToolUseBlocks,
  parseAnthropicMessages,
  parseAnthropicStopReason,
  parseAnthropicUsage,
} from "./global-adapters";
import { sanitizeEngineText } from "./sanitize";
import type {
  ApiSearchCandidate,
  ApiSearchShadow,
  EngineQuery,
  EngineResponse,
  EngineUsage,
} from "./types";
import {
  detectBrandMention,
  estimateSentiment,
  estimateShareOfVoice,
  mapProviderSources,
  mentionPositionFields,
} from "./utils";

// ──────────────────────────────────────────────────────────────────
// 플래그·허용 목록 (precedent: packages/audit/shadow-plan-v2.ts isShadowBrandAllowed)
// ──────────────────────────────────────────────────────────────────
type Env = Record<string, string | undefined>;

const LIST_SPLIT_RE = /[\s,]+/;
const DOMAIN_PREFIX_RE = /^(?:https?:\/\/)?(?:www\.)?/i;
const PATH_SUFFIX_RE = /\/.*$/;
const WWW_PREFIX_RE = /^www\./;

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(DOMAIN_PREFIX_RE, "")
    .replace(PATH_SUFFIX_RE, "");
}

export function isApiSearchShadowEnabled(env: Env = process.env): boolean {
  const raw = env.API_SEARCH_SHADOW?.trim().toLowerCase();
  return raw === "true" || raw === "1";
}

/** 허용 목록 — 쉼표·공백 구분. 비어 있으면 빈 배열(= 아무도 안 돈다). */
export function apiSearchShadowAllowlist(env: Env = process.env): string[] {
  return (env.API_SEARCH_SHADOW_BRANDS ?? "")
    .split(LIST_SPLIT_RE)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** 이 도메인이 섀도 허용 대상인가. 도메인이 없거나 목록이 비면 false. */
export function isApiSearchShadowAllowed(
  domain: string | undefined,
  env: Env = process.env
): boolean {
  if (!domain) {
    return false;
  }
  const list = apiSearchShadowAllowlist(env);
  if (list.length === 0) {
    return false;
  }
  const target = normalizeDomain(domain);
  return target.length > 0 && list.some((e) => normalizeDomain(e) === target);
}

function envMs(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const DEFAULT_API_SEARCH_TIMEOUT_MS = 90_000;
const SHADOW_TEXT_LIMIT = 8000;
const CHATGPT_SEARCH_DEFAULT_MODEL = "gpt-6-luna";
const GEMINI_SEARCH_DEFAULT_MODEL = "gemini-3.5-flash-lite";
const CLAUDE_SEARCH_DEFAULT_MODEL = "claude-sonnet-5-5";
const CLAUDE_SEARCH_DEFAULT_MAX_TOKENS = 4096;
const CLAUDE_SEARCH_MIN_MAX_TOKENS = 1024;
const CLAUDE_SEARCH_MAX_MAX_TOKENS = 8192;
const GOOGLE_GENERATE_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

export function chatgptSearchModel(): string {
  return (
    process.env.FINDABLE_LETSUR_MODEL_CHATGPT_SEARCH?.trim() ||
    CHATGPT_SEARCH_DEFAULT_MODEL
  );
}

// 🔴 gemini 판정 폴백(mention-verdict)이 읽는 FINDABLE_GEMINI_MODEL 과 **별개** 변수다.
export function geminiSearchModel(): string {
  return (
    process.env.FINDABLE_GEMINI_MODEL_SEARCH?.trim() ||
    GEMINI_SEARCH_DEFAULT_MODEL
  );
}

// 🔴 운영 claude 엔진이 읽는 FINDABLE_LETSUR_MODEL_CLAUDE 와 **별개** 변수다.
export function claudeSearchModel(): string {
  return (
    process.env.FINDABLE_CLAUDE_MODEL_SEARCH?.trim() ||
    CLAUDE_SEARCH_DEFAULT_MODEL
  );
}

/** 후보 max_tokens. 기본 4096, 1024~8192 로 clamp. 숫자가 아니면 기본값. */
export function claudeSearchMaxTokens(): number {
  const raw = process.env.FINDABLE_CLAUDE_SEARCH_MAX_TOKENS?.trim();
  const value = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) {
    return CLAUDE_SEARCH_DEFAULT_MAX_TOKENS;
  }
  return Math.min(
    CLAUDE_SEARCH_MAX_MAX_TOKENS,
    Math.max(CLAUDE_SEARCH_MIN_MAX_TOKENS, Math.floor(value))
  );
}

// ──────────────────────────────────────────────────────────────────
// 파서 (순수 함수)
// ──────────────────────────────────────────────────────────────────
type Rec = Record<string, unknown>;
interface ProviderSource {
  sourceType: string;
  title?: string;
  url?: string;
}

function asRec(value: unknown): Rec | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : undefined;
}

function recs(value: unknown): Rec[] {
  return Array.isArray(value)
    ? value.flatMap((v) => {
        const r = asRec(v);
        return r ? [r] : [];
      })
    : [];
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface ParsedOpenAiResponses {
  /** `estimated_cost` 가 `{amount, currency:"unit"}` 일 때의 amount(LETSUR unit = 정가 1 USD). 못 읽으면 null. */
  estimatedCostUnits: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  sources: ProviderSource[];
  text: string;
  /** output[] 의 web_search_call 개수. 파싱 불가(output 없음·출처만 있고 호출 기록 없음)면 null — 0 으로 지어내지 않는다. */
  webSearchRequests: number | null;
}

/** message 항목 하나 → 본문과 url_citation 출처. 본문 URL 폴백 없음(N-48). */
function readMessageItem(item: Rec): {
  sources: ProviderSource[];
  text: string;
} {
  const parts: string[] = [];
  const sources: ProviderSource[] = [];
  for (const content of recs(item.content)) {
    if (typeof content.text === "string") {
      parts.push(content.text);
    }
    for (const ann of recs(content.annotations)) {
      if (ann.type === "url_citation" && typeof ann.url === "string") {
        sources.push({
          sourceType: "url",
          url: ann.url,
          title: typeof ann.title === "string" ? ann.title : undefined,
        });
      }
    }
  }
  return { text: parts.join(""), sources };
}

/** `estimated_cost` 가 `{amount, currency:"unit"}` 일 때만 amount. 아니면 null. */
function readEstimatedCostUnits(value: unknown): number | null {
  const cost = asRec(value);
  if (cost?.currency !== "unit") {
    return null;
  }
  if (typeof cost.amount !== "string" && typeof cost.amount !== "number") {
    return null;
  }
  const amount = Number(cost.amount);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** OpenAI Responses(LETSUR 경유) 응답 본문 → 텍스트·출처·검색 횟수·토큰·원가. 절대 throw 하지 않는다. */
export function parseOpenAiResponses(body: unknown): ParsedOpenAiResponses {
  const root = asRec(body);
  const output = Array.isArray(root?.output) ? recs(root?.output) : null;
  const texts: string[] = [];
  const sources: ProviderSource[] = [];
  let searchCalls = 0;
  for (const item of output ?? []) {
    if (item.type === "web_search_call") {
      searchCalls += 1;
    } else if (item.type === "message") {
      const message = readMessageItem(item);
      texts.push(message.text);
      sources.push(...message.sources);
    }
  }
  const usage = asRec(root?.usage);
  // 호출 기록 없이 출처만 있다 = 표현 차이. 횟수를 지어내지 않는다(null = 미수집, 0원 아님).
  const countUnknown =
    output === null || (searchCalls === 0 && sources.length > 0);
  return {
    text: texts.join("\n").trim(),
    sources,
    webSearchRequests: countUnknown ? null : searchCalls,
    inputTokens: finiteOrNull(usage?.input_tokens),
    outputTokens: finiteOrNull(usage?.output_tokens),
    estimatedCostUnits: readEstimatedCostUnits(root?.estimated_cost),
  };
}

export interface ParsedClaudeMessages {
  /** 응답 루트 `estimated_cost`({amount, currency:"unit"})가 있을 때만. 없으면 null → 토큰 단가표로 계산한다. */
  estimatedCostUnits: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  sources: ProviderSource[];
  stopReason: string | null;
  text: string;
  /** stop_reason === "max_tokens". stop_reason 미수집이면 null. */
  truncated: boolean | null;
  /** usage.server_tool_use.web_search_requests → 없으면 server_tool_use 블록 수 → 파싱 불가면 null. */
  webSearchRequests: number | null;
}

/** Anthropic `/v1/messages`(LETSUR 경유) 응답 → 후보 저장용 값. 절대 throw 하지 않는다. */
export function parseClaudeSearchMessages(body: unknown): ParsedClaudeMessages {
  const { sources, text } = parseAnthropicMessages(body);
  const usage = parseAnthropicUsage(body);
  const stopReason = parseAnthropicStopReason(body);
  return {
    text,
    sources,
    stopReason,
    truncated: stopReason === null ? null : stopReason === "max_tokens",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    webSearchRequests:
      usage.webSearchRequests ?? countAnthropicServerToolUseBlocks(body),
    estimatedCostUnits: readEstimatedCostUnits(asRec(body)?.estimated_cost),
  };
}

export interface ParsedGeminiGenerate {
  inputTokens: number | null;
  outputTokens: number | null;
  sources: ProviderSource[];
  text: string;
  /** groundingMetadata.webSearchQueries.length. 메타데이터가 없거나 배열이 아니면 null(미수집). */
  webSearchRequests: number | null;
}

/** Gemini generateContent 응답 본문 → 텍스트·출처·검색 쿼리 수·토큰. 절대 throw 하지 않는다. */
export function parseGeminiGenerate(body: unknown): ParsedGeminiGenerate {
  const root = asRec(body);
  const candidate = recs(root?.candidates)[0];
  const parts = recs(asRec(candidate?.content)?.parts);
  // 생각(thought) 파트는 답이 아니다.
  const text = parts
    .filter((p) => p.thought !== true && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("")
    .trim();
  const grounding = asRec(candidate?.groundingMetadata);
  const sources: ProviderSource[] = [];
  for (const chunk of recs(grounding?.groundingChunks)) {
    const web = asRec(chunk.web);
    if (web && typeof web.uri === "string") {
      sources.push({
        sourceType: "url",
        url: web.uri,
        title: typeof web.title === "string" ? web.title : undefined,
      });
    }
  }
  const queries = grounding?.webSearchQueries;
  const meta = asRec(root?.usageMetadata);
  const prompt = finiteOrNull(meta?.promptTokenCount);
  const cand = finiteOrNull(meta?.candidatesTokenCount);
  const thoughts = finiteOrNull(meta?.thoughtsTokenCount);
  return {
    text,
    sources,
    webSearchRequests: Array.isArray(queries) ? queries.length : null,
    inputTokens: prompt,
    outputTokens:
      cand === null && thoughts === null ? null : (cand ?? 0) + (thoughts ?? 0),
  };
}

// ──────────────────────────────────────────────────────────────────
// 호출 (fetch 직접 · 절대 throw 하지 않는다)
// ──────────────────────────────────────────────────────────────────
function failure(
  engineId: "chatgpt" | "gemini" | "claude",
  message: string,
  start: number
): EngineResponse {
  return {
    engineId,
    rawResponse: "",
    brandMentioned: false,
    mentionPosition: null,
    mentionListSize: null,
    sentiment: null,
    citedSources: [],
    shareOfVoice: null,
    errorMessage: message,
    durationMs: Date.now() - start,
    isStub: false,
  };
}

function success(
  engineId: "chatgpt" | "gemini" | "claude",
  rawText: string,
  sources: ProviderSource[],
  query: EngineQuery,
  start: number,
  usage: EngineUsage
): EngineResponse {
  const text = sanitizeEngineText(rawText);
  const mention = detectBrandMention(
    text,
    query.brandName,
    query.brandVariants
  );
  return {
    engineId,
    rawResponse: text,
    brandMentioned: mention.mentioned,
    ...mentionPositionFields(text, query.brandName, query.brandVariants),
    sentiment: estimateSentiment(text, query.brandName),
    // 🔴 provider 가 준 출처만(N-48).
    citedSources: mapProviderSources(sources),
    shareOfVoice: estimateShareOfVoice(
      text,
      query.brandName,
      query.brandVariants
    ),
    errorMessage: null,
    durationMs: Date.now() - start,
    isStub: false,
    usage,
  };
}

interface TimedSignal {
  cleanup: () => void;
  signal: AbortSignal;
  timedOut: () => boolean;
}

/** 부모 signal(측정 마감·섀도 중단) + 후보 자체 상한을 하나의 signal 로. */
function timedSignal(parent: AbortSignal | undefined, ms: number): TimedSignal {
  const controller = new AbortController();
  let timedOutFlag = false;
  const onParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    controller.abort(parent.reason);
  } else {
    parent?.addEventListener("abort", onParent, { once: true });
  }
  const timer = setTimeout(() => {
    timedOutFlag = true;
    controller.abort(new DOMException("api-search timeout", "TimeoutError"));
  }, ms);
  timer.unref?.();
  return {
    signal: controller.signal,
    timedOut: () => timedOutFlag,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
    },
  };
}

// 2026-10-09 시험(비화장품 56·뷰티 60문항): 지시문이 없으면 후보 답이 소비자 화면보다 짧아(평균 620자 vs
// 1,045자) 이름 없는 비교형 질문에서 누락된다. 이 지시문(대표 브랜드 3~5개 비교 소개)을 주면 길이가
// 소비자 수준(1,100~1,300자)이 되고 화면 일치율이 비화장품 82→91%, 뷰티 97% 유지(재현율 96~100%).
// 소비자 화면에는 없는 시스템 지시라 「소비자 기본값 그대로」가 아니라 「화면 답변 스타일 보정」이다.
// env FINDABLE_CHATGPT_SEARCH_INSTRUCTIONS 로 덮어쓰거나 "off" 로 끈다.
const DEFAULT_CHATGPT_SEARCH_INSTRUCTIONS =
  "한국어로 답해. 사용자가 묻는 주제에 대해 대표적인 서비스·브랜드를 3~5개 골라 각각 특징과 함께 구체적으로 비교해서 소개해.";

function chatgptSearchInstructions(): string | null {
  const raw = process.env.FINDABLE_CHATGPT_SEARCH_INSTRUCTIONS?.trim();
  if (raw?.toLowerCase() === "off") {
    return null;
  }
  return raw || DEFAULT_CHATGPT_SEARCH_INSTRUCTIONS;
}

function chatgptSearchBody(model: string, query: EngineQuery): string {
  const instructions =
    query.language === "en" ? null : chatgptSearchInstructions();
  return JSON.stringify({
    model,
    input: query.prompt,
    ...(instructions ? { instructions } : {}),
    tools: [
      {
        type: "web_search",
        user_location: {
          type: "approximate",
          country: query.language === "en" ? "US" : "KR",
        },
      },
    ],
  });
}

/**
 * (A) ChatGPT-search 후보 1회 호출. LETSUR `/v1/responses` 직접 fetch(claude `/v1/messages` 선례).
 * 오류는 `[api-search:*]` 접두어 errorMessage 로 돌려준다(본문·키는 싣지 않는다).
 */
export async function runChatgptSearchCandidate(
  query: EngineQuery,
  options: { timeoutMs?: number } = {}
): Promise<EngineResponse> {
  const start = Date.now();
  const apiKey = process.env.LETSUR_API_KEY;
  if (!apiKey) {
    return failure("chatgpt", "[api-search:not_configured]", start);
  }
  if (isLetsurCircuitOpen()) {
    return failure("chatgpt", "[api-search:circuit_open]", start);
  }
  const model = chatgptSearchModel();
  const timed = timedSignal(
    query.signal,
    options.timeoutMs ??
      envMs("API_SEARCH_TIMEOUT_MS", DEFAULT_API_SEARCH_TIMEOUT_MS)
  );
  try {
    const res = await fetch(`${LETSUR_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: chatgptSearchBody(model, query),
      signal: timed.signal,
    });
    if (!res.ok) {
      // 본문은 분류에만 쓰고 저장·로그하지 않는다(사용자 데이터가 섞일 수 있다).
      const unavailable = classifyLetsurUnavailable(
        res.status,
        await res.text()
      );
      if (unavailable) {
        tripLetsurCircuit(unavailable, "engine.api_search.chatgpt");
      }
      return failure("chatgpt", `[api-search:http_${res.status}]`, start);
    }
    const parsed = parseOpenAiResponses(await res.json());
    if (parsed.text.length === 0) {
      return failure("chatgpt", "[api-search:empty_answer]", start);
    }
    const units = parsed.estimatedCostUnits;
    return success("chatgpt", parsed.text, parsed.sources, query, start, {
      costModel: "token",
      modelId: model,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      webSearchRequests: parsed.webSearchRequests,
      // LETSUR unit = 정가 USD 동액. 원화 청구 환산은 1,525원/unit(cost.ts 주석 — USD_TO_KRW 1380 과 의도적으로 다름).
      providerCostUsd: units,
      providerCostKrw: units === null ? null : units * LETSUR_KRW_PER_UNIT,
    });
  } catch (error) {
    if (timed.timedOut()) {
      return failure("chatgpt", "[api-search:timeout]", start);
    }
    if (query.signal?.aborted) {
      return failure("chatgpt", "[api-search:aborted]", start);
    }
    log.warn("engine.api_search.chatgpt_failure", {
      kind: error instanceof Error ? error.name : "unknown",
    });
    return failure("chatgpt", "[api-search:network]", start);
  } finally {
    timed.cleanup();
  }
}

/**
 * (B) Gemini-search 후보 1회 호출. Google 직접 generateContent + google_search **항상 on**
 * (FINDABLE_ENGINE_GROUNDING 과 무관).
 */
export async function runGeminiSearchCandidate(
  query: EngineQuery,
  options: { timeoutMs?: number } = {}
): Promise<EngineResponse> {
  const start = Date.now();
  // 그림자 전용 유료 키를 우선(GOOGLE_API_KEY_SEARCH). 없으면 기존 키. 무료 티어 키는
  // 약관상 입력·출력이 제품 개선에 쓰일 수 있어 고객 데이터를 보내는 용도로는 쓰지 않는다.
  const apiKey =
    process.env.GOOGLE_API_KEY_SEARCH?.trim() || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return failure("gemini", "[api-search:not_configured]", start);
  }
  const model = geminiSearchModel();
  const timed = timedSignal(
    query.signal,
    options.timeoutMs ??
      envMs("API_SEARCH_TIMEOUT_MS", DEFAULT_API_SEARCH_TIMEOUT_MS)
  );
  try {
    const res = await fetch(
      `${GOOGLE_GENERATE_BASE}/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: query.prompt }] }],
          tools: [{ google_search: {} }],
        }),
        signal: timed.signal,
      }
    );
    if (!res.ok) {
      return failure("gemini", `[api-search:http_${res.status}]`, start);
    }
    const parsed = parseGeminiGenerate(await res.json());
    if (parsed.text.length === 0) {
      return failure("gemini", "[api-search:empty_answer]", start);
    }
    return success("gemini", parsed.text, parsed.sources, query, start, {
      costModel: "token",
      modelId: model,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      webSearchRequests: parsed.webSearchRequests,
    });
  } catch (error) {
    if (timed.timedOut()) {
      return failure("gemini", "[api-search:timeout]", start);
    }
    if (query.signal?.aborted) {
      return failure("gemini", "[api-search:aborted]", start);
    }
    log.warn("engine.api_search.gemini_failure", {
      kind: error instanceof Error ? error.name : "unknown",
    });
    return failure("gemini", "[api-search:network]", start);
  } finally {
    timed.cleanup();
  }
}

/**
 * (C) Claude-search 후보 1회 호출. LETSUR `/v1/messages`(Anthropic 네이티브) 직접 fetch.
 * 요청 빌더·파서는 운영 claude 경로(global-adapters)와 **같은 함수**를 쓰고, 모델·max_tokens 만 다르다.
 * 🔴 Gateway 폴백 없음 — 후보가 Gateway 크레딧을 쓰면 안 된다. 실패하면 실패로 기록만 한다.
 */
export async function runClaudeSearchCandidate(
  query: EngineQuery,
  options: { timeoutMs?: number } = {}
): Promise<EngineResponse> {
  const start = Date.now();
  const apiKey = process.env.LETSUR_API_KEY;
  if (!apiKey) {
    return failure("claude", "[api-search:not_configured]", start);
  }
  if (isLetsurCircuitOpen()) {
    return failure("claude", "[api-search:circuit_open]", start);
  }
  const model = claudeSearchModel();
  const timed = timedSignal(
    query.signal,
    options.timeoutMs ??
      envMs("API_SEARCH_TIMEOUT_MS", DEFAULT_API_SEARCH_TIMEOUT_MS)
  );
  try {
    const res = await fetch(`${LETSUR_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "anthropic-version": "2023-06-01",
      },
      body: claudeSearchRequestBody(model, query, {
        maxTokens: claudeSearchMaxTokens(),
        maxUses: CLAUDE_SEARCH_MAX_USES,
      }),
      signal: timed.signal,
    });
    if (!res.ok) {
      const unavailable = classifyLetsurUnavailable(
        res.status,
        await res.text()
      );
      if (unavailable) {
        tripLetsurCircuit(unavailable, "engine.api_search.claude");
      }
      return failure("claude", `[api-search:http_${res.status}]`, start);
    }
    const parsed = parseClaudeSearchMessages(await res.json());
    if (parsed.text.length === 0) {
      return failure("claude", "[api-search:empty_answer]", start);
    }
    const units = parsed.estimatedCostUnits;
    return success("claude", parsed.text, parsed.sources, query, start, {
      costModel: "token",
      modelId: model,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      webSearchRequests: parsed.webSearchRequests,
      stopReason: parsed.stopReason,
      // provider 가 원가를 주면 그 값(없으면 cost.ts 가 토큰 단가표로 계산 · [확인필요]).
      ...(units === null
        ? {}
        : {
            providerCostUsd: units,
            providerCostKrw: units * LETSUR_KRW_PER_UNIT,
          }),
    });
  } catch (error) {
    if (timed.timedOut()) {
      return failure("claude", "[api-search:timeout]", start);
    }
    if (query.signal?.aborted) {
      return failure("claude", "[api-search:aborted]", start);
    }
    log.warn("engine.api_search.claude_failure", {
      kind: error instanceof Error ? error.name : "unknown",
    });
    return failure("claude", "[api-search:network]", start);
  } finally {
    timed.cleanup();
  }
}

// ──────────────────────────────────────────────────────────────────
// 섀도 핸들 (precedent: chatgpt-source.ts startChatgptWebShadow)
// ──────────────────────────────────────────────────────────────────
function domainSet(r: { citedSources: { domain: string }[] }): Set<string> {
  return new Set(
    r.citedSources
      .map((s) => s.domain.toLowerCase().replace(WWW_PREFIX_RE, ""))
      .filter((d) => d.length > 0)
  );
}

function overlap(a: EngineResponse, b: EngineResponse): number | null {
  const left = domainSet(a);
  const right = domainSet(b);
  const union = new Set([...left, ...right]);
  if (union.size === 0) {
    return null;
  }
  let shared = 0;
  for (const d of left) {
    if (right.has(d)) {
      shared += 1;
    }
  }
  return Math.round((shared / union.size) * 1000) / 1000;
}

const CANDIDATE_MODEL: Record<ApiSearchCandidate, () => string> = {
  "chatgpt-search-v1": chatgptSearchModel,
  "gemini-search-v1": geminiSearchModel,
  "claude-search-v1": claudeSearchModel,
};

function toApiSearchShadow(
  candidate: ApiSearchCandidate,
  result: EngineResponse,
  main: EngineResponse | undefined
): ApiSearchShadow {
  const ok = !(result.errorMessage || result.isStub);
  const mainOk = Boolean(main && !(main.errorMessage || main.isStub));
  return {
    candidate,
    model: result.usage?.modelId ?? CANDIDATE_MODEL[candidate](),
    outcome: ok ? "ok" : "failed",
    text: ok ? result.rawResponse.slice(0, SHADOW_TEXT_LIMIT) : "",
    citations: ok ? result.citedSources : [],
    brandMentioned: ok ? result.brandMentioned : null,
    durationMs: result.durationMs,
    error: ok ? null : (result.errorMessage ?? "[api-search:other]"),
    ...(ok && result.usage ? { usage: result.usage } : {}),
    ...(ok && candidate === "claude-search-v1"
      ? {
          stopReason: result.usage?.stopReason ?? null,
          truncated:
            result.usage?.stopReason == null
              ? null
              : result.usage.stopReason === "max_tokens",
        }
      : {}),
    comparison:
      ok && main && mainOk
        ? {
            mentionAgreement: result.brandMentioned === main.brandMentioned,
            citationOverlap: overlap(result, main),
          }
        : null,
  };
}

export interface ApiSearchShadowHandle {
  /** 메인 배치가 끝난 뒤 호출. grace 안에 끝나면 결과, 아니면 중단하고 skipped_budget. */
  finish(main: EngineResponse | undefined): Promise<ApiSearchShadow>;
}

type CandidateRunner = (
  query: EngineQuery,
  options: { timeoutMs?: number }
) => Promise<EngineResponse>;

const CANDIDATE_RUNNERS: Record<ApiSearchCandidate, CandidateRunner> = {
  "chatgpt-search-v1": (q, o) => runChatgptSearchCandidate(q, o),
  "gemini-search-v1": (q, o) => runGeminiSearchCandidate(q, o),
  "claude-search-v1": (q, o) => runClaudeSearchCandidate(q, o),
};

const CANDIDATE_ENGINE: Record<
  ApiSearchCandidate,
  "chatgpt" | "gemini" | "claude"
> = {
  "chatgpt-search-v1": "chatgpt",
  "gemini-search-v1": "gemini",
  "claude-search-v1": "claude",
};

/**
 * 후보 섀도를 **메인 배치와 동시에** 시작한다. 절대 throw 하지 않는다.
 * 🔴 메인을 늦추지 않는다 — 메인이 끝나면 grace(기본 0ms)만 더 기다리고 끊는다.
 */
export function startApiSearchShadow(
  base: Omit<EngineQuery, "engineId">,
  candidate: ApiSearchCandidate,
  run: CandidateRunner = CANDIDATE_RUNNERS[candidate]
): ApiSearchShadowHandle {
  const started = Date.now();
  const engineId = CANDIDATE_ENGINE[candidate];
  const controller = new AbortController();
  const parent = base.signal;
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    controller.abort(parent.reason);
  } else {
    parent?.addEventListener("abort", onParentAbort, { once: true });
  }
  const running: Promise<EngineResponse | null> = (async () => {
    try {
      return await run(
        { ...base, engineId, signal: controller.signal },
        {
          timeoutMs: envMs(
            "API_SEARCH_TIMEOUT_MS",
            DEFAULT_API_SEARCH_TIMEOUT_MS
          ),
        }
      );
    } catch {
      return null;
    }
  })();

  return {
    async finish(main) {
      const graceMs = envMs("API_SEARCH_SHADOW_GRACE_MS", 0);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"late">((resolve) => {
        timer = setTimeout(() => resolve("late"), graceMs);
        timer.unref?.();
      });
      const settled = await Promise.race([running, late]);
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
      let shadow: ApiSearchShadow;
      if (settled === "late" || settled === null) {
        const crashed = settled === null && !controller.signal.aborted;
        controller.abort(
          new DOMException("api-search shadow budget", "AbortError")
        );
        // 끊긴 호출의 실제 과금은 알 수 없다 → usage 를 남기지 않는다([확인필요], 원가 항목 없음).
        shadow = {
          candidate,
          model: CANDIDATE_MODEL[candidate](),
          outcome: crashed ? "failed" : "skipped_budget",
          text: "",
          citations: [],
          brandMentioned: null,
          durationMs: Date.now() - started,
          error: crashed
            ? "[api-search:other] shadow crashed"
            : "[api-search:skipped_budget] 메인 배치가 먼저 끝나 섀도를 중단함",
          comparison: null,
        };
      } else {
        shadow = toApiSearchShadow(candidate, settled, main);
      }
      log.info("engine.api_search.shadow", {
        candidate,
        model: shadow.model,
        outcome: shadow.outcome,
        error: shadow.error?.split(" ")[0] ?? null,
        durationMs: shadow.durationMs,
        mainMentioned: main ? main.brandMentioned : null,
        shadowMentioned: shadow.brandMentioned,
        mentionAgreement: shadow.comparison?.mentionAgreement ?? null,
        citationOverlap: shadow.comparison?.citationOverlap ?? null,
        shadowCitations: shadow.citations.length,
        webSearchRequests: shadow.usage?.webSearchRequests ?? null,
        truncated: shadow.truncated ?? null,
      });
      return shadow;
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// 메인(점수) 엔진 경로 — FINDABLE_ENGINE_SET=api-search-v1 (3단계 · 2026-10-10)
// ──────────────────────────────────────────────────────────────────
type MainEngineId = "chatgpt" | "gemini" | "claude";

const MAIN_RUNNERS: Record<MainEngineId, CandidateRunner> = {
  chatgpt: (q, o) => runChatgptSearchCandidate(q, o),
  gemini: (q, o) => runGeminiSearchCandidate(q, o),
  claude: (q, o) => runClaudeSearchCandidate(q, o),
};

/** 메인 세트가 대신하는 엔진인가. */
export function isApiSearchMainEngine(
  engineId: string
): engineId is MainEngineId {
  return (
    engineId === "chatgpt" || engineId === "gemini" || engineId === "claude"
  );
}

/**
 * 행(성공·실패 모두)에 세트 표식을 붙인다 — 비교키·원가가 이 값을 읽는다.
 * 실패 행도 표식이 있어야 회차가 「혼재」로 오판되지 않는다.
 */
export function withApiSearchEngineSet(res: EngineResponse): EngineResponse {
  return {
    ...res,
    usage: {
      costModel: "token",
      inputTokens: null,
      outputTokens: null,
      ...res.usage,
      engineSet: API_SEARCH_ENGINE_SET,
    },
  };
}

/**
 * 메인 chatgpt·gemini·claude 어댑터의 api-search-v1 경로. 후보 실행기를 그대로 재사용하되 결과를
 * 점수 행으로 쓴다(출처 → citedSources · usage·원가 · 세트 표식). 절대 throw 하지 않는다.
 * 🔴 실패해도 옛 모델로 조용히 폴백하지 않는다 — `[api-search:*]` 오류 행으로 남긴다
 *   (LETSUR 회로 차단기는 실행기가 존중한다).
 */
export async function runApiSearchMainEngine(
  query: EngineQuery
): Promise<EngineResponse> {
  const start = Date.now();
  if (!isApiSearchMainEngine(query.engineId)) {
    return withApiSearchEngineSet(
      failure("chatgpt", "[api-search:unsupported_engine]", start)
    );
  }
  try {
    return withApiSearchEngineSet(
      await MAIN_RUNNERS[query.engineId](query, {})
    );
  } catch {
    return withApiSearchEngineSet(
      failure(query.engineId, "[api-search:other]", start)
    );
  }
}
