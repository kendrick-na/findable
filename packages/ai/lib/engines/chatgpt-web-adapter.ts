// ChatGPT 웹 UI 수집기 — Firecrawl `/v2/scrape` + 브라우저 actions (2026-10-07 재작성)
//
// 목적: chatgpt.com(로그아웃·개인화 없음)에서 **사람이 실제로 보는 답변**을 수집한다.
//   API 답변(global-adapters.ts 의 chatgptAdapter)과 다르다 — 경쟁사(Profound·Peec·Otterly)도
//   소비자 웹 화면에서 수집한다(👤 CEO 결정 2026-10-07).
//
// ## 왜 다시 썼나 (이전 = Stagehand + Browserbase/LOCAL)
//   ① Vercel 서버리스는 Browserbase 로 나가는 WebSocket(CDP)을 못 맺었다 — 같은 방식의
//      naver-briefing 이 5/08~7/28 **11건 전멸**(timeout·`101`·429). 📕 브리핑_본류편입_기획 §1
//   ② LOCAL 모드는 서버리스에 크롬이 없어 원리적으로 못 돈다.
//   ③ Stagehand `act()/extract()` 는 **LLM 키가 따로** 필요했다(설정된 적 없음).
//   ④ Browserbase 무료 티어 동시성 1 → 429.
//   → naver-briefing 이 이미 살아 있는 경로(Firecrawl HTTP 한 방)로 옮긴다. WebSocket·LLM 0.
//
// ## 동작
//   1. Firecrawl POST /v2/scrape — url=chatgpt.com, actions=[대기→입력란 클릭→질문 입력→Enter→
//      대기→완료 폴링 JS], formats=rawHtml, proxy=basic, 캐시 미사용.
//   2. 최종 HTML 에서 마지막 assistant 메시지(`data-message-author-role="assistant"`) 본문·링크 추출.
//   3. 판정·집계는 다른 어댑터와 **같은 함수**(detectBrandMention 등)를 쓴다.
//
// 🔴 챌린지(Cloudflare·Turnstile·로그인벽)는 **우회하지 않는다.** 감지되면 깨끗한 실패로 남긴다.
//    stealth/enhanced 프록시를 쓰지 않는다(`proxy: "basic"`). 쿠키·약관 동의도 누르지 않는다.
// ⚠️ OpenAI 이용약관상 자동화 수집은 회색지대 — 플래그 뒤에서 표본 비교로만 시작한다.

import { FIRECRAWL_CREDITS_PER_SCRAPE } from "./cost";
import { isAbortError } from "./provider-error";
import { sanitizeEngineText } from "./sanitize";
import type {
  CitedSource,
  EngineAdapter,
  EngineQuery,
  EngineResponse,
} from "./types";
import {
  detectBrandMention,
  estimateSentiment,
  estimateShareOfVoice,
  mentionPositionFields,
} from "./utils";

const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const CHATGPT_URL = "https://chatgpt.com/";

/** 수집 방식의 버전. 셀렉터·actions 순서를 바꾸면 올린다(비교 가드 키와는 별개). */
export const CHATGPT_WEB_COLLECTOR_VERSION = "firecrawl-actions-v1";

/** 실패 사유 접두어 — 로그·화면이 「왜 못 받았나」를 문자열 하나로 가를 수 있게. */
export const CHATGPT_WEB_FAIL = {
  notConfigured: "[chatgpt-web:not_configured]",
  challenge: "[chatgpt-web:challenge]",
  composerMissing: "[chatgpt-web:composer_missing]",
  noAnswer: "[chatgpt-web:no_answer]",
  incomplete: "[chatgpt-web:incomplete]",
  timeout: "[chatgpt-web:timeout]",
  credits: "[chatgpt-web:credits]",
  auth: "[chatgpt-web:auth]",
  rateLimit: "[chatgpt-web:rate_limit]",
  http: "[chatgpt-web:http]",
  network: "[chatgpt-web:network]",
} as const;

const DEFAULT_TIMEOUT_MS = 45_000;
/** 페이지 로드·입력·전송에 드는 고정 몫(실측 전 추정). 나머지를 답변 대기에 쓴다. */
const SETUP_OVERHEAD_MS = 12_000;
const MIN_ANSWER_WAIT_MS = 5000;

const CHALLENGE_RE =
  /challenges\.cloudflare\.com|cf-chl-|cf-turnstile|Just a moment\.\.\.|Verify you are human|Checking if the site connection is secure|Attention Required!/i;
