import type { EngineResponse } from "@repo/ai/lib/engines";
import type { AuditCheckpoint } from "./checkpoint";
import { queryPromptsSequentially } from "./prompt-query-scheduler";

/** The runner's resumable paid-call boundary: only full question batches persist. */
export function runCheckpointedQuestions(
  checkpoint: AuditCheckpoint,
  query: (promptIndex: number) => Promise<EngineResponse[]>,
  save: (checkpoint: AuditCheckpoint) => Promise<void>
): Promise<EngineResponse[][]> {
  return queryPromptsSequentially(
    checkpoint.prompts,
    (_prompt, promptIndex) => query(promptIndex),
    {
      completed: checkpoint.responses,
      onCompleted: (responses) =>
        save({ ...checkpoint, responses: [...responses] }),
    }
  );
}
