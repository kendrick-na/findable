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

export type EngineErrorKind = "timeout" | "rate_limit" | "empty" | "error";

export interface EngineErrorRow {
  durationMs?: number | null;
  engineId: string;
  errorMessage?: string | null;
  lateCell?: "resolved" | "final_failed";
  promptIndex?: number | null;
  promptKind?: string | null;
}

export interface EngineErrorEvent {
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
      recovered: number;
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
const EMPTY_RE = /검색 결과 없음|no results/i;

export function classifyEngineError(
  message: string | null | undefined
): EngineErrorKind {
  if (isEngineTimeoutMessage(message)) {
    return "timeout";
  }
  if (typeof message === "string" && RATE_LIMIT_RE.test(message)) {
    return "rate_limit";
  }
  if (typeof message === "string" && EMPTY_RE.test(message)) {
    return "empty";
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
    const recovered = !row.errorMessage && row.lateCell === "resolved";
    if (!(row.errorMessage || recovered)) {
      continue;
    }
    const kind: EngineErrorKind = recovered
      ? "timeout"
      : classifyEngineError(row.errorMessage);
    const bucket = byEngine[row.engineId] ?? {
      empty: 0,
      error: 0,
      rate_limit: 0,
      recovered: 0,
      timeout: 0,
    };
    byEngine[row.engineId] = bucket;
    bucket[kind] += 1;
    if (recovered) {
      bucket.recovered += 1;
    }
    total += 1;
    if (events.length < MAX_EVENTS) {
      events.push({
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
