/**
 * One audit asks several prompts. Run prompt batches in order so a single
 * provider receives at most one request from that audit at a time. Engines
 * inside an individual batch remain parallel, preserving the normal latency.
 */
export interface PromptQueryOptions<TResult> {
  /** Results already durably checkpointed, in prompt order. */
  completed?: readonly TResult[];
  /** Identifier of the immutable plan that produced completed results. */
  completedPlanKey?: string;
  /** Start of the enclosing invocation, not scheduler entry. */
  invocationStartedAtMs?: number;
  /** Minimum time needed to safely start one more question. */
  minimumNextQuestionBudgetMs?: number;
  /** Await persistence before starting another paid question. */
  onCompleted?: (all: readonly TResult[]) => Promise<void>;
  /** Identifier of the current immutable prompt and engine plan. */
  planKey?: string;
  /** Absolute stop time for starting another question. */
  stopStartingAtMs?: number;
}

function assertMatchingPlan<TResult>(
  completedCount: number,
  options: PromptQueryOptions<TResult>
): void {
  if (
    completedCount > 0 &&
    (!(options.planKey && options.completedPlanKey) ||
      options.planKey !== options.completedPlanKey)
  ) {
    throw new Error("Checkpoint prompt plan does not match current plan");
  }
}

export async function queryPromptsSequentially<TPrompt, TResult>(
  prompts: readonly TPrompt[],
  query: (prompt: TPrompt, absoluteIndex: number) => Promise<TResult>,
  options: PromptQueryOptions<TResult> = {}
): Promise<TResult[]> {
  const results: TResult[] = [...(options.completed ?? [])];
  if (results.length > prompts.length) {
    throw new Error("Completed question count exceeds planned questions");
  }
  assertMatchingPlan(results.length, options);
  if (
    options.stopStartingAtMs !== undefined &&
    options.minimumNextQuestionBudgetMs === undefined
  ) {
    throw new Error("A question budget is required with a stop time");
  }
  const minimumNextQuestionBudgetMs = options.minimumNextQuestionBudgetMs ?? 0;
  if (
    !Number.isFinite(minimumNextQuestionBudgetMs) ||
    minimumNextQuestionBudgetMs < 0
  ) {
    throw new Error("Invalid minimum question budget");
  }
  if (
    options.stopStartingAtMs !== undefined &&
    (!Number.isFinite(options.stopStartingAtMs) ||
      (options.invocationStartedAtMs !== undefined &&
        options.stopStartingAtMs < options.invocationStartedAtMs))
  ) {
    throw new Error("Invalid question stop time");
  }
  for (const [absoluteIndex, prompt] of prompts.entries()) {
    if (absoluteIndex < results.length) {
      continue;
    }
    if (
      options.stopStartingAtMs !== undefined &&
      options.stopStartingAtMs - Date.now() < minimumNextQuestionBudgetMs
    ) {
      break;
    }
    results.push(await query(prompt, absoluteIndex));
    await options.onCompleted?.([...results]);
  }
  return results;
}
