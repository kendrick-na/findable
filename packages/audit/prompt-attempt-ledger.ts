export type PromptAttemptOutcome =
  | "abandoned"
  | "completed"
  | "failed"
  | "unverified";

export interface AuthoritativeJobLease {
  leaseToken: string;
  leaseUntil: Date;
}

export interface PromptAttempt {
  attemptNo: number;
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
  startedLeaseToken: string | null;
}

interface ReservePromptPlanInput {
  attempts: PromptAttempt[];
  auditJobId: string;
  brandId: string;
  /**
   * Jobs that are no longer running (completed/failed). Their rows that were
   * selected but never dispatched are reclaimed: they do not push the prompt
   * to the back of the rotation, because no provider attempt happened.
   */
  inactiveAuditJobIds?: readonly string[];
  leaseToken: string;
  limit: number;
  /**
   * `lastTrackedAt` is only a tie-break among prompts with the same durable
   * selection order (e.g. the first ledger run after the flag is enabled). It
   * never back-fills selection history from Tracking.
   */
  prompts: Array<{ id: string; lastTrackedAt?: Date | null }>;
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
  inactiveAuditJobIds = [],
}: ReservePromptPlanInput): PromptAttempt[] {
  const inactiveJobs = new Set(inactiveAuditJobIds);
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
    assertExistingPlan(existing, prompts, limit);
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
    if (attempt.startedAt === null && inactiveJobs.has(attempt.auditJobId)) {
      continue;
    }
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
      const aTracked = a.lastTrackedAt?.getTime() ?? 0;
      const bTracked = b.lastTrackedAt?.getTime() ?? 0;
      if (aTracked !== bTracked) {
        return aTracked - bTracked;
      }
      return compareStableIds(a.id, b.id);
    })
    .slice(0, limit)
    .map((prompt, planIndex) => ({
      attemptNo: 1,
      auditJobId,
      brandId,
      promptId: prompt.id,
      selectionSeq: maxSelectionSeq + planIndex + 1,
      planIndex,
      planSize: Math.min(limit, prompts.length),
      leaseToken,
      selectedAt,
      startedAt: null,
      startedLeaseToken: null,
      finishedAt: null,
      outcome: null,
    }));
}

export function takeOverPromptPlan(input: {
  attempts: PromptAttempt[];
  auditJobId: string;
  brandId: string;
  expiredLease: AuthoritativeJobLease;
  currentLease: AuthoritativeJobLease;
  now: Date;
}): PromptAttempt[] {
  const expiredLeaseToken = input.expiredLease.leaseToken;
  const newLeaseToken = input.currentLease.leaseToken;
  if (
    expiredLeaseToken.length === 0 ||
    newLeaseToken.length === 0 ||
    expiredLeaseToken === newLeaseToken
  ) {
    throw new Error("Lease takeover requires distinct non-empty tokens");
  }
  if (
    !(
      Number.isFinite(input.now.getTime()) &&
      Number.isFinite(input.expiredLease.leaseUntil.getTime()) &&
      Number.isFinite(input.currentLease.leaseUntil.getTime())
    ) ||
    input.now.getTime() <= input.expiredLease.leaseUntil.getTime() ||
    input.now.getTime() > input.currentLease.leaseUntil.getTime()
  ) {
    throw new Error(
      "Lease takeover requires an expired old lease and live current lease"
    );
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
        attempt.leaseToken !== expiredLeaseToken &&
        attempt.leaseToken !== newLeaseToken
    )
  ) {
    throw new Error("Prompt plan has a different live lease");
  }

  return plan.map((attempt) =>
    attempt.finishedAt === null && attempt.leaseToken === expiredLeaseToken
      ? { ...attempt, leaseToken: newLeaseToken }
      : attempt
  );
}

/**
 * Durably mark that Findable is about to dispatch the paid call. A row that a
 * previous (expired, taken-over) lease already started is re-dispatched by the
 * current lease: `attemptNo` counts dispatches, so the earlier attempt is kept
 * as a count instead of being silently overwritten.
 */
export function markPromptAttemptStarted(
  attempt: PromptAttempt,
  liveLease: AuthoritativeJobLease,
  startedAt: Date
): PromptAttempt {
  if (
    !isLiveLease(liveLease, startedAt) ||
    attempt.leaseToken !== liveLease.leaseToken ||
    attempt.finishedAt !== null ||
    attempt.startedLeaseToken === liveLease.leaseToken ||
    !Number.isFinite(startedAt.getTime())
  ) {
    return attempt;
  }
  return {
    ...attempt,
    attemptNo:
      attempt.startedAt === null ? attempt.attemptNo : attempt.attemptNo + 1,
    startedAt,
    startedLeaseToken: liveLease.leaseToken,
  };
}

export function finishPromptAttempt(
  attempt: PromptAttempt,
  liveLease: AuthoritativeJobLease,
  finishedAt: Date,
  outcome: PromptAttemptOutcome
): PromptAttempt {
  if (
    !isLiveLease(liveLease, finishedAt) ||
    attempt.leaseToken !== liveLease.leaseToken ||
    attempt.startedAt === null ||
    attempt.startedLeaseToken === null ||
    attempt.finishedAt !== null ||
    !Number.isFinite(finishedAt.getTime()) ||
    finishedAt.getTime() < attempt.startedAt.getTime()
  ) {
    return attempt;
  }
  if (
    attempt.startedLeaseToken !== liveLease.leaseToken &&
    outcome !== "abandoned"
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

function isLiveLease(lease: AuthoritativeJobLease, now: Date): boolean {
  return (
    lease.leaseToken.length > 0 &&
    Number.isFinite(lease.leaseUntil.getTime()) &&
    Number.isFinite(now.getTime()) &&
    now.getTime() <= lease.leaseUntil.getTime()
  );
}

function compareStableIds(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
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

function assertExistingPlan(
  existing: PromptAttempt[],
  prompts: Array<{ id: string }>,
  limit: number
): void {
  assertUnique(
    existing.map((attempt) => attempt.promptId),
    "attempt prompt"
  );
  assertUnique(
    existing.map((attempt) => String(attempt.planIndex)),
    "attempt plan index"
  );
  const planSize = existing[0]?.planSize ?? 0;
  if (
    new Set(existing.map((attempt) => attempt.planSize)).size !== 1 ||
    !Number.isSafeInteger(planSize) ||
    planSize < 1 ||
    existing.length !== planSize ||
    existing.some((attempt, index) => attempt.planIndex !== index)
  ) {
    throw new Error("Incomplete prompt plan");
  }
  if (planSize > limit) {
    throw new Error("Existing prompt plan exceeds current limit");
  }
  const currentPromptIds = new Set(prompts.map((prompt) => prompt.id));
  if (existing.some((attempt) => !currentPromptIds.has(attempt.promptId))) {
    throw new Error("Existing prompt plan references a missing prompt");
  }
  if (
    new Set(existing.map((attempt) => attempt.selectedAt.getTime())).size !== 1
  ) {
    throw new Error("Prompt plan has inconsistent selectedAt values");
  }
  const unfinishedLeaseTokens = new Set(
    existing
      .filter((attempt) => attempt.finishedAt === null)
      .map((attempt) => attempt.leaseToken)
  );
  if (unfinishedLeaseTokens.size > 1) {
    throw new Error("Prompt plan has multiple unfinished leases");
  }
}
