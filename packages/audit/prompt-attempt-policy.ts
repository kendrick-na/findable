import type { PromptAttempt } from "./prompt-attempt-ledger";

/**
 * Retry policy for saved questions whose measurement keeps failing
 * (approved by the control tower, 2026-10-05). All numbers live here only.
 *
 * - 2 consecutive failures → skip that question for the next 2 runs (cooldown).
 * - 5 consecutive failures → "needs attention": excluded until a manual reset
 *   or a successful re-validation (a completed attempt or a newer success
 *   Tracking row).
 * - Never exclude more than half of a brand's saved questions; when more would
 *   be excluded, the least recently selected excluded ones are re-admitted.
 */
export const PROMPT_ATTEMPT_POLICY = {
  cooldownAfterConsecutiveFailures: 2,
  cooldownRuns: 2,
  needsAttentionAfterConsecutiveFailures: 5,
  maxExcludedShare: 0.5,
} as const;

export type PromptAttemptHealth = "cooldown" | "needs_attention" | "ok";

export interface PromptAttemptReset {
  promptId: string;
  resetAt: Date;
}

export interface PolicyPrompt {
  id: string;
  lastTrackedAt?: Date | null;
}

export interface PromptPolicyVerdict {
  consecutiveFailures: number;
  health: PromptAttemptHealth;
  latestSelectionSeq: number;
  promptId: string;
  readmitted: boolean;
}

export interface PromptPolicyResult<T extends PolicyPrompt> {
  eligible: T[];
  verdicts: PromptPolicyVerdict[];
}

/**
 * Pure selection filter. `attempts` are the brand's ledger rows from previous
 * jobs (the job being planned must not be included). Outcomes `unverified`,
 * `abandoned` and unfinished rows are neutral: they neither count as a
 * failure nor reset the streak.
 */
export function applyPromptAttemptPolicy<T extends PolicyPrompt>(input: {
  attempts: readonly PromptAttempt[];
  prompts: readonly T[];
  resets?: readonly PromptAttemptReset[];
}): PromptPolicyResult<T> {
  const policy = PROMPT_ATTEMPT_POLICY;
  const planStartSeqByJob = new Map<string, number>();
  for (const attempt of input.attempts) {
    const current = planStartSeqByJob.get(attempt.auditJobId);
    if (current === undefined || attempt.selectionSeq < current) {
      planStartSeqByJob.set(attempt.auditJobId, attempt.selectionSeq);
    }
  }
  const planStarts = [...planStartSeqByJob.values()];

  const latestResetByPrompt = new Map<string, number>();
  for (const reset of input.resets ?? []) {
    latestResetByPrompt.set(
      reset.promptId,
      Math.max(
        latestResetByPrompt.get(reset.promptId) ?? 0,
        reset.resetAt.getTime()
      )
    );
  }

  const attemptsByPrompt = new Map<string, PromptAttempt[]>();
  for (const attempt of input.attempts) {
    const list = attemptsByPrompt.get(attempt.promptId) ?? [];
    list.push(attempt);
    attemptsByPrompt.set(attempt.promptId, list);
  }

  const verdicts: PromptPolicyVerdict[] = input.prompts.map((prompt) => {
    const history = [...(attemptsByPrompt.get(prompt.id) ?? [])].sort(
      (a, b) => b.selectionSeq - a.selectionSeq
    );
    const latestSelectionSeq = history[0]?.selectionSeq ?? 0;
    const { consecutiveFailures, lastFailure } = failureStreak(
      history,
      latestResetByPrompt.get(prompt.id) ?? 0,
      prompt.lastTrackedAt ?? null
    );
    const health = healthOf(
      consecutiveFailures,
      lastFailure,
      planStartSeqByJob,
      planStarts
    );
    return {
      promptId: prompt.id,
      consecutiveFailures,
      health,
      latestSelectionSeq,
      readmitted: false,
    };
  });

  const maxExcluded = Math.floor(
    input.prompts.length * policy.maxExcludedShare
  );
  const excluded = verdicts.filter((verdict) => verdict.health !== "ok");
  if (excluded.length > maxExcluded) {
    const trackedAt = new Map(
      input.prompts.map((prompt) => [
        prompt.id,
        prompt.lastTrackedAt?.getTime() ?? 0,
      ])
    );
    const oldestFirst = [...excluded].sort((a, b) => {
      if (a.latestSelectionSeq !== b.latestSelectionSeq) {
        return a.latestSelectionSeq - b.latestSelectionSeq;
      }
      const aTracked = trackedAt.get(a.promptId) ?? 0;
      const bTracked = trackedAt.get(b.promptId) ?? 0;
      if (aTracked !== bTracked) {
        return aTracked - bTracked;
      }
      if (a.promptId === b.promptId) {
        return 0;
      }
      return a.promptId < b.promptId ? -1 : 1;
    });
    for (const verdict of oldestFirst.slice(0, excluded.length - maxExcluded)) {
      verdict.readmitted = true;
    }
  }

  const blocked = new Set(
    verdicts
      .filter((verdict) => verdict.health !== "ok" && !verdict.readmitted)
      .map((verdict) => verdict.promptId)
  );
  return {
    eligible: input.prompts.filter((prompt) => !blocked.has(prompt.id)),
    verdicts,
  };
}

/**
 * Leading run of `failed` outcomes (newest first) since the latest manual
 * reset. A success Tracking newer than the latest failure re-validates it.
 */
function failureStreak(
  history: readonly PromptAttempt[],
  resetAt: number,
  lastTrackedAt: Date | null
): { consecutiveFailures: number; lastFailure: PromptAttempt | null } {
  let consecutiveFailures = 0;
  let lastFailure: PromptAttempt | null = null;
  for (const attempt of history) {
    if (
      attempt.selectedAt.getTime() < resetAt ||
      attempt.outcome === "completed"
    ) {
      break;
    }
    if (attempt.finishedAt !== null && attempt.outcome === "failed") {
      consecutiveFailures += 1;
      lastFailure ??= attempt;
    }
  }
  if (
    lastFailure?.finishedAt &&
    lastTrackedAt &&
    lastTrackedAt.getTime() > lastFailure.finishedAt.getTime()
  ) {
    return { consecutiveFailures: 0, lastFailure: null };
  }
  return { consecutiveFailures, lastFailure };
}

function healthOf(
  consecutiveFailures: number,
  lastFailure: PromptAttempt | null,
  planStartSeqByJob: ReadonlyMap<string, number>,
  planStarts: readonly number[]
): PromptAttemptHealth {
  const policy = PROMPT_ATTEMPT_POLICY;
  if (consecutiveFailures >= policy.needsAttentionAfterConsecutiveFailures) {
    return "needs_attention";
  }
  if (
    !lastFailure ||
    consecutiveFailures < policy.cooldownAfterConsecutiveFailures
  ) {
    return "ok";
  }
  const failedPlanStart =
    planStartSeqByJob.get(lastFailure.auditJobId) ?? lastFailure.selectionSeq;
  const runsSince = planStarts.filter(
    (start) => start > failedPlanStart
  ).length;
  return runsSince < policy.cooldownRuns ? "cooldown" : "ok";
}
