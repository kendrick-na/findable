/**
 * 칸당 재시도 + 회차 내 서킷브레이커 감싸개(2026-10-18 · 안정성 U1).
 *
 * `queryAllEngines` 가 엔진 호출(`queryEngineWithTimeout`) **바깥**에서 부른다. 플래그가 꺼져 있으면
 * 이 파일은 호출되지 않는다(기존과 바이트 단위로 같은 동작).
 *
 * 철칙: **못 잰 것은 '미노출/모른다'로 세지 않는다.** 재시도 후에도 못 재면 `errorMessage` 가 있는
 *   오류 칸으로 남고(분모에서 빠짐) `brandMentioned` 같은 값은 만들지 않는다.
 *
 * 재시도 대상: 429·408·5xx·네트워크 오류·빈 응답 오류만. 60초 상한 타임아웃(`EngineTimeoutError`)과
 *   바깥 abort 는 대상이 아니다(타임아웃은 기존 「늦은 칸 다시 묻기」가 맡는다).
 * 한 층만: 이 재시도가 켜지면 AI SDK 기본 재시도는 어댑터에서 `maxRetries: 0` 으로 끈다.
 *   총 시도 ≤ 1 + cellMaxRetries.
 */

import { type StabilityLimits, stabilityLimits } from "../stability-flags";
import {
  acquireEngineBreaker,
  enginePausedMessage,
  recordEngineOutcome,
  releaseEngineProbe,
} from "./engine-breaker";
import { isEngineTimeoutMessage } from "./engine-timeout";
import { describeProviderError, isAbortError } from "./provider-error";
import type { EngineId, EngineResponse, EngineUsage } from "./types";

/** 칸 재시도 대상 엔진 — 호출당 돈이 드는 LLM API 엔진만. 검색 API(naver·daum)는 어댑터가 1회 재시도, 브라우저 엔진은 재시도하지 않는다. */
export const CELL_RETRY_ENGINES: ReadonlySet<EngineId> = new Set<EngineId>([
  "chatgpt",
  "claude",
  "perplexity",
  "gemini",
]);

/** 격리 시 던지는 오류 — `queryAllEngines` 의 기존 「rejected → 오류 칸」 경로를 그대로 탄다. */
export class EnginePausedError extends Error {
  constructor(engineId: string) {
    super(enginePausedMessage(engineId));
    this.name = "EnginePausedError";
  }
}

export interface RetryHint {
  /** 429 였다(지출 상한·크레딧 소진일 수 있다 — Retry-After 가 없으면 기본으로 재시도하지 않는다). */
  rateLimited?: boolean;
  /** 서버가 알려 준 대기(ms). 상한 전 원값. */
  retryAfterMs?: number;
  retryable: boolean;
}

const RATE_LIMIT_MESSAGE_RE =
  /\b429\b|rate.?limit|too many requests|usage_limit/i;

/**
 * 총 재시도 예산(프로세스 단위). 러너를 못 건드리므로 여기서 호출 수·재시도 수를 센다.
 *   규칙: 재시도는 `retries < max(1, floor(calls × retryTotalShare))` 일 때만 허용한다.
 *   `max(1, …)` 이 작은 표본의 최소 보장이다 — 호출이 적어도(예: 한 번의 작은 배치) 재시도 1회는 허용한다.
 */
const budget = { calls: 0, retries: 0 };

export function resetRetryBudget(): void {
  budget.calls = 0;
  budget.retries = 0;
}

export function retryBudgetSnapshot(): { calls: number; retries: number } {
  return { ...budget };
}

function takeRetryBudget(limits: StabilityLimits): boolean {
  if (
    budget.retries <
    Math.max(1, Math.floor(budget.calls * limits.retryTotalShare))
  ) {
    budget.retries += 1;
    return true;
  }
  return false;
}

/** 429 인데 Retry-After 가 없으면 설정이 켜져 있을 때만 재시도. */
function rateLimitBlocked(
  hint: RetryHint | undefined,
  message: string | null | undefined,
  limits: StabilityLimits
): boolean {
  if (limits.retryOn429WithoutRetryAfter || hint?.retryAfterMs !== undefined) {
    return false;
  }
  return hint
    ? hint.rateLimited === true
    : typeof message === "string" && RATE_LIMIT_MESSAGE_RE.test(message);
}

// 응답 객체에 붙이는 대신 WeakMap 으로 둔다 — 저장 JSON·타입에 흔적이 남지 않는다.
const hints = new WeakMap<object, RetryHint>();

