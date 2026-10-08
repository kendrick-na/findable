// ChatGPT 수집 경로 스위치 + 웹 섀도 비교 (2026-10-07 · 👤 CEO 승인)
//
// 결정: 경쟁사(Profound·Peec·Otterly)는 ChatGPT 답을 **소비자 웹 화면**에서 수집한다
//   (API 답과 다르다 — 연구: API 답 1건당 브랜드 13.8개 vs 웹 화면 7.9개). Findable 도
//   짧은 섀도 비교 뒤 웹 수집을 기본으로 바꾼다. 그 전까지 **운영 동작은 그대로**다.
//
// 플래그(전부 기본 off — 아무것도 안 켜면 기존과 100% 동일):
//   CHATGPT_WEB_SHADOW=true   → chatgpt(API) 질문마다 웹 수집을 **같이** 돌려 비교만 저장.
//                               점수·집계에는 절대 안 들어간다. 메인 배치를 늦추지 않는다.
//   CHATGPT_SOURCE=web|api    → web 이면 웹 수집이 chatgpt 엔진의 본 답이 된다.
//                               실패하면 API+웹검색으로 폴백(`usage.source="api_fallback"`).
//   CHATGPT_WEB_PRIMARY_TIMEOUT_MS (기본 30000) · CHATGPT_WEB_SHADOW_TIMEOUT_MS (기본 45000)
//   CHATGPT_WEB_SHADOW_GRACE_MS (기본 0) — 메인 배치가 끝난 뒤 섀도를 더 기다려 줄 시간.

import { log } from "@repo/observability/log";
import { runChatgptWeb } from "./chatgpt-web-adapter";
import { chatgptAdapter, chatgptApiSearchAdapter } from "./global-adapters";
import type {
  ChatgptWebShadow,
  EngineAdapter,
  EngineQuery,
  EngineResponse,
  EngineUsage,
} from "./types";

export type ChatgptSource = "web" | "api";

/**
 * 웹 수집으로 잰 chatgpt 행의 「측정 방식 세트」 키. 비교 가드가 이 값으로 회차 비교를 막는다.
 * 🔴 수집 방식(셀렉터·폴백 규칙)이 **답의 성격을 바꾸면** 올린다(v2, v3 …).
 */
export const CHATGPT_WEB_ENGINE_SET = "chatgpt-web-v1";

const DEFAULT_PRIMARY_TIMEOUT_MS = 30_000;
const DEFAULT_SHADOW_TIMEOUT_MS = 45_000;
const SHADOW_TEXT_LIMIT = 8000;
const FAILURE_KIND_RE = /^\[chatgpt-web:([a-z_]+)\]/;
const WWW_PREFIX_RE = /^www\./;

