// Google AI Overviews(AIO) 측정 어댑터 — AEO 레인 시범(2026-10-07 대표 승인 · 무료 범위)
//
// 무엇을 하나: 질문 1개를 Bright Data SERP API 로 구글 검색해, 검색 결과 맨 위의 「AI 개요」가
//   떴는지(shown / not_shown / failed), 그 본문, 인용 출처(url·domain·title)를 꺼낸다.
//
// ⛔ 경계(반드시 지킬 것)
//   · 이 결과는 GEO 점수·추세·Tracking 에 넣지 않는다(5레인 결정: SEO/AEO/GEO/LLMO/NEO 중 AEO).
//     그래서 EngineId 에도 넣지 않았다(엔진 목록·점수 분모에 섞이지 않게).
//   · AI 개요 본문을 **어떤 LLM 에도 넣지 않는다**(구글 콘텐츠 — 약관 회색지대). 판정은 규칙만.
//   · 절대 throw 하지 않는다. 실패는 status "failed" + failure.kind 로 돌려준다.
//   · 오류 응답 본문·API 키를 로그·결과에 남기지 않는다(HTTP 상태 코드만).
//
// 요청 형식 [확인사실 — 공식 문서 2026-10-07 확인]
//   POST https://api.brightdata.com/request
//   Authorization: Bearer <API_KEY>, Content-Type: application/json
//   body = { zone, url: "https://www.google.com/search?q=...&brd_ai_overview=2", format: "raw" }
//     출처: https://docs.brightdata.com/api-reference/serp/google-search/ai-overview
//   · brd_json=1 → 파싱된 JSON SERP 로 받는다.
//   · brd_ai_overview=2 → AI 개요 수집 확률을 높인다(브라우저 렌더 · 지연 +5~10초).
//   · gl(국가)·hl(언어) 두 글자 코드.
//     출처: https://docs.brightdata.com/scraping-automation/serp-api/query-parameters/google
//   · 응답 ai_overview = { texts: [{type, snippet, title?, reference_indexes, list?: [...]}],
//                          references: [{href, title, source, index}] }
//     출처: https://docs.brightdata.com/api-reference/serp/google-search/ai-overview
//            https://docs.brightdata.com/products/serp-api/parsed-json-results
//
// 원가 [확인사실 — 2026-10-07]: 무료 5,000건/월(카드 없음), 이후 $1.5/1,000건, 「성공 건만 과금」.
//   출처: https://brightdata.com/pricing/serp ·
//         https://docs.brightdata.com/scraping-automation/serp-api/introduction
//   → 성공(HTTP 2xx) 1건 = 1크레딧. 무료 범위 안이면 basis "free_tier"(청구 0원) + 정가 환산 추정치.

import { USD_TO_KRW } from "./cost";
import { detectBrandMention } from "./utils";

export type AioMarket = "KR" | "US";
export type AioStatus = "shown" | "not_shown" | "failed";
export type AioFailureKind =
  | "not_configured"
  | "timeout"
  | "aborted"
  | "network"
  | "http_auth"
  | "http_rate_limit"
  | "http_client"
  | "http_server"
  | "parse"
  /** HTTP 200 이지만 x-brd-status-code 가 2xx 가 아니거나 본문이 빔(구글 쪽 수집 실패 · 비과금). */
  | "upstream";

export const BRIGHTDATA_REQUEST_ENDPOINT = "https://api.brightdata.com/request";
/** 공식가 $1.5 / 1,000건(무료 범위를 넘은 뒤). */
export const BRIGHTDATA_SERP_USD_PER_1K = 1.5;
/**
 * AI 개요 렌더는 공식 문서상 +5~10초지만, 실측(2026-10-07 스모크)은 응답 18~36초,
 * 45초 상한에서 끊긴 사례가 있었다 → 60초.
 */
export const GOOGLE_AIO_TIMEOUT_MS = 60_000;
/** 저장 본문 상한(전문 보관 아님 — 길이·언급 판정 근거만). */
export const AIO_TEXT_MAX_CHARS = 4000;
const MAX_CITATIONS = 30;

export interface AioCitation {
  domain: string;
  /** Bright Data references[].source (출처 사이트 표시명). */
  source?: string;
  title?: string;
  url: string;
}

export interface AioCost {
  basis: "free_tier" | "paid";
  /** 실제 청구 추정(무료 범위면 0). */
  billedKrw: number;
  /** 성공 1건 = 1. 실패(비과금)는 0. */
  credits: number;
  /** 정가($1.5/1k) 환산 추정 — 무료 범위여도 참고값으로 남긴다. */
  listPriceKrw: number;
}

