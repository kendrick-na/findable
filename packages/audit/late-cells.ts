/**
 * 늦은 엔진을 실패로 세지 않기 — 「반영 예정」 칸 다시 묻기(2026-10-07 · 대표+관제탑 합의 설계 B).
 *
 * 🔴 왜 필요한가
 *   엔진 1회 호출은 60초 상한이다. 넘으면 그 답은 오류가 되어 분모에서 빠졌다
 *   (「측정 실패 n개는 뺐어요」). 하지만 늦은 것은 「모른다」도 「고장」도 아니다 —
 *   조금 더 기다리면 답이 온다(관측 최장 ChatGPT 185초 · Claude 161초).
 *
 * 칸(질문×엔진) 상태 기계 — 새 컬럼 없이 checkpoint JSON 의 `cells` 에만 둔다:
 *
 *   첫 측정(60초 상한)
 *     ├─ 답 받음 ───────────────────────────────▶ done            (다시 묻지 않는다)
 *     ├─ 60초 상한 ─────────────────────────────▶ timed_out_pending (「반영 예정」, 오류 아님)
 *     └─ 다른 오류(429·미연결) ───────────────────▶ failed(engine_error) (지금과 같다)
 *
 *   timed_out_pending ──다시 묻기 회차(새 300초 호출 · 칸당 1번 · 상한 200초)──┐
 *     ├─ 답 받음 ───────────────────────────────▶ done   (revisions 에 「늦은 답 반영」)
 *     ├─ 또 상한 ───────────────────────────────▶ failed(reask_timed_out)
 *     └─ 다른 오류 ─────────────────────────────▶ failed(reask_error)
 *   다시 묻기를 시작했는데 저장 전에 호출이 끝남 ─▶ failed(reask_interrupted) — 1회 상한이라 또 묻지 않는다
 *   다시 묻기 전에 시간창(2시간) 만료 ────────────▶ failed(window_expired)
 *   다시 묻기 경로가 없는 실행(무료 진단 등) ──────▶ failed(not_reasked) — 지금과 같다
 *
 *   마감 = 모든 칸이 done 또는 failed. failed 칸은 지금처럼 분모에서 빠지고, 화면이 엔진 이름을 말한다.
 *
 * ⚠️ 다시 묻기 회차(×1)는 질문 이어가기(×2)와 **따로** 센다(checkpoint.lateReask vs continuation).
 * ⚠️ 다시 묻기를 「시작했다」를 먼저 저장한 뒤 호출한다 → 호출 도중 함수가 죽어도 같은 칸을
 *    두 번 묻지 않는다(유료 호출 1회 상한이 크래시에도 지켜진다).
 */

import type { EngineResponse } from "@repo/ai/lib/engines";
import {
  isEngineTimeoutMessage,
  LATE_CELL_REASK_TIMEOUT_MS,
} from "@repo/ai/lib/engines/engine-timeout";
import type {
  AuditCellFailureReason,
  AuditCheckpoint,
  AuditCheckpointCell,
} from "./checkpoint";
import { AUDIT_MIN_NEXT_PROMPT_BUDGET_MS } from "./run-budget";

/** 다시 묻기를 새로 시작하려면 마감까지 이만큼 남아야 한다(상한 200초 + 판정·저장 여유 35초). */
export const LATE_CELL_REASK_MIN_START_BUDGET_MS =
  LATE_CELL_REASK_TIMEOUT_MS + AUDIT_MIN_NEXT_PROMPT_BUDGET_MS;

/**
 * 한 회차에서 같은 엔진에 동시에 보내는 다시 묻기 수. 질문 배치가 엔진마다 한 번에 하나씩
 * 보내는 원칙(429 보호)을 크게 넘지 않으면서, 같은 엔진의 늦은 칸 2개까지는 한 회차에 담는다.
 */
export const LATE_CELL_REASK_PER_ENGINE_CONCURRENCY = 2;

const cellKey = (promptIndex: number, engineId: string) =>
  `${promptIndex}:${engineId}`;

/** 응답 한 행 → 칸 상태. */
function settledCell(
  promptIndex: number,
  response: EngineResponse,
  at: string
): AuditCheckpointCell {
  if (!response.errorMessage) {
    return {
      promptIndex,
      engineId: response.engineId,
      state: "done",
      firstSettledAt: at,
      updatedAt: at,
    };
  }
  if (isEngineTimeoutMessage(response.errorMessage)) {
    return {
      promptIndex,
      engineId: response.engineId,
      state: "timed_out_pending",
      firstSettledAt: at,
      updatedAt: at,
    };
  }
  return {
    promptIndex,
    engineId: response.engineId,
    state: "failed",
    failureReason: "engine_error",
    firstSettledAt: at,
    updatedAt: at,
  };
}

