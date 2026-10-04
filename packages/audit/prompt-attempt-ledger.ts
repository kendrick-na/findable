export type PromptAttemptOutcome = "completed" | "failed" | "unverified";

export interface PromptAttempt {
  auditJobId: string;
  brandId: string;
  finishedAt: Date | null;
  leaseToken: string;
  outcome: PromptAttemptOutcome | null;
  planIndex: number;
  planSize: number;
  promptId: string;
  selectedAt: Date;
  selectionSeq: number;
  startedAt: Date | null;
}

interface ReservePromptPlanInput {
  attempts: PromptAttempt[];
  auditJobId: string;
  brandId: string;
  leaseToken: string;
  limit: number;
  prompts: Array<{ id: string }>;
  selectedAt: Date;
}

/**
 * Future PromptAttempt persistence contract expressed as a pure state model.
 * The caller must provide the brand lock, live-lease check, transaction and
 * database uniqueness constraints described in the W1 contract.
 */
export function reservePromptPlan({
  auditJobId,
  brandId,
  leaseToken,
  prompts,
  attempts,
  selectedAt,
  limit,
}: ReservePromptPlanInput): PromptAttempt[] {
  if (
    attempts.some(
      (attempt) =>
        attempt.auditJobId === auditJobId && attempt.brandId !== brandId
    )
  ) {
    throw new Error("Audit job belongs to another brand");
  }

  const brandAttempts = attempts.filter(
    (attempt) => attempt.brandId === brandId
  );
  assertSelectionSequences(brandAttempts);

  const existing = attempts
    .filter(
      (attempt) =>
        attempt.auditJobId === auditJobId && attempt.brandId === brandId
    )
    .sort((a, b) => a.planIndex - b.planIndex);

  if (existing.length > 0) {
    assertUnique(
      existing.map((attempt) => attempt.promptId),
      "attempt prompt"
    );
    assertUnique(
      existing.map((attempt) => String(attempt.planIndex)),
      "attempt plan index"
    );
    const planSizes = new Set(existing.map((attempt) => attempt.planSize));
    const planSize = existing[0]?.planSize ?? 0;
    if (
      planSizes.size !== 1 ||
      !Number.isSafeInteger(planSize) ||
      planSize < 1 ||
      existing.length !== planSize ||
      existing.some((attempt, index) => attempt.planIndex !== index)
    ) {
      throw new Error("Incomplete prompt plan");
    }
    return existing;
  }

  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error("Prompt plan limit must be a non-negative integer");
  }
  if (!Number.isFinite(selectedAt.getTime())) {
    throw new Error("Prompt plan selectedAt must be a valid date");
  }

  assertUnique(
    prompts.map((prompt) => prompt.id),
    "prompt"
  );

  const latestSelectionByPrompt = new Map<string, number>();
  let maxSelectionSeq = 0;

  for (const attempt of brandAttempts) {
    if (
      !Number.isSafeInteger(attempt.selectionSeq) ||
      attempt.selectionSeq < 1
    ) {
      throw new Error("Prompt attempt selectionSeq must be a positive integer");
    }
    maxSelectionSeq = Math.max(maxSelectionSeq, attempt.selectionSeq);
    latestSelectionByPrompt.set(
      attempt.promptId,
      Math.max(
        latestSelectionByPrompt.get(attempt.promptId) ?? 0,
        attempt.selectionSeq
      )
    );
  }

  return [...prompts]
    .sort((a, b) => {
      const aSequence = latestSelectionByPrompt.get(a.id) ?? 0;
      const bSequence = latestSelectionByPrompt.get(b.id) ?? 0;
      if (aSequence !== bSequence) {
        return aSequence - bSequence;
      }
      return a.id.localeCompare(b.id);
    })
    .slice(0, limit)
    .map((prompt, planIndex) => ({
      auditJobId,
      brandId,
      promptId: prompt.id,
      selectionSeq: maxSelectionSeq + planIndex + 1,
      planIndex,
      planSize: Math.min(limit, prompts.length),
      leaseToken,
      selectedAt,
      startedAt: null,
      finishedAt: null,
      outcome: null,
    }));
}

export function takeOverPromptPlan(input: {
  attempts: PromptAttempt[];
  auditJobId: string;
  brandId: string;
  expiredLeaseToken: string;
  newLeaseToken: string;
}): PromptAttempt[] {
  if (
    input.expiredLeaseToken.length === 0 ||
    input.newLeaseToken.length === 0 ||
    input.expiredLeaseToken === input.newLeaseToken
  ) {
    throw new Error("Lease takeover requires distinct non-empty tokens");
  }

  const plan = input.attempts
    .filter(
      (attempt) =>
        attempt.auditJobId === input.auditJobId &&
        attempt.brandId === input.brandId
    )
    .sort((a, b) => a.planIndex - b.planIndex);
  if (plan.length === 0) {
    throw new Error("Prompt plan not found");
  }
  if (
    plan.some(
      (attempt) =>
        attempt.finishedAt === null &&
        attempt.leaseToken !== input.expiredLeaseToken &&
        attempt.leaseToken !== input.newLeaseToken
    )
  ) {
    throw new Error("Prompt plan has a different live lease");
  }

  return plan.map((attempt) =>
    attempt.finishedAt === null &&
    attempt.leaseToken === input.expiredLeaseToken
      ? { ...attempt, leaseToken: input.newLeaseToken }
      : attempt
  );
}

export function markPromptAttemptStarted(
  attempt: PromptAttempt,
  liveLeaseToken: string,
  startedAt: Date
): PromptAttempt {
  if (
    attempt.leaseToken !== liveLeaseToken ||
    attempt.startedAt !== null ||
    !Number.isFinite(startedAt.getTime())
  ) {
    return attempt;
  }
  return { ...attempt, startedAt };
}

export function finishPromptAttempt(
  attempt: PromptAttempt,
  liveLeaseToken: string,
  finishedAt: Date,
  outcome: PromptAttemptOutcome
): PromptAttempt {
  if (
    attempt.leaseToken !== liveLeaseToken ||
    attempt.startedAt === null ||
    attempt.finishedAt !== null ||
    !Number.isFinite(finishedAt.getTime()) ||
    finishedAt.getTime() < attempt.startedAt.getTime()
  ) {
    return attempt;
  }
  return { ...attempt, finishedAt, outcome };
}

export function isDispatchAttempt(attempt: PromptAttempt): boolean {
  return attempt.startedAt !== null;
}

export function isSuccessfulMeasurement(attempt: PromptAttempt): boolean {
  return attempt.finishedAt !== null && attempt.outcome === "completed";
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Duplicate ${label} is not allowed`);
  }
}

function assertSelectionSequences(attempts: PromptAttempt[]): void {
  for (const attempt of attempts) {
    if (
      !Number.isSafeInteger(attempt.selectionSeq) ||
      attempt.selectionSeq < 1
    ) {
      throw new Error("Prompt attempt selectionSeq must be a positive integer");
    }
  }
  if (
    new Set(attempts.map((attempt) => attempt.selectionSeq)).size !==
    attempts.length
  ) {
    throw new Error("Duplicate brand selection sequence");
  }
}