export interface GoogleAioResult {
  citations: AioCitation[];
  cost: AioCost;
  failure?: { httpStatus?: number; kind: AioFailureKind };
  latencyMs: number;
  market: AioMarket;
  query: string;
  status: AioStatus;
  /** AI 개요 본문(규칙 판정용 · 최대 AIO_TEXT_MAX_CHARS). 안 떴으면 "". */
  text: string;
  /** 자르기 전 본문 길이. */
  textLength: number;
}

const MARKET_PARAMS: Record<
  AioMarket,
  { gl: string; hl: string; host: string }
> = {
  KR: { host: "www.google.co.kr", gl: "kr", hl: "ko" },
  US: { host: "www.google.com", gl: "us", hl: "en" },
};

/** 질문 → 구글 검색 URL(q 가 맨 앞 — 공식 문서 「q must appear before other parameters」). */
export function buildGoogleAioSearchUrl(
  query: string,
  market: AioMarket
): string {
  const m = MARKET_PARAMS[market];
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("gl", m.gl);
  params.set("hl", m.hl);
  params.set("brd_ai_overview", "2");
  params.set("brd_json", "1");
  return `https://${m.host}/search?${params.toString()}`;
}

// ── 파싱(순수) ──────────────────────────────────────────────────────
type JsonRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is JsonRecord =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

const WWW_PREFIX_RE = /^www\./;
const DOMAIN_PREFIX_RE = /^(?:https?:\/\/)?(?:www\.)?/i;
const PATH_SUFFIX_RE = /\/.*$/;

/** URL → 호스트(www. 제거, 소문자). 잘못된 URL 은 null. */
export function aioDomainOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(WWW_PREFIX_RE, "");
    return host || null;
  } catch {
    return null;
  }
}

/** 텍스트 블록(문단·목록, 중첩 list 포함)을 줄 단위로 편다. */
function flattenTexts(blocks: unknown, out: string[], depth = 0): void {
  if (!Array.isArray(blocks) || depth > 4) {
    return;
  }
  for (const block of blocks) {
    if (!isRecord(block)) {
      continue;
    }
    const title = str(block.title);
    const snippet = str(block.snippet);
    if (title) {
      out.push(title);
    }
    if (snippet) {
      out.push(snippet);
    }
    flattenTexts(block.list, out, depth + 1);
  }
}

export interface ParsedAiOverview {
  citations: AioCitation[];
  present: boolean;
  text: string;
}

/** references[] 한 항목 → 인용(url 이 없거나 깨졌으면 null). */
function citationOf(ref: unknown): AioCitation | null {
  if (!isRecord(ref)) {
    return null;
  }
  const url = str(ref.href) ?? str(ref.url) ?? str(ref.link);
  const domain = url ? aioDomainOf(url) : null;
  if (!(url && domain)) {
    return null;
  }
  const title = str(ref.title);
  const source = str(ref.source);
  return {
    url,
    domain,
    ...(title ? { title } : {}),
    ...(source ? { source } : {}),
  };
}

/**
 * Bright Data 파싱 JSON(brd_json=1) → AI 개요. ai_overview 가 없거나 본문·출처가 모두 비면 present=false.
 * 순수 함수 — 테스트는 fixture JSON 으로만 돈다.
 */
export function parseGoogleAiOverview(body: unknown): ParsedAiOverview {
  const aio = isRecord(body) ? body.ai_overview : undefined;
  if (!isRecord(aio)) {
    return { present: false, text: "", citations: [] };
  }
  const lines: string[] = [];
  flattenTexts(aio.texts, lines);
  const text = lines.join("\n");
  const seen = new Set<string>();
  const citations: AioCitation[] = [];
  for (const ref of Array.isArray(aio.references) ? aio.references : []) {
    const citation = citationOf(ref);
    if (!citation || seen.has(citation.url)) {
      continue;
    }
    seen.add(citation.url);
    citations.push(citation);
    if (citations.length >= MAX_CITATIONS) {
      break;
    }
  }
  return {
    present: text.length > 0 || citations.length > 0,
    text,
    citations,
  };
}

// ── 규칙 판정(LLM 없음) ──────────────────────────────────────────────

/** AI 개요 본문에 브랜드 이름·별칭이 나오는가(규칙 · detectBrandMention 재사용). */
export function aioMentionsBrand(
  text: string,
  names: readonly string[]
): boolean {
  const [primary, ...rest] = names.map((n) => n.trim()).filter(Boolean);
  if (!(text && primary)) {
    return false;
  }
  return detectBrandMention(text, primary, rest).mentioned;
}

/** 인용 출처에 공식 도메인(또는 그 하위 도메인)이 있는가. */
export function aioCitesDomain(
  citations: readonly AioCitation[],
  officialDomain: string
): boolean {
  const target = officialDomain
    .trim()
    .toLowerCase()
    .replace(DOMAIN_PREFIX_RE, "")
    .replace(PATH_SUFFIX_RE, "");
  if (!target) {
    return false;
  }
  return citations.some(
    (c) => c.domain === target || c.domain.endsWith(`.${target}`)
  );
}