/** 질문 하나(엔진 배치)의 칸들. */
export function cellsFromBatch(
  promptIndex: number,
  batch: readonly EngineResponse[],
  at: string
): AuditCheckpointCell[] {
  return batch.map((response) => settledCell(promptIndex, response, at));
}

/**
 * 저장된 질문의 모든 칸. 이 기능 이전 checkpoint(cells 없음)나 빠진 칸은
 * 응답 행에서 다시 만든다(시각은 checkpoint 생성 시각 — 정확한 시각을 지어내지 않는다).
 */
export function checkpointCells(
  checkpoint: Pick<AuditCheckpoint, "cells" | "originCreatedAt" | "responses">
): AuditCheckpointCell[] {
  const stored = new Map(
    (checkpoint.cells ?? []).map((cell) => [
      cellKey(cell.promptIndex, cell.engineId),
      cell,
    ])
  );
  return checkpoint.responses.flatMap((batch, promptIndex) =>
    batch.map(
      (response) =>
        stored.get(cellKey(promptIndex, response.engineId)) ??
        settledCell(promptIndex, response, checkpoint.originCreatedAt)
    )
  );
}

/** 다시 물을 수 있는 칸 = 반영 예정이면서 아직 다시 묻기를 쓰지 않은 칸. */
export const reaskableCells = (
  cells: readonly AuditCheckpointCell[]
): AuditCheckpointCell[] =>
  cells.filter(
    (cell) => cell.state === "timed_out_pending" && !cell.reaskStartedAt
  );

export const pendingCells = (
  cells: readonly AuditCheckpointCell[]
): AuditCheckpointCell[] =>
  cells.filter((cell) => cell.state === "timed_out_pending");

/** 운영 로그용 — 엔진별 칸 수. */
export function countByEngine(
  cells: readonly Pick<AuditCheckpointCell, "engineId">[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const cell of cells) {
    counts[cell.engineId] = (counts[cell.engineId] ?? 0) + 1;
  }
  return counts;
}

/**
 * 마감 — 아직 반영 예정인 칸을 최종 실패로 닫는다.
 * 다시 묻기를 시작했던 칸은 사유와 무관하게 reask_interrupted(1회 상한이라 다시 묻지 않는다).
 */
export function closePendingCells(
  cells: readonly AuditCheckpointCell[],
  reason: Extract<AuditCellFailureReason, "not_reasked" | "window_expired">,
  at: string
): { cells: AuditCheckpointCell[]; closed: AuditCheckpointCell[] } {
  const closed: AuditCheckpointCell[] = [];
  const next = cells.map((cell) => {
    if (cell.state !== "timed_out_pending") {
      return cell;
    }
    const failed: AuditCheckpointCell = {
      ...cell,
      state: "failed",
      failureReason: cell.reaskStartedAt ? "reask_interrupted" : reason,
      updatedAt: at,
    };
    closed.push(failed);
    return failed;
  });
  return { cells: next, closed };
}

/** 다시 물어 답을 받은 칸(= 결과에 「늦은 답 반영」이 된 칸). */
export const resolvedLateCells = (
  cells: readonly AuditCheckpointCell[]
): AuditCheckpointCell[] =>
  cells.filter((cell) => cell.state === "done" && cell.reaskStartedAt);

/** 다시 물었던 칸(결과와 무관) — 다시 묻기 원가 집계 범위. */
export const reaskedCells = (
  cells: readonly AuditCheckpointCell[]
): AuditCheckpointCell[] => cells.filter((cell) => cell.reaskStartedAt);

/**
 * 결과 행에 붙일 표시 — 늦은 칸만.
 *   resolved     = 다시 물어 답을 받았다(늦은 답 반영).
 *   final_failed = 60초 상한에 걸렸고 끝내 답을 못 받았다(분모 제외 · 화면이 엔진 이름을 말한다).
 * 처음부터 다른 오류였던 칸(engine_error)·제때 답한 칸은 표시하지 않는다.
 */
export function lateCellMarker(
  cell: AuditCheckpointCell | undefined
): "resolved" | "final_failed" | undefined {
  if (cell?.state === "done") {
    return cell.reaskStartedAt ? "resolved" : undefined;
  }
  if (cell?.state === "failed" && cell.failureReason !== "engine_error") {
    return "final_failed";
  }
  return undefined;
}

export const findCell = (
  cells: readonly AuditCheckpointCell[],
  promptIndex: number | undefined,
  engineId: string
): AuditCheckpointCell | undefined =>
  promptIndex === undefined
    ? undefined
    : cells.find(
        (cell) => cell.promptIndex === promptIndex && cell.engineId === engineId
      );

const SHORT_ENGINE_NAMES: Readonly<Record<string, string>> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

/** revisions[].reason — 예: 「Gemini 늦은 답 반영」, 「Gemini·Claude 늦은 답 반영」. */
export function lateRevisionReason(engineIds: readonly string[]): string {
  const names = [...new Set(engineIds)].map(
    (engineId) => SHORT_ENGINE_NAMES[engineId] ?? engineId
  );
  return `${names.join("·")} 늦은 답 반영`;
}

