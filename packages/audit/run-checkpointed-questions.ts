import type { EngineResponse } from "@repo/ai/lib/engines";
import type { AuditCheckpoint } from "./checkpoint";
import { queryPromptsSequentially } from "./prompt-query-scheduler";

/** The runner's resumable paid-call boundary: only full question batches persist. */
export function runCheckpointedQuestions(
  checkpoint: AuditCheckpoint,
  query: (promptIndex: number) => Promise<EngineResponse[]>,
  save: (checkpoint: AuditCheckpoint) => Promise<void>
): Promise<EngineResponse[][]> {
  // RELEASE scheduler requires an explicit identity for resumed results.
  // readAuditCheckpoint validates the saved batches against this immutable plan.
  const planKey = JSON.stringify({
    version: checkpoint.version,
    engineConfigVersion: checkpoint.engineConfigVersion,
    prompts: checkpoint.prompts,
    enginePlan: checkpoint.enginePlan,
  });
  return queryPromptsSequentially(
    checkpoint.prompts,
    (_prompt, promptIndex) => query(promptIndex),
    {
      completed: checkpoint.responses,
      completedPlanKey: planKey,
      planKey,
      onCompleted: (responses) =>
        save({ ...checkpoint, responses: [...responses] }),
    }
  );
}