// ── 원가 ────────────────────────────────────────────────────────────
export function aioCost(succeeded: boolean, basis: AioCost["basis"]): AioCost {
  const credits = succeeded ? 1 : 0;
  const listPriceKrw =
    Math.round(
      ((credits * BRIGHTDATA_SERP_USD_PER_1K) / 1000) * USD_TO_KRW * 100
    ) / 100;
  return {
    credits,
    basis,
    listPriceKrw,
    billedKrw: basis === "free_tier" ? 0 : listPriceKrw,
  };
}

// ── 호출 ────────────────────────────────────────────────────────────
export interface FetchGoogleAioArgs {
  /** 이번 요청이 무료 범위 안인가(호출자가 월 사용량으로 판단). 기본 free_tier. */
  costBasis?: AioCost["basis"];
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  market: AioMarket;
  now?: () => number;
  query: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function httpFailureKind(status: number): AioFailureKind {
  if (status === 401 || status === 403) {
    return "http_auth";
  }
  if (status === 429) {
    return "http_rate_limit";
  }
  return status >= 500 ? "http_server" : "http_client";
}

/** Bright Data 응답 본문 → JSON. format:"raw" 면 문자열 JSON, 혹시 래핑돼 오면 body 필드를 푼다. */
function decodeBody(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  if (isRecord(parsed) && typeof parsed.body === "string") {
    try {
      return JSON.parse(parsed.body);
    } catch {
      return parsed;
    }
  }
  return parsed;
}

/**
 * 질문 1개 · 시장 1개의 AI 개요를 잰다. ⛔ throw 하지 않는다.
 * env: BRIGHTDATA_API_KEY · BRIGHTDATA_SERP_ZONE(없으면 not_configured).
 */
export async function fetchGoogleAio(
  args: FetchGoogleAioArgs
): Promise<GoogleAioResult> {
  const env = args.env ?? process.env;
  const now = args.now ?? Date.now;
  const started = now();
  const basis = args.costBasis ?? "free_tier";
  const base = { query: args.query, market: args.market };
  const fail = (
    kind: AioFailureKind,
    succeeded = false,
    httpStatus?: number
  ): GoogleAioResult => ({
    ...base,
    status: "failed",
    text: "",
    textLength: 0,
    citations: [],
    failure: { kind, ...(httpStatus ? { httpStatus } : {}) },
    latencyMs: now() - started,
    cost: aioCost(succeeded, basis),
  });

  const apiKey = env.BRIGHTDATA_API_KEY?.trim();
  const zone = env.BRIGHTDATA_SERP_ZONE?.trim();
  if (!(apiKey && zone)) {
    return fail("not_configured");
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, args.timeoutMs ?? GOOGLE_AIO_TIMEOUT_MS);
  timer.unref?.();
  const onAbort = () => controller.abort();
  args.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await (args.fetchImpl ?? fetch)(
      BRIGHTDATA_REQUEST_ENDPOINT,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          zone,
          url: buildGoogleAioSearchUrl(args.query, args.market),
          format: "raw",
        }),
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      // 본문은 읽지 않는다(키·내부 메시지가 섞일 수 있음). 상태 코드만.
      return fail(httpFailureKind(response.status), false, response.status);
    }
    // 🔴 실측(2026-10-07): Bright Data 는 구글 수집이 실패해도 HTTP 200 + 빈 본문을 주고,
    //   실제 결과는 `x-brd-status-code` 헤더(예: 502)에 싣는다. 이걸 파싱 실패로 세면 안 된다.
    //   「성공 건만 과금」이므로 크레딧 0 으로 기록한다.
    const upstream = Number(response.headers.get("x-brd-status-code"));
    if (
      Number.isFinite(upstream) &&
      upstream > 0 &&
      !(upstream >= 200 && upstream < 300)
    ) {
      return fail("upstream", false, upstream);
    }
    const raw = await response.text();
    if (!raw.trim()) {
      return fail("upstream", false, response.status);
    }
    let body: unknown;
    try {
      body = decodeBody(raw);
    } catch {
      // HTTP 성공 = 과금됨(성공 전달). 파싱만 실패.
      return fail("parse", true, response.status);
    }
    const parsed = parseGoogleAiOverview(body);
    return {
      ...base,
      status: parsed.present ? "shown" : "not_shown",
      text: parsed.text.slice(0, AIO_TEXT_MAX_CHARS),
      textLength: parsed.text.length,
      citations: parsed.citations,
      latencyMs: now() - started,
      cost: aioCost(true, basis),
    };
  } catch {
    if (timedOut) {
      return fail("timeout");
    }
    return fail(args.signal?.aborted ? "aborted" : "network");
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", onAbort);
  }
}