/** 다시 물은 답으로 그 칸의 응답 행을 바꾼다(실패여도 바꾼다 — 마지막 시도의 사유·시간이 남는다). */
function replaceResponse(
  responses: EngineResponse[][],
  cell: AuditCheckpointCell,
  answer: EngineResponse
): void {
  const batch = responses[cell.promptIndex];
  const position = batch?.findIndex((row) => row.engineId === cell.engineId);
  if (batch && position !== undefined && position >= 0) {
    batch[position] = answer;
  }
}

/** 다시 물은 결과 → 칸의 최종 상태(done 또는 failed). */
function settleReask(
  started: AuditCheckpointCell,
  answer: EngineResponse,
  at: string
): AuditCheckpointCell {
  if (!answer.errorMessage) {
    return { ...started, state: "done", updatedAt: at };
  }
  const failureReason: AuditCellFailureReason = isEngineTimeoutMessage(
    answer.errorMessage
  )
    ? "reask_timed_out"
    : "reask_error";
  return { ...started, state: "failed", failureReason, updatedAt: at };
}

export interface LateReaskRun {
  cells: AuditCheckpointCell[];
  /** 이번 회차에서 다시 묻기를 시작한 칸(시작 시점 상태). */
  reasked: AuditCheckpointCell[];
  responses: EngineResponse[][];
}

/**
 * 다시 묻기 회차 — 반영 예정 칸을 칸마다 최대 1번 다시 묻는다.
 *   · 엔진끼리는 병렬, 같은 엔진은 최대 LATE_CELL_REASK_PER_ENGINE_CONCURRENCY 개까지 동시.
 *   · 새 다시 묻기는 마감까지 LATE_CELL_REASK_MIN_START_BUDGET_MS 이상 남았을 때만 시작한다
 *     (못 시작한 칸은 반영 예정으로 남고, 마감 때 not_reasked 로 닫힌다).
 *   · 「시작」을 먼저 저장하고 묻는다. 저장은 하나씩 순서대로(같은 행을 덮어쓰는 경합 방지).
 */
export async function runLateCellReasks(args: {
  ask: (promptIndex: number, engineId: string) => Promise<EngineResponse>;
  cells: readonly AuditCheckpointCell[];
  now?: () => number;
  responses: readonly EngineResponse[][];
  save: (state: {
    cells: AuditCheckpointCell[];
    responses: EngineResponse[][];
  }) => Promise<void>;
  stopStartingAtMs: number;
}): Promise<LateReaskRun> {
  const now = args.now ?? Date.now;
  let cells = [...args.cells];
  const responses = args.responses.map((batch) => [...batch]);
  const reasked: AuditCheckpointCell[] = [];
  let saving: Promise<void> = Promise.resolve();
  const persist = () => {
    const snapshot = {
      cells: [...cells],
      responses: responses.map((batch) => [...batch]),
    };
    saving = saving.then(() => args.save(snapshot));
    return saving;
  };
  const update = (target: AuditCheckpointCell, patch: AuditCheckpointCell) => {
    cells = cells.map((cell) =>
      cell.promptIndex === target.promptIndex &&
      cell.engineId === target.engineId
        ? patch
        : cell
    );
  };

  const queues = new Map<string, AuditCheckpointCell[]>();
  for (const cell of reaskableCells(cells)) {
    queues.set(cell.engineId, [...(queues.get(cell.engineId) ?? []), cell]);
  }

  const worker = async (queue: AuditCheckpointCell[]) => {
    for (;;) {
      const cell = queue.shift();
      if (!cell) {
        return;
      }
      if (args.stopStartingAtMs - now() < LATE_CELL_REASK_MIN_START_BUDGET_MS) {
        // 남은 칸은 반영 예정 그대로 — 마감이 not_reasked 로 닫는다.
        queue.length = 0;
        return;
      }
      const startedAt = new Date(now()).toISOString();
      const started: AuditCheckpointCell = {
        ...cell,
        reaskStartedAt: startedAt,
        updatedAt: startedAt,
      };
      update(cell, started);
      reasked.push(started);
      await persist();
      const answer = await args.ask(cell.promptIndex, cell.engineId);
      replaceResponse(responses, cell, answer);
      update(
        started,
        settleReask(started, answer, new Date(now()).toISOString())
      );
      await persist();
    }
  };

  await Promise.all(
    [...queues.values()].flatMap((queue) =>
      Array.from(
        {
          length: Math.min(
            LATE_CELL_REASK_PER_ENGINE_CONCURRENCY,
            queue.length
          ),
        },
        () => worker(queue)
      )
    )
  );
  await saving;
  return { cells, reasked, responses };
}