/** 어댑터가 실패 응답에 「재시도해도 되는 실패인가 · Retry-After」를 남긴다. */
export function noteRetryHint<T extends object>(
  response: T,
  hint: RetryHint
): T {
  hints.set(response, hint);
  return response;
}

const RETRYABLE_MESSAGE_RE =
  /(?:\bHTTP\b|\bAPI|status(?:Code)?)[\s:=]*(?:429|408|5\d\d)\b|\b429\b|rate.?limit|too many requests|overloaded|service unavailable|bad gateway|gateway time-?out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|fetch failed|socket hang up|network (?:error|request)|terminated|UND_ERR|empty answer|empty response|returned no answer text/i;

/** 오류 문구만으로 재시도 가능 여부를 가른다(힌트가 없는 어댑터용). */
export function isRetryableMessage(
  message: string | null | undefined
): boolean {
  return (
    typeof message === "string" &&
    !isEngineTimeoutMessage(message) &&
    RETRYABLE_MESSAGE_RE.test(message)
  );
}

const SERVER_ERROR_RE =
  /(?:\bHTTP\b|\bAPI\b|status(?:Code)?)[\s:=]*5\d\d\b|overloaded|service unavailable|bad gateway|gateway time-?out/i;
const EMPTY_CAUSE_RE = /empty answer|empty response|returned no answer text/i;

/** 재시도 앞 실패의 원인 분류(기록용 · 문구 원문은 남기지 않는다). */
export function retryCauseOf(
  hint: RetryHint | undefined,
  message: string | null | undefined
): string {
  const text = message ?? "";
  if (hint?.rateLimited || RATE_LIMIT_MESSAGE_RE.test(text)) {
    return "rate_limit";
  }
  if (EMPTY_CAUSE_RE.test(text)) {
    return "empty";
  }
  return SERVER_ERROR_RE.test(text) ? "server_error" : "network";
}

/** 던져진 오류(AI SDK APICallError 포함)에서 재시도 가능 여부와 Retry-After 를 읽는다. */
export function classifyRetryable(error: unknown): RetryHint {
  const { statusCode, retryAfterSeconds } = describeProviderError(error);
  const retryAfterMs =
    retryAfterSeconds === null ? undefined : retryAfterSeconds * 1000;
  if (statusCode !== null) {
    const retryable =
      statusCode === 429 || statusCode === 408 || statusCode >= 500;
    const base: RetryHint = { retryable, rateLimited: statusCode === 429 };
    return retryAfterMs === undefined ? base : { ...base, retryAfterMs };
  }
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";
  return {
    retryable: isRetryableMessage(`${message} ${cause}`),
    rateLimited: RATE_LIMIT_MESSAGE_RE.test(`${message} ${cause}`),
  };
}

const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const SUMMED_USAGE_KEYS = [
  "inputTokens",
  "outputTokens",
  "providerCostUsd",
  "providerCostKrw",
  "webSearchRequests",
  "creditsUsed",
  "priorAttemptCreditsUsed",
] as const;

/**
 * 시도별 usage 를 합친다. 재시도한 호출의 토큰·원가가 빠지면 원가가 과소 집계된다.
 *   합산 키: 토큰·provider 원가·검색 횟수·크레딧. 그 밖의 표식(costModel·modelId·route…)은 **마지막 응답** 것.
 *   어느 시도에도 숫자가 없으면 그 키는 마지막 응답 값 그대로(null 이면 null — 0으로 바꾸지 않는다).
 */
export function mergeUsage(
  prior: readonly EngineUsage[],
  final: EngineUsage | undefined
): EngineUsage | undefined {
  if (prior.length === 0) {
    return final;
  }
  const all = final ? [...prior, final] : [...prior];
  const merged: EngineUsage = { ...(final ?? prior.at(-1)) } as EngineUsage;
  const target = merged as unknown as Record<string, unknown>;
  for (const key of SUMMED_USAGE_KEYS) {
    const values = all
      .map((usage) =>
        numberOf((usage as unknown as Record<string, unknown>)[key])
      )
      .filter((value): value is number => value !== undefined);
    if (values.length > 0) {
      target[key] = values.reduce((sum, value) => sum + value, 0);
    }
  }
  return merged;
}

