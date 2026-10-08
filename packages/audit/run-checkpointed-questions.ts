import type { EngineResponse } from "@repo/ai/lib/engines";
import type { AuditCheckpoint } from "./checkpoint";
import { cellsFromBatch, checkpointCells } from "./late-cells";
import { queryPromptsSequentially } from "./prompt-query-scheduler";
import { AUDIT_MIN_NEXT_PROMPT_BUDGET_MS } from "./run-budget";

export interface QuestionBudget {
  /** Start of the enclosing invocation. */
  invocationStartedAtMs?: number;
  /** Minimum remaining time needed to start one more question. */
  minimumNextQuestionBudgetMs?: number;
  /** Absolute time after which no new paid question may start. */
  stopStartingAtMs: number;
}

/**
 * The runner's resumable paid-call boundary: only full question batches persist.
 *
 * 2026-10-07: 질문 하나가 끝날 때마다 그 질문의 **칸(질문×엔진) 상태**도 함께 저장한다
 * (`cells` — done / timed_out_pending / failed + 시각). 60초 상한에 걸린 칸은 오류가 아니라
 * 「반영 예정」이고, 다시 묻기 회차가 그 칸만 다시 묻는다(late-cells).
 */
export function runCheckpointedQuestions(
  checkpoint: AuditCheckpoint,
  query: (promptIndex: number) => Promise<EngineResponse[]>,
  save: (checkpoint: AuditCheckpoint) => Promise<void>,
  budget?: QuestionBudget
): Promise<EngineResponse[][]> {
  // RELEASE scheduler requires an explicit identity for resumed results.
  // readAuditCheckpoint validates the saved batches against this immutable plan.
  const planKey = JSON.stringify({
    version: checkpoint.version,
    engineConfigVersion: checkpoint.engineConfigVersion,
    prompts: checkpoint.prompts,
    enginePlan: checkpoint.enginePlan,
  });
  // 마감(stopStartingAtMs)까지 minimumNextQuestionBudgetMs 미만이면 새 유료 질문을 시작하지
  //   않는다(2026-10-06 — 러너가 예산을 안 넘겨 이 상한이 실제로는 꺼져 있었다).
  //   끝난 질문은 매번 checkpoint 에 저장된다. 부분 결과는 러너의 기존 계약대로
  //   「잠정(provisional)·표본 부족」으로 공개된다(runner.integration.test).
  // 이미 저장된 질문의 칸(이 기능 이전 checkpoint 는 응답 행에서 복원)에 새 질문 칸을 잇는다.
  const cells = checkpointCells(checkpoint);
  let cellsSavedFor = checkpoint.responses.length;
  return queryPromptsSequentially(
    checkpoint.prompts,
    (_prompt, promptIndex) => query(promptIndex),
    {
      completed: checkpoint.responses,
      completedPlanKey: planKey,
      planKey,
      onCompleted: (responses) => {
        const at = new Date().toISOString();
        for (const [promptIndex, batch] of responses.entries()) {
          if (promptIndex >= cellsSavedFor) {
            cells.push(...cellsFromBatch(promptIndex, batch, at));
          }
        }
        cellsSavedFor = responses.length;
        return save({
          ...checkpoint,
          responses: [...responses],
          cells: [...cells],
        });
      },
      ...(budget
        ? {
            invocationStartedAtMs: budget.invocationStartedAtMs,
            minimumNextQuestionBudgetMs:
              budget.minimumNextQuestionBudgetMs ??
              AUDIT_MIN_NEXT_PROMPT_BUDGET_MS,
            stopStartingAtMs: budget.stopStartingAtMs,
          }
        : {}),
    }
  );
}