function envMs(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback; // 빈 문자열을 0ms 로 읽으면 수집이 즉시 끊긴다(Number("") === 0).
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function readChatgptSource(): ChatgptSource {
  return process.env.CHATGPT_SOURCE?.trim().toLowerCase() === "web"
    ? "web"
    : "api";
}

/** 이번 실행 설정의 chatgpt 측정 방식 세트 키. api(기본)면 undefined = 기존 시계열. */
export function chatgptEngineSetKey(): string | undefined {
  return readChatgptSource() === "web" ? CHATGPT_WEB_ENGINE_SET : undefined;
}

export function isChatgptWebShadowEnabled(): boolean {
  const raw = process.env.CHATGPT_WEB_SHADOW?.trim().toLowerCase();
  // 웹이 이미 본 경로면 섀도는 의미가 없다(같은 걸 두 번 잰다).
  return (raw === "true" || raw === "1") && readChatgptSource() === "api";
}

export interface ChatgptRouteDeps {
  api: EngineAdapter;
  apiSearch: EngineAdapter;
  web: (
    query: EngineQuery,
    options: { timeoutMs: number }
  ) => Promise<EngineResponse>;
}

const defaultDeps: ChatgptRouteDeps = {
  // 지연 참조 — 테스트가 global-adapters 를 부분 모킹해도 모듈 로드가 깨지지 않게.
  api: (query) => chatgptAdapter(query),
  apiSearch: (query) => chatgptApiSearchAdapter(query),
  web: (query, options) => runChatgptWeb(query, options),
};

/** 실패 메시지에서 분류 접두어(`[chatgpt-web:xxx]`)만. 로그에 원문(외부 응답)을 싣지 않는다. */
export function chatgptWebFailureKind(message: string | null): string | null {
  if (!message) {
    return null;
  }
  const match = FAILURE_KIND_RE.exec(message);
  return match?.[1] ?? "other";
}

function webSucceeded(response: EngineResponse): boolean {
  return !(response.errorMessage || response.isStub);
}

/**
 * chatgpt 엔진 어댑터(경로 스위치). `CHATGPT_SOURCE` 가 api(기본)면 **기존 어댑터 그대로**.
 */
export function createChatgptRoutedAdapter(
  deps: ChatgptRouteDeps = defaultDeps
): EngineAdapter {
  return async (query) => {
    if (readChatgptSource() !== "web") {
      return await deps.api(query);
    }
    const start = Date.now();
    const web = await deps.web(query, {
      timeoutMs: envMs(
        "CHATGPT_WEB_PRIMARY_TIMEOUT_MS",
        DEFAULT_PRIMARY_TIMEOUT_MS
      ),
    });
    if (webSucceeded(web)) {
      log.info("engine.chatgpt_web.primary", {
        outcome: "ok",
        durationMs: web.durationMs,
        citations: web.citedSources.length,
      });
      return {
        ...web,
        engineId: "chatgpt",
        usage: {
          inputTokens: null,
          outputTokens: null,
          costModel: "credit",
          ...web.usage,
          source: "web",
          chatgptEngineSet: CHATGPT_WEB_ENGINE_SET,
        },
      };
    }
    const fallback = await deps.apiSearch(query);
    const priorCredits = web.usage?.creditsUsed;
    log.warn("engine.chatgpt_web.primary", {
      outcome: "api_fallback",
      webFailure: chatgptWebFailureKind(web.errorMessage) ?? "stub",
      webDurationMs: web.durationMs,
      fallbackOk: !(fallback.errorMessage || fallback.isStub),
    });
    const usage: EngineUsage = {
      inputTokens: null,
      outputTokens: null,
      costModel: "token",
      ...fallback.usage,
      source: "api_fallback",
      chatgptEngineSet: CHATGPT_WEB_ENGINE_SET,
      ...(typeof priorCredits === "number" && priorCredits > 0
        ? { priorAttemptCreditsUsed: priorCredits }
        : {}),
    };
    return {
      ...fallback,
      engineId: "chatgpt",
      durationMs: Date.now() - start,
      usage,
    };
  };
}

export const chatgptRoutedAdapter: EngineAdapter = createChatgptRoutedAdapter();

// ──────────────────────────────────────────────────────────────────
// 섀도
// ──────────────────────────────────────────────────────────────────

function domainSet(response: { citedSources: { domain: string }[] }) {
  return new Set(
    response.citedSources
      .map((source) => source.domain.toLowerCase().replace(WWW_PREFIX_RE, ""))
      .filter((domain) => domain.length > 0)
  );
}

/** 출처 도메인 자카드 유사도. 둘 다 비었으면 null(「0% 겹침」과 「비교할 출처 없음」은 다르다). */
export function citationOverlap(
  a: { citedSources: { domain: string }[] },
  b: { citedSources: { domain: string }[] }
): number | null {
  const left = domainSet(a);
  const right = domainSet(b);
  const union = new Set([...left, ...right]);
  if (union.size === 0) {
    return null;
  }
  let shared = 0;
  for (const domain of left) {
    if (right.has(domain)) {
      shared += 1;
    }
  }
  return Math.round((shared / union.size) * 1000) / 1000;
}

function toShadow(
  web: EngineResponse,
  main: EngineResponse | undefined
): ChatgptWebShadow {
  const ok = webSucceeded(web);
  const mainOk = Boolean(main && !(main.errorMessage || main.isStub));
  const credits = web.usage?.creditsUsed;
  return {
    outcome: ok ? "ok" : "failed",
    text: ok ? web.rawResponse.slice(0, SHADOW_TEXT_LIMIT) : "",
    citations: ok ? web.citedSources : [],
    brandMentioned: ok ? web.brandMentioned : null,
    durationMs: web.durationMs,
    error: ok ? null : (web.errorMessage ?? "[chatgpt-web:not_configured]"),
    ...(typeof credits === "number" ? { creditsUsed: credits } : {}),
    comparison:
      ok && main && mainOk
        ? {
            mentionAgreement: web.brandMentioned === main.brandMentioned,
            citationOverlap: citationOverlap(web, main),
          }
        : null,
  };
}

function skippedShadow(durationMs: number): ChatgptWebShadow {
  return {
    outcome: "skipped_budget",
    text: "",
    citations: [],
    brandMentioned: null,
    durationMs,
    error: "[chatgpt-web:skipped_budget] 메인 배치가 먼저 끝나 섀도를 중단함",
    // 🔴 Firecrawl 은 클라이언트가 끊어도 끝까지 돌아 과금했을 수 있다 → 보수적으로 1크레딧.
    //   [확인필요] 끊긴 scrape 의 실제 과금(청구서 대조).
    creditsUsed: 1,
    comparison: null,
  };
}

export interface ShadowHandle {
  /** 메인 배치가 끝난 뒤 호출. graceMs 안에 끝나면 결과, 아니면 중단하고 skipped_budget. */
  finish(main: EngineResponse | undefined): Promise<ChatgptWebShadow>;
}

/**
 * 섀도 웹 수집을 **메인 배치와 동시에** 시작한다. 절대 throw 하지 않는다.
 * 🔴 메인을 늦추지 않는다: 메인 배치가 끝나면 grace(기본 0ms)만 더 기다리고 끊는다.
 *   측정 마감(base.signal)이 끊겨도 같이 끊긴다.
 */
export function startChatgptWebShadow(
  base: Omit<EngineQuery, "engineId">,
  web: ChatgptRouteDeps["web"] = defaultDeps.web
): ShadowHandle {
  const started = Date.now();
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
      return await web(
        { ...base, engineId: "chatgpt-web", signal: controller.signal },
        {
          timeoutMs: envMs(
            "CHATGPT_WEB_SHADOW_TIMEOUT_MS",
            DEFAULT_SHADOW_TIMEOUT_MS
          ),
        }
      );
    } catch {
      return null; // 중단(메인 종료·마감) 또는 예기치 못한 오류 → skipped/failed 로 접는다.
    }
  })();

  return {
    async finish(main) {
      const graceMs = envMs("CHATGPT_WEB_SHADOW_GRACE_MS", 0);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"late">((resolve) => {
        timer = setTimeout(() => resolve("late"), graceMs);
        timer.unref?.();
      });
      const settled = await Promise.race([running, late]);
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
      let shadow: ChatgptWebShadow;
      if (settled === "late" || settled === null) {
        // 이미 끊겨 있었다(측정 마감) = 예산 부족. 아니면 null 은 예기치 못한 오류다.
        const crashed = settled === null && !controller.signal.aborted;
        controller.abort(
          new DOMException("chatgpt-web shadow budget", "AbortError")
        );
        shadow = crashed
          ? toShadow(
              {
                engineId: "chatgpt-web",
                rawResponse: "",
                brandMentioned: false,
                mentionPosition: null,
                mentionListSize: null,
                sentiment: null,
                citedSources: [],
                shareOfVoice: null,
                errorMessage: "[chatgpt-web:other] shadow crashed",
                durationMs: Date.now() - started,
                isStub: false,
              },
              main
            )
          : skippedShadow(Date.now() - started);
      } else {
        shadow = toShadow(settled, main);
      }
      log.info("engine.chatgpt_web.shadow", {
        outcome: shadow.outcome,
        failure: chatgptWebFailureKind(shadow.error),
        durationMs: shadow.durationMs,
        creditsUsed: shadow.creditsUsed ?? null,
        mainMentioned: main ? main.brandMentioned : null,
        shadowMentioned: shadow.brandMentioned,
        mentionAgreement: shadow.comparison?.mentionAgreement ?? null,
        citationOverlap: shadow.comparison?.citationOverlap ?? null,
        mainCitations: main?.citedSources.length ?? null,
        shadowCitations: shadow.citations.length,
      });
      return shadow;
    },
  };
}