export interface CellGuardOptions {
  /** 서킷브레이커 사용. */
  breaker: boolean;
  engineId: EngineId;
  limits?: StabilityLimits;
  now?: () => number;
  random?: () => number;
  /** 칸 재시도 사용. */
  retry: boolean;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("Aborted", "AbortError");

/** 중단 신호가 오면 즉시 깨어나 중단 사유로 거절하는 대기. */
export function abortableSleep(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal ? abortReason(signal) : undefined);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** 재시도 `attemptIndex`(0부터) 앞의 대기(ms). Retry-After 가 있으면 그 값(상한 적용·지터 없음), 없으면 목록 값 ±20%. */
export function retryDelayMs(
  attemptIndex: number,
  hint: RetryHint | undefined,
  limits: StabilityLimits,
  random: () => number
): number {
  if (hint?.retryAfterMs !== undefined) {
    return Math.min(Math.max(0, hint.retryAfterMs), limits.retryAfterCapMs);
  }
  const list = limits.retryDelaysMs;
  const base = list[Math.min(attemptIndex, list.length - 1)] ?? 0;
  return Math.round(base * (0.8 + random() * 0.4));
}

const isFailed = (response: EngineResponse): boolean =>
  Boolean(response.errorMessage) && !response.isStub;

/**
 * 엔진 호출 1건(= 한 칸)을 감싼다. `call` 은 시도마다 새로 부른다(각 시도가 자기 개별 상한을 가진다).
 * 던지는 것은 ①격리(EnginePausedError) ②타임아웃 ③중단 ④재시도 불가·소진된 예외 — 모두 기존 「rejected」 경로.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 재시도·브레이커·abort 판정을 한 경계에 둔다(분리하면 abort·격리 해제 순서가 흩어진다).
export async function runCellGuarded(
  call: () => Promise<EngineResponse>,
  options: CellGuardOptions
): Promise<EngineResponse> {
  const limits = options.limits ?? stabilityLimits();
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? abortableSleep;
  const { engineId, signal } = options;

  if (options.retry) {
    budget.calls += 1;
  }
  let probe = false;
  if (options.breaker) {
    const gate = acquireEngineBreaker(engineId, now(), limits);
    if (gate === "blocked") {
      throw new EnginePausedError(engineId);
    }
    probe = gate === "probe";
  }
  let settled = false;
  const maxRetries = options.retry ? Math.max(0, limits.cellMaxRetries) : 0;
  const priorUsage: EngineUsage[] = [];
  const causes: string[] = [];
  let attempts = 0;

  try {
    for (;;) {
      attempts += 1;
      let response: EngineResponse | null = null;
      let thrown: unknown;
      try {
        response = await call();
      } catch (error) {
        thrown = error;
      }

      if (response === null) {
        // 타임아웃·중단은 재시도 대상이 아니고 브레이커에도 세지 않는다.
        const message =
          thrown instanceof Error ? thrown.message : String(thrown);
        if (
          isAbortError(thrown) ||
          signal?.aborted ||
          isEngineTimeoutMessage(message)
        ) {
          throw thrown;
        }
        const thrownHint = classifyRetryable(thrown);
        if (
          attempts <= maxRetries &&
          thrownHint.retryable &&
          !rateLimitBlocked(thrownHint, message, limits) &&
          takeRetryBudget(limits)
        ) {
          causes.push(retryCauseOf(thrownHint, message));
          await sleep(
            retryDelayMs(attempts - 1, thrownHint, limits, random),
            signal
          );
          continue;
        }
        if (options.breaker) {
          recordEngineOutcome(engineId, "failure", now(), limits);
          settled = true;
        }
        throw thrown;
      }

      if (isFailed(response)) {
        const hint = hints.get(response);
        const retryable =
          (hint ? hint.retryable : isRetryableMessage(response.errorMessage)) &&
          !isEngineTimeoutMessage(response.errorMessage);
        if (
          retryable &&
          attempts <= maxRetries &&
          !signal?.aborted &&
          !rateLimitBlocked(hint, response.errorMessage, limits) &&
          takeRetryBudget(limits)
        ) {
          causes.push(retryCauseOf(hint, response.errorMessage));
          if (response.usage) {
            priorUsage.push(response.usage);
          }
          await sleep(retryDelayMs(attempts - 1, hint, limits, random), signal);
          continue;
        }
      }

      const mergedUsage = mergeUsage(priorUsage, response.usage);
      const final: EngineResponse =
        attempts > 1
          ? {
              ...response,
              ...(mergedUsage ? { usage: mergedUsage } : {}),
              retryAttempts: attempts,
              retryCauses: causes,
            }
          : response;

      if (options.breaker) {
        if (isFailed(final)) {
          if (!isEngineTimeoutMessage(final.errorMessage)) {
            recordEngineOutcome(engineId, "failure", now(), limits);
            settled = true;
          }
        } else if (!final.isStub) {
          recordEngineOutcome(engineId, "success", now(), limits);
          settled = true;
        }
      }
      return final;
    }
  } finally {
    if (probe && !settled) {
      releaseEngineProbe(engineId);
    }
  }
}