const ASSISTANT_MARKER = 'data-message-author-role="assistant"';
const STOP_BUTTON_RE = /data-testid="stop-button"/;
const COMPOSER_MISSING_RE =
  /selector|element|not found|no node|waiting for|timeout.*click/i;
const ANCHOR_RE = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const TAG_RE = /<[^>]+>/g;
const SCRIPT_RE = /<script[\s\S]*?<\/script>/gi;
const STYLE_RE = /<style[\s\S]*?<\/style>/gi;
const BUTTON_RE = /<button[\s\S]*?<\/button>/gi;
const CHATGPT_OWN_HOST_RE = /(^|\.)(chatgpt\.com|openai\.com|oaistatic\.com)$/i;

export interface ChatgptWebRunOptions {
  /** 이 수집의 총 상한(ms). Firecrawl `timeout` 과 클라이언트 타이머에 같이 쓴다. */
  timeoutMs?: number;
}

/** 챌린지·봇 확인 화면인가. 감지되면 **우회하지 않고** 실패로 기록한다. */
export function isChatgptChallengePage(html: string): boolean {
  // 답변이 이미 있으면 챌린지가 아니다(페이지 어딘가의 스크립트 URL 오탐 방지).
  if (html.includes(ASSISTANT_MARKER)) {
    return false;
  }
  return CHALLENGE_RE.test(html);
}

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw.replace(/&amp;/g, "&"));
  } catch {
    return null;
  }
}

/**
 * 렌더된 chatgpt.com HTML 에서 **마지막 assistant 답변**의 본문·외부 링크를 뽑는다.
 * 없으면 null. 테스트를 위해 공개한다.
 */
