/* @vitest-environment node */

// W1 RED 매트릭스 8건(순수 모델) + 실패 질문 굶김 방지 정책(cooldown·needs-attention·절반 상한).
// DB 원자성(2·3·5·7)은 prompt-attempt-ledger-postgres.test.ts 가 실제 PG 로 증명한다.

import {
  type AuthoritativeJobLease,
  finishPromptAttempt,
  isDispatchAttempt,
  isSuccessfulMeasurement,
  markPromptAttemptStarted,
  type PromptAttempt,
  type PromptAttemptOutcome,
  reservePromptPlan,
  takeOverPromptPlan,
} from "@repo/audit/prompt-attempt-ledger";
import {
  applyPromptAttemptPolicy,
  PROMPT_ATTEMPT_POLICY,
} from "@repo/audit/prompt-attempt-policy";
import { describe, expect, test } from "vitest";

const T0 = Date.parse("2026-10-05T00:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000);
const lease = (
  token: string,
  untilMinutes = 10_000
): AuthoritativeJobLease => ({
  leaseToken: token,
  leaseUntil: at(untilMinutes),
});
const nine = Array.from({ length: 9 }, (_, index) => ({ id: `p${index + 1}` }));

/** 한 Job(run) 을 예약 → 시작 → 결과까지 순수 모델로 돌린다. */
function runJob(
  ledger: PromptAttempt[],
  job: number,
  prompts: Array<{ id: string; lastTrackedAt?: Date | null }>,
  limit: number,
  outcomeOf: (promptId: string) => PromptAttemptOutcome = () => "completed"
): PromptAttempt[] {
  const jobLease = lease(`lease-${job}`);
  const { eligible } = applyPromptAttemptPolicy({ attempts: ledger, prompts });
  const plan = reservePromptPlan({
    attempts: ledger,
    auditJobId: `job-${job}`,
    brandId: "brand-1",
    leaseToken: jobLease.leaseToken,
    limit,
    prompts: eligible,
    selectedAt: at(job * 10),
  });
  return plan.map((attempt) =>
    finishPromptAttempt(
      markPromptAttemptStarted(attempt, jobLease, at(job * 10 + 1)),
      jobLease,
      at(job * 10 + 2),
      outcomeOf(attempt.promptId)
    )
  );
}

describe("W1 RED matrix — pure state model", () => {
  test("(1) 9 questions / 8 slots / all 8 fail → next job reaches the 9th", () => {
    const first = runJob([], 1, nine, 8, () => "failed");
    expect(first.map((attempt) => attempt.promptId)).not.toContain("p9");
    const second = runJob(first, 2, nine, 8);
    expect(second.map((attempt) => attempt.promptId)).toContain("p9");
  });

  test("(2) crash before selection → no intent exists, a fresh reserve starts from scratch", () => {
    const fresh = reservePromptPlan({
      attempts: [],
      auditJobId: "job-1",
      brandId: "brand-1",
      leaseToken: "lease-1",
      limit: 2,
      prompts: nine,
      selectedAt: at(0),
    });
    expect(fresh.map((attempt) => attempt.selectionSeq)).toEqual([1, 2]);
    expect(fresh.every((attempt) => !isDispatchAttempt(attempt))).toBe(true);
  });

  test("(3) crash after intent → resume returns the identical plan", () => {
    const plan = reservePromptPlan({
      attempts: [],
      auditJobId: "job-1",
      brandId: "brand-1",
      leaseToken: "lease-1",
      limit: 3,
      prompts: nine,
      selectedAt: at(0),
    });
    const resumed = reservePromptPlan({
      attempts: plan,
      auditJobId: "job-1",
      brandId: "brand-1",
      leaseToken: "lease-1",
      limit: 3,
      prompts: nine,
      selectedAt: at(5),
    });
    expect(resumed).toEqual(plan);
  });

  test("(4) crash after dispatch keeps one dispatch; the next lease re-dispatches as attemptNo 2", () => {
    const [selected] = reservePromptPlan({
      attempts: [],
      auditJobId: "job-1",
      brandId: "brand-1",
      leaseToken: "lease-1",
      limit: 1,
      prompts: nine,
      selectedAt: at(0),
    });
    const started = markPromptAttemptStarted(
      selected,
      lease("lease-1", 5),
      at(1)
    );
    expect(isDispatchAttempt(started)).toBe(true);
    const [takenOver] = takeOverPromptPlan({
      attempts: [started],
      auditJobId: "job-1",
      brandId: "brand-1",
      expiredLease: lease("lease-1", 5),
      currentLease: lease("lease-2", 20),
      now: at(6),
    });
    expect(takenOver).toMatchObject({
      attemptNo: 1,
      startedLeaseToken: "lease-1",
    });
    const redispatched = markPromptAttemptStarted(
      takenOver,
      lease("lease-2", 20),
      at(7)
    );
    expect(redispatched).toMatchObject({
      attemptNo: 2,
      startedLeaseToken: "lease-2",
    });
    expect(
      finishPromptAttempt(
        redispatched,
        lease("lease-2", 20),
        at(8),
        "completed"
      ).outcome
    ).toBe("completed");
  });

  test("(5) two plans of one brand (serialized by the brand lock) never overlap", () => {
    const a = reservePromptPlan({
      attempts: [],
      auditJobId: "job-a",
      brandId: "brand-1",
      leaseToken: "lease-a",
      limit: 4,
      prompts: nine,
      selectedAt: at(0),
    });
    const b = reservePromptPlan({
      attempts: a,
      auditJobId: "job-b",
      brandId: "brand-1",
      leaseToken: "lease-b",
      limit: 4,
      prompts: nine,
      selectedAt: at(0),
    });
    const aIds = a.map((attempt) => attempt.promptId);
    expect(b.filter((attempt) => aIds.includes(attempt.promptId))).toEqual([]);
  });

  test("(6) a late lease writes neither started nor finished", () => {
    const [selected] = reservePromptPlan({
      attempts: [],
      auditJobId: "job-1",
      brandId: "brand-1",
      leaseToken: "lease-2",
      limit: 1,
      prompts: nine,
      selectedAt: at(0),
    });
    expect(markPromptAttemptStarted(selected, lease("lease-1"), at(1))).toEqual(
      selected
    );
    const started = markPromptAttemptStarted(selected, lease("lease-2"), at(1));
    expect(
      finishPromptAttempt(started, lease("lease-1"), at(2), "completed")
    ).toEqual(started);
  });

  test("(7) a finish is only a state transition; persisting it with the checkpoint is the DB layer's job", () => {
    const [selected] = reservePromptPlan({
      attempts: [],
      auditJobId: "job-1",
      brandId: "brand-1",
      leaseToken: "lease-1",
      limit: 1,
      prompts: nine,
      selectedAt: at(0),
    });
    const started = markPromptAttemptStarted(selected, lease("lease-1"), at(1));
    const finished = finishPromptAttempt(
      started,
      lease("lease-1"),
      at(2),
      "completed"
    );
    // The input row is untouched, so a rolled-back transaction keeps `started`.
    expect(started.finishedAt).toBeNull();
    expect(finished.finishedAt).toEqual(at(2));
  });

  test("(8) failed / unverified never count as a successful measurement", () => {
    const rows = runJob([], 1, nine.slice(0, 2), 2, (id) =>
      id === "p1" ? "failed" : "unverified"
    );
    expect(rows.map((row) => row.outcome)).toEqual(["failed", "unverified"]);
    expect(rows.some(isSuccessfulMeasurement)).toBe(false);
  });
});

describe("failure-starvation policy", () => {
  test("constants live in one place with the approved numbers", () => {
    expect(PROMPT_ATTEMPT_POLICY).toEqual({
      cooldownAfterConsecutiveFailures: 2,
      cooldownRuns: 2,
      needsAttentionAfterConsecutiveFailures: 5,
      maxExcludedShare: 0.5,
    });
  });

  test("2 consecutive failures → skipped for exactly the next 2 runs", () => {
    const four = nine.slice(0, 4);
    let ledger: PromptAttempt[] = [];
    const picks: string[][] = [];
    for (let job = 1; job <= 5; job += 1) {
      const rows = runJob(ledger, job, four, 4, (id) =>
        id === "p1" && job <= 2 ? "failed" : "completed"
      );
      picks.push(rows.map((row) => row.promptId));
      ledger = [...ledger, ...rows];
    }
    expect(picks.map((ids) => ids.includes("p1"))).toEqual([
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  test("5 consecutive failures → needs attention until a newer success Tracking re-validates it", () => {
    const four = nine.slice(0, 4);
    let ledger: PromptAttempt[] = [];
    // p1 alone keeps failing; it is always re-admitted because it is the only prompt.
    for (let job = 1; job <= 5; job += 1) {
      ledger = [
        ...ledger,
        ...runJob(ledger, job, [four[0]], 1, () => "failed"),
      ];
    }
    // Runs that do not include p1 so the cooldown has long expired.
    for (let job = 6; job <= 8; job += 1) {
      ledger = [...ledger, ...runJob(ledger, job, [four[1]], 1)];
    }
    const blocked = applyPromptAttemptPolicy({
      attempts: ledger,
      prompts: four,
    });
    expect(blocked.verdicts[0]).toMatchObject({
      consecutiveFailures: 5,
      health: "needs_attention",
    });
    expect(blocked.eligible.map((prompt) => prompt.id)).not.toContain("p1");

    const revalidated = applyPromptAttemptPolicy({
      attempts: ledger,
      prompts: [{ ...four[0], lastTrackedAt: at(10_000) }, ...four.slice(1)],
    });
    expect(revalidated.verdicts[0].health).toBe("ok");

    const reset = applyPromptAttemptPolicy({
      attempts: ledger,
      prompts: four,
      resets: [{ promptId: "p1", resetAt: at(10_000) }],
    });
    expect(reset.verdicts[0].health).toBe("ok");
  });

  test("never excludes more than half the saved prompts; re-admits the least recently selected", () => {
    const four = nine.slice(0, 4);
    let ledger: PromptAttempt[] = [];
    for (let job = 1; job <= 2; job += 1) {
      ledger = [
        ...ledger,
        ...runJob(ledger, job, four, 4, (id) =>
          id === "p4" ? "completed" : "failed"
        ),
      ];
    }
    const result = applyPromptAttemptPolicy({
      attempts: ledger,
      prompts: four,
    });
    const excluded = result.verdicts.filter(
      (verdict) => verdict.health !== "ok" && !verdict.readmitted
    );
    expect(excluded).toHaveLength(2);
    expect(result.eligible).toHaveLength(2);
    // p1 was selected first (lowest selectionSeq) → the oldest is re-admitted.
    expect(result.verdicts.find((v) => v.promptId === "p1")?.readmitted).toBe(
      true
    );
  });

  test("unverified / abandoned / unfinished rows are neutral to the streak", () => {
    const two = nine.slice(0, 2);
    let ledger: PromptAttempt[] = [];
    const outcomes: PromptAttemptOutcome[] = ["failed", "unverified", "failed"];
    for (const [index, outcome] of outcomes.entries()) {
      ledger = [
        ...ledger,
        ...runJob(ledger, index + 1, [two[0]], 1, () => outcome),
      ];
    }
    const result = applyPromptAttemptPolicy({ attempts: ledger, prompts: two });
    expect(result.verdicts[0].consecutiveFailures).toBe(2);
  });

  test("never-dispatched intent of an inactive job does not cost the prompt its turn", () => {
    const three = nine.slice(0, 3);
    const plan = reservePromptPlan({
      attempts: [],
      auditJobId: "job-1",
      brandId: "brand-1",
      leaseToken: "lease-1",
      limit: 2,
      prompts: three,
      selectedAt: at(0),
    });
    const ledger = [
      finishPromptAttempt(
        markPromptAttemptStarted(plan[0], lease("lease-1"), at(1)),
        lease("lease-1"),
        at(2),
        "completed"
      ),
      plan[1],
    ];
    const next = reservePromptPlan({
      attempts: ledger,
      auditJobId: "job-2",
      brandId: "brand-1",
      inactiveAuditJobIds: ["job-1"],
      leaseToken: "lease-2",
      limit: 2,
      prompts: three,
      selectedAt: at(10),
    });
    expect(next.map((attempt) => attempt.promptId)).toEqual(["p2", "p3"]);
    expect(next.map((attempt) => attempt.selectionSeq)).toEqual([3, 4]);
  });
});
