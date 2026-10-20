import { isEnginePausedMessage } from "@repo/ai/lib/engines/engine-breaker";
import { isEngineTimeoutMessage } from "@repo/ai/lib/engines/engine-timeout";

/**
 * 엔진별 오류 기록(2026-10-18, 진단 ⑦) — 한 회차에서 어느 엔진이·어느 질문에서·어떤 종류로 실패했나.
 *
 * 왜: 측정 결과에는 「타임아웃 6·429 2」처럼 개수만 있고 **어느 엔진인지** 알 수 없었다(진단 6~7쪽).
 *   원인을 모르면 엔진별 장애(예: ChatGPT 가 느리다)와 우리 쪽 한도 문제를 가를 수 없다.
 * 규칙
 *  - 저장된 행(`engineResponses`)에서 **계산만** 한다(순수 함수). 새 호출·새 컬럼 없음, 점수·집계 불변.
 *  - 오류 문구 원문은 싣지 않는다(공급자 응답에 사용자 정보가 섞일 수 있다) — 분류 이름만 남긴다.
 *  - 늦게 와서 반영된 칸(`lateCell: "resolved"`)도 「회복됨」으로 남긴다(답은 왔지만 느렸다는 사실).
 */

export type EngineErrorKind =
  | "timeout"
  | "rate_limit"
  | "empty"
  | "error"
  | "paused"
  | "server_error";

export interface EngineErrorRow {
  durationMs?: number | null;
  engineId: string;
  errorMessage?: string | null;
  lateCell?: "resolved" | "final_failed";
  promptIndex?: number | null;
  promptKind?: string | null;
  /** 칸 재시도로 시도한 횟수(2 이상이면 재시도가 있었다) · 앞 실패의 원인 분류. 재시도로 회복한 칸도 기록한다. */
  retryAttempts?: number;
  retryCauses?: readonly string[];
}

export interface EngineErrorEvent {
  /** 칸 재시도 횟수(2 이상일 때만 키가 있다). */
  attempts?: number;
  durationMs: number | null;
  engineId: string;
  kind: EngineErrorKind;
  promptIndex: number | null;
  promptKind: string | null;
  /** 늦었지만 답이 와서 반영됨. */
  recovered: boolean;
}

export interface EngineErrorSummary {
  byEngine: Record<
    string,
    {
      empty: number;
      error: number;
      rate_limit: number;
      /** 서킷브레이커로 격리된 칸 수. 없으면 키 자체가 없다(기존 JSON 과 동일). */
      paused?: number;
      recovered: number;
      /** 5xx·과부하. 없으면 키 자체가 없다(기존 JSON 과 동일). */
      server_error?: number;
      timeout: number;
    }
  >;
  events: EngineErrorEvent[];
  total: number;
  /** 이벤트 목록이 상한으로 잘렸으면 true(개수 total·byEngine 은 전체). */
  truncated: boolean;
}

const MAX_EVENTS = 60;
const RATE_LIMIT_RE = /\b429\b|rate.?limit|too many requests|usage_limit/i;
const SERVER_ERROR_RE =
  /(?:\bHTTP\b|\bAPI\b|status(?:Code)?)[\s:=]*5\d\d\b|overloaded|service unavailable|bad gateway|gateway time-?out/i;
const EMPTY_RE =
  /검색 결과 없음|no results|returned an empty answer|empty answer/i;

export function classifyEngineError(
  message: string | null | undefined
): EngineErrorKind {
  if (isEngineTimeoutMessage(message)) {
    return "timeout";
  }
  if (isEnginePausedMessage(message)) {
    return "paused";
  }
  if (typeof message === "string" && RATE_LIMIT_RE.test(message)) {
    return "rate_limit";
  }
  if (typeof message === "string" && SERVER_ERROR_RE.test(message)) {
    return "server_error";
  }
  if (typeof message === "string" && EMPTY_RE.test(message)) {
    return "empty";
  }
  return "error";
}

/** 한 행이 기록 대상인지·어떤 종류인지·회복됐는지(늦은 칸 회복 · 칸 재시도 회복 · 최종 오류). */
function rowVerdict(
  row: EngineErrorRow
): { kind: EngineErrorKind; recovered: boolean } | null {
  const lateRecovered = !row.errorMessage && row.lateCell === "resolved";
  // 칸 재시도(앞 시도가 실패)로 회복한 칸 — 최종은 성공이지만 「한 번 실패했다」는 사실을 남긴다.
  const retryRecovered =
    !(row.errorMessage || lateRecovered) && (row.retryAttempts ?? 1) > 1;
  if (lateRecovered) {
    return { kind: "timeout", recovered: true };
  }
  if (retryRecovered) {
    return { kind: causeToKind(row.retryCauses?.[0]), recovered: true };
  }
  return row.errorMessage
    ? { kind: classifyEngineError(row.errorMessage), recovered: false }
    : null;
}

function causeToKind(cause: string | undefined): EngineErrorKind {
  if (cause === "rate_limit" || cause === "server_error" || cause === "empty") {
    return cause;
  }
  return "error";
}

/** 오류·늦은 칸이 하나도 없으면 null(결과 JSON 에 키를 만들지 않는다 — 정상 회차는 그대로). */
export function summarizeEngineErrors(
  rows: readonly EngineErrorRow[]
): EngineErrorSummary | null {
  const byEngine: EngineErrorSummary["byEngine"] = {};
  const events: EngineErrorEvent[] = [];
  let total = 0;
  for (const row of rows) {
    const verdict = rowVerdict(row);
    if (!verdict) {
      continue;
    }
    const { kind, recovered } = verdict;
    const bucket = byEngine[row.engineId] ?? {
      empty: 0,
      error: 0,
      rate_limit: 0,
      recovered: 0,
      timeout: 0,
    };
    byEngine[row.engineId] = bucket;
    bucket[kind] = (bucket[kind] ?? 0) + 1;
    if (recovered) {
      bucket.recovered += 1;
    }
    total += 1;
    if (events.length < MAX_EVENTS) {
      events.push({
        ...((row.retryAttempts ?? 1) > 1
          ? { attempts: row.retryAttempts }
          : {}),
        durationMs: row.durationMs ?? null,
        engineId: row.engineId,
        kind,
        promptIndex: row.promptIndex ?? null,
        promptKind: row.promptKind ?? null,
        recovered,
      });
    }
  }
  return total === 0
    ? null
    : { byEngine, events, total, truncated: total > events.length };
}