export function parseChatgptWebHtml(html: string): {
  links: CitedSource[];
  streaming: boolean;
  text: string;
} | null {
  const at = html.lastIndexOf(ASSISTANT_MARKER);
  if (at === -1) {
    return null;
  }
  const from = html.lastIndexOf("<", at);
  // 다음 대화 턴(또는 문서 끝)까지를 이 답변의 범위로 본다.
  const nextTurn = html.indexOf("data-message-author-role=", at + 30);
  const to = nextTurn === -1 ? html.length : html.lastIndexOf("<", nextTurn);
  const slice = html.slice(from === -1 ? at : from, to);
  const links: CitedSource[] = [];
  const seen = new Set<string>();
  ANCHOR_RE.lastIndex = 0;
  let match = ANCHOR_RE.exec(slice);
  while (match !== null && links.length < 20) {
    const url = safeUrl(match[1] ?? "");
    if (
      url &&
      (url.protocol === "https:" || url.protocol === "http:") &&
      !CHATGPT_OWN_HOST_RE.test(url.hostname)
    ) {
      // ChatGPT 가 붙이는 추적 파라미터는 출처 식별과 무관하다.
      url.searchParams.delete("utm_source");
      const key = url.toString();
      if (!seen.has(key)) {
        seen.add(key);
        const title = (match[2] ?? "").replace(TAG_RE, "").trim();
        links.push({
          url: key,
          domain: url.hostname,
          ...(title ? { title } : {}),
        });
      }
    }
    match = ANCHOR_RE.exec(slice);
  }
  const text = sanitizeEngineText(
    slice.replace(SCRIPT_RE, " ").replace(STYLE_RE, " ").replace(BUTTON_RE, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
  if (text.length === 0) {
    return null;
  }
  return { text, links, streaming: STOP_BUTTON_RE.test(html) };
}

/** 답변 완료(멈춤 버튼 사라짐)까지 최대 waitMs 폴링. Firecrawl 이 Promise 를 기다리지 않아도 무해. */
function completionPollScript(waitMs: number): string {
  return `(async()=>{const u=Date.now()+${waitMs};const d=()=>!document.querySelector('[data-testid="stop-button"]')&&document.querySelectorAll('[${ASSISTANT_MARKER.replace(/"/g, "\\'")}]').length>0;while(Date.now()<u&&!d()){await new Promise(r=>setTimeout(r,500));}return JSON.stringify({done:d()});})()`;
}

function firecrawlBody(query: EngineQuery, timeoutMs: number): string {
  const ko = query.language === "ko";
  const answerWaitMs = Math.max(
    MIN_ANSWER_WAIT_MS,
    timeoutMs - SETUP_OVERHEAD_MS
  );
  const firstWaitMs = Math.min(8000, answerWaitMs);
  return JSON.stringify({
    url: CHATGPT_URL,
    formats: [{ type: "rawHtml" }],
    onlyMainContent: false,
    // 🔴 우회 금지 — enhanced/stealth 프록시를 쓰지 않는다.
    proxy: "basic",
    // 로그아웃 화면 · 질문 언어에 맞춘 국가(개인화 아님, 지역 표기만).
    location: ko
      ? { country: "KR", languages: ["ko-KR"] }
      : { country: "US", languages: ["en-US"] },
    // 매번 새로 묻는다(캐시된 남의 답을 받으면 측정이 아니다).
    maxAge: 0,
    storeInCache: false,
    timeout: timeoutMs,
    actions: [
      { type: "wait", milliseconds: 2000 },
      { type: "click", selector: "#prompt-textarea" },
      { type: "write", text: query.prompt },
      { type: "press", key: "Enter" },
      { type: "wait", milliseconds: firstWaitMs },
      {
        type: "executeJavascript",
        script: completionPollScript(answerWaitMs - firstWaitMs),
      },
    ],
  });
}

function makeFailure(
  message: string,
  durationMs: number,
  creditsUsed?: number,
  isStub = false
): EngineResponse {
  return {
    engineId: "chatgpt-web",
    rawResponse: "",
    brandMentioned: false,
    mentionPosition: null,
    mentionListSize: null,
    sentiment: null,
    citedSources: [],
    shareOfVoice: null,
    errorMessage: isStub ? null : message,
    durationMs,
    isStub,
    usage: {
      inputTokens: null,
      outputTokens: null,
      costModel: "credit",
      source: "web",
      ...(creditsUsed === undefined ? {} : { creditsUsed }),
    },
  };
}

function classifyHttpFailure(status: number, body: string): string {
  if (status === 402) {
    return `${CHATGPT_WEB_FAIL.credits} Firecrawl 크레딧 소진 (HTTP 402)`;
  }
  if (status === 401 || status === 403) {
    return `${CHATGPT_WEB_FAIL.auth} Firecrawl 키 무효/권한 없음 (HTTP ${status})`;
  }
  if (status === 429) {
    return `${CHATGPT_WEB_FAIL.rateLimit} Firecrawl 속도·동시성 제한 (HTTP 429)`;
  }
  if (CHALLENGE_RE.test(body)) {
    return `${CHATGPT_WEB_FAIL.challenge} ChatGPT 가 봇 확인 화면을 띄움 — 우회하지 않음 (HTTP ${status})`;
  }
  if (COMPOSER_MISSING_RE.test(body)) {
    // 입력란이 없었다 = 챌린지·로그인벽·UI 변경 중 하나. 원인을 지어내지 않는다.
    return `${CHATGPT_WEB_FAIL.composerMissing} 입력란을 찾지 못함(챌린지·로그인벽·UI 변경 중 하나) (HTTP ${status}: ${body.slice(0, 160)})`;
  }
  return `${CHATGPT_WEB_FAIL.http} Firecrawl HTTP ${status}: ${body.slice(0, 160)}`;
}

function reportedCredits(json: {
  data?: { metadata?: { creditsUsed?: unknown } };
}): number {
  const reported = json.data?.metadata?.creditsUsed;
  return typeof reported === "number" &&
    Number.isFinite(reported) &&
    reported >= 0
    ? reported
    : FIRECRAWL_CREDITS_PER_SCRAPE;
}

function buildSuccess(
  query: EngineQuery,
  parsed: { links: CitedSource[]; text: string },
  durationMs: number,
  creditsUsed: number
): EngineResponse {
  const { text } = parsed;
  const mention = detectBrandMention(
    text,
    query.brandName,
    query.brandVariants
  );
  return {
    engineId: "chatgpt-web",
    rawResponse: text,
    brandMentioned: mention.mentioned,
    ...mentionPositionFields(text, query.brandName, query.brandVariants),
    sentiment: estimateSentiment(text, query.brandName),
    citedSources: parsed.links,
    shareOfVoice: estimateShareOfVoice(
      text,
      query.brandName,
      query.brandVariants
    ),
    errorMessage: null,
    durationMs,
    isStub: false,
    usage: {
      inputTokens: null,
      outputTokens: null,
      costModel: "credit",
      creditsUsed,
      source: "web",
    },
  };
}

/** 렌더 결과(HTML) → 응답. 문서를 돌려받았으면 크레딧은 이미 나갔다(실패여도 산입). */
function interpretHtml(
  query: EngineQuery,
  html: string,
  durationMs: number,
  credits: number
): EngineResponse {
  if (isChatgptChallengePage(html)) {
    return makeFailure(
      `${CHATGPT_WEB_FAIL.challenge} ChatGPT 가 봇 확인 화면을 띄움 — 우회하지 않음`,
      durationMs,
      credits
    );
  }
  const parsed = parseChatgptWebHtml(html);
  if (!parsed) {
    return makeFailure(
      `${CHATGPT_WEB_FAIL.noAnswer} 답변 블록 없음(로그인벽·UI 변경 가능)`,
      durationMs,
      credits
    );
  }
  if (parsed.streaming) {
    // 생성 중에 잘린 답은 언급 판정을 왜곡한다 → 쓰지 않는다.
    return makeFailure(
      `${CHATGPT_WEB_FAIL.incomplete} 답변 생성이 상한 안에 끝나지 않음`,
      durationMs,
      credits
    );
  }
  return buildSuccess(query, parsed, durationMs, credits);
}

function envTimeoutMs(): number {
  const value = Number(process.env.FINDABLE_CHATGPT_WEB_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

/** Firecrawl 1회 호출 → 응답 해석. 네트워크/중단 예외는 호출자가 분류한다. */
async function scrapeAndInterpret(
  query: EngineQuery,
  apiKey: string,
  timeoutMs: number,
  signal: AbortSignal,
  start: number
): Promise<EngineResponse> {
  const res = await fetch(FIRECRAWL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: firecrawlBody(query, timeoutMs),
    signal,
  });
  if (!res.ok) {
    const body = await res.text();
    // HTTP 오류 = 문서 없음 → 공식 규칙상 0크레딧(creditsUsed 미기재).
    return makeFailure(
      classifyHttpFailure(res.status, body),
      Date.now() - start
    );
  }
  const json = (await res.json()) as {
    data?: {
      html?: string;
      metadata?: { creditsUsed?: unknown };
      rawHtml?: string;
    };
    error?: string;
  };
  const html = json.data?.rawHtml ?? json.data?.html;
  if (!html) {
    return makeFailure(
      `${CHATGPT_WEB_FAIL.noAnswer} Firecrawl 응답에 HTML 없음: ${json.error ?? "unknown"}`,
      Date.now() - start,
      json.data ? reportedCredits(json) : undefined
    );
  }
  return interpretHtml(query, html, Date.now() - start, reportedCredits(json));
}

/**
 * ChatGPT 웹 수집 1회. **절대 throw 하지 않는다** — 바깥(측정 마감) signal 이 끊긴 경우만 예외.
 * 자체 상한(timeoutMs)에 걸리면 `[chatgpt-web:timeout]` 실패 응답을 돌려준다.
 */
export async function runChatgptWeb(
  query: EngineQuery,
  options: ChatgptWebRunOptions = {}
): Promise<EngineResponse> {
  const start = Date.now();
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (process.env.FINDABLE_DISABLE_CHATGPT_WEB === "1" || !apiKey) {
    return makeFailure(
      `${CHATGPT_WEB_FAIL.notConfigured} ${apiKey ? "FINDABLE_DISABLE_CHATGPT_WEB=1" : "FIRECRAWL_API_KEY 미설정"}`,
      0,
      undefined,
      true
    );
  }
  const timeoutMs = options.timeoutMs ?? envTimeoutMs();

  const controller = new AbortController();
  const parent = query.signal;
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    throw parent.reason ?? new DOMException("Aborted", "AbortError");
  }
  parent?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("chatgpt-web cap", "AbortError")),
    timeoutMs
  );
  timer.unref?.();

  try {
    return await scrapeAndInterpret(
      query,
      apiKey,
      timeoutMs,
      controller.signal,
      start
    );
  } catch (error) {
    if (parent?.aborted) {
      throw parent.reason ?? error;
    }
    if (isAbortError(error) || controller.signal.aborted) {
      // 🔴 Firecrawl 쪽에서는 요청이 끝까지 돌아 과금됐을 수 있다 → 보수적으로 1크레딧 산입.
      //   [확인필요] 클라이언트가 끊은 scrape 의 과금 여부(청구서 대조 전까지 과소 기록 방지).
      return makeFailure(
        `${CHATGPT_WEB_FAIL.timeout} ${timeoutMs}ms 안에 끝나지 않음`,
        Date.now() - start,
        FIRECRAWL_CREDITS_PER_SCRAPE
      );
    }
    return makeFailure(
      `${CHATGPT_WEB_FAIL.network} ${error instanceof Error ? error.message : String(error)}`,
      Date.now() - start
    );
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  }
}

/** 단독 베타 엔진(`chatgpt-web`)용 어댑터 — BETA_ENGINES 에서만 쓰인다. */
export const chatgptWebAdapter: EngineAdapter = (query) => runChatgptWeb(query);
