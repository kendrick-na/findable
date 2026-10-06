import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory AuditJob table that evaluates the same `where` shapes the audit
// package sends to Prisma (equality, null, lt/gt/in, OR). It lets the lease,
// stale and resume paths race against one shared row without a real database
// or any paid provider call.
type Row = Record<string, unknown>;
const store = vi.hoisted(() => ({ rows: new Map<string, Row>() }));

const matches = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, cond]) => {
    if (key === "OR") {
      return (cond as Row[]).some((branch) => matches(row, branch));
    }
    const value = row[key] ?? null;
    if (cond === null) {
      return value === null;
    }
    if (cond instanceof Date) {
      return value instanceof Date && value.getTime() === cond.getTime();
    }
    if (typeof cond === "object") {
      const op = cond as { lt?: Date; gt?: Date; in?: unknown[] };
      if (op.in) {
        return op.in.includes(value);
      }
      if (!(value instanceof Date)) {
        return false;
      }
      if (op.lt && !(value.getTime() < op.lt.getTime())) {
        return false;
      }
      if (op.gt && !(value.getTime() > op.gt.getTime())) {
        return false;
      }
      return true;
    }
    return value === cond;
  });

vi.mock("@repo/database", () => ({
  database: {
    auditJob: {
      updateMany: ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const row of store.rows.values()) {
          if (matches(row, where)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(store.rows.get(where.id) ?? null),
    },
  },
}));

import {
  claimAuditExecution,
  saveQuestionCheckpoint,
} from "./audit-execution-lease";
import {
  type AuditCheckpoint,
  makeAuditCheckpoint,
  nextAuditCheckpointAttempt,
  readAuditCheckpoint,
} from "./checkpoint";
import { runCheckpointedQuestions } from "./run-checkpointed-questions";
import {
  AUDIT_JOB_STALE_ERROR,
  isStaleAuditJob,
  reconcileStaleAuditJob,
  staleAuditJobsWhere,
} from "./stale-job";

const scope = {
  brandId: "brand-1",
  domain: "example.com",
  language: "both" as const,
  organizationId: "org-1",
};
const T0 = new Date("2026-10-02T03:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

const plan = (createdAt: Date) =>
  makeAuditCheckpoint(
    scope,
    {
      brandName: "Example",
      brandVariants: [],
      identityGrounded: true,
      officialSiteIdentity: {
        finalUrl: "https://example.com",
        title: "Example",
        description: null,
        h1: null,
        siteName: null,
      },
    },
    [
      { text: "q1", lang: "ko" },
      { text: "q2", lang: "en" },
      { text: "q3", lang: "ko" },
      { text: "q4", lang: "en" },
    ],
    createdAt.toISOString()
  );

const fixtureBatch = (checkpoint: AuditCheckpoint, index: number) =>
  checkpoint.enginePlan[index].map((engineId) => ({
    engineId,
    rawResponse: `fixture answer ${index}`,
    brandMentioned: false,
    citedSources: [],
    durationMs: 1,
    isStub: false,
    errorMessage: null,
  })) as never;

const job = () => store.rows.get("job-1") as Row;
const fencedCommit = (token: string) =>
  // Mirrors runner.ts db_commit: only the live lease may complete the Job.
  import("@repo/database").then(({ database }) =>
    database.auditJob.updateMany({
      where: { id: "job-1", status: "processing", leaseToken: token },
      data: {
        status: "completed",
        result: { ok: true },
        checkpoint: null as never,
        leaseToken: null,
        leaseUntil: null,
      },
    })
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  store.rows.clear();
  store.rows.set("job-1", {
    id: "job-1",
    email: "org:org-1",
    status: "queued",
    createdAt: T0,
    attemptStartedAt: null,
    leaseToken: null,
    leaseUntil: null,
    checkpoint: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkpoint resume E2E (fixture provider, in-memory job row)", () => {
  it("survives a mid-run kill, fences the zombie writer and pays only unfinished questions", async () => {
    // Attempt A claims the Job and writes the plan under its lease.
    const tokenA = await claimAuditExecution("job-1", T0, "lease-A");
    expect(tokenA).toBe("lease-A");
    const initial = plan(T0);
    await saveQuestionCheckpoint("job-1", "lease-A", initial);

    // The platform kills A after two full question batches.
    const paidA: number[] = [];
    await expect(
      runCheckpointedQuestions(
        initial,
        (index) => {
          if (index === 2) {
            return Promise.reject(new Error("FUNCTION_INVOCATION_TIMEOUT"));
          }
          paidA.push(index);
          return Promise.resolve(fixtureBatch(initial, index));
        },
        (next) => saveQuestionCheckpoint("job-1", "lease-A", next)
      )
    ).rejects.toThrow("FUNCTION_INVOCATION_TIMEOUT");
    expect(paidA).toEqual([0, 1]);

    // Runner catch never ran; the lease alone decides staleness.
    vi.setSystemTime(minutes(5));
    expect(isStaleAuditJob(job() as never)).toBe(false);
    vi.setSystemTime(minutes(7));
    expect(await reconcileStaleAuditJob(job() as never)).toBe("failed");
    expect(job().errorMessage).toBe(AUDIT_JOB_STALE_ERROR);

    // Explicit resume: bounded next attempt, same Job, same plan.
    const saved = readAuditCheckpoint(job().checkpoint, scope);
    expect(saved?.responses).toHaveLength(2);
    const next = nextAuditCheckpointAttempt(saved as AuditCheckpoint);
    expect(next?.retry).toEqual({
      attempt: 2,
      attemptStartResponses: 2,
      noProgressFailures: 0,
    });
    Object.assign(job(), {
      status: "queued",
      errorMessage: null,
      attemptStartedAt: minutes(7),
      checkpoint: next,
    });

    // Two workers race for the requeued Job: exactly one lease is granted.
    const [tokenB, tokenC] = await Promise.all([
      claimAuditExecution("job-1", minutes(7), "lease-B"),
      claimAuditExecution("job-1", minutes(7), "lease-C"),
    ]);
    expect([tokenB, tokenC].filter(Boolean)).toEqual(["lease-B"]);

    // The zombie A wakes up late: neither checkpoint nor completion may land.
    await expect(
      saveQuestionCheckpoint("job-1", "lease-A", initial)
    ).rejects.toThrow("lost its processing job");
    expect((await fencedCommit("lease-A")).count).toBe(0);

    // Attempt B resumes from the saved prefix and pays q3, q4 only.
    const resumed = readAuditCheckpoint(
      job().checkpoint,
      scope
    ) as AuditCheckpoint;
    const paidB: number[] = [];
    const all = await runCheckpointedQuestions(
      resumed,
      (index) => {
        paidB.push(index);
        return Promise.resolve(fixtureBatch(resumed, index));
      },
      (updated) => saveQuestionCheckpoint("job-1", "lease-B", updated)
    );
    expect(paidB).toEqual([2, 3]);
    expect(all.map((batch) => batch.length)).toEqual([6, 4, 6, 4]);
    expect((await fencedCommit("lease-B")).count).toBe(1);
    expect(job()).toMatchObject({
      status: "completed",
      checkpoint: null,
      leaseToken: null,
    });
  });

  it("stops a resume that made no progress instead of paying forever", () => {
    let checkpoint: AuditCheckpoint | null = plan(T0);
    const attempts: number[] = [];
    // Every attempt dies before saving a single question.
    while (checkpoint) {
      attempts.push(checkpoint.retry.attempt);
      checkpoint = nextAuditCheckpointAttempt(checkpoint);
    }
    expect(attempts).toEqual([1, 2]);
  });
});

describe("sweep cron and per-job staleness share one criterion", () => {
  const cases: [string, Row][] = [
    ["fresh queued", { status: "queued", createdAt: minutes(-20) }],
    ["old queued", { status: "queued", createdAt: minutes(-31) }],
    [
      "requeued recently",
      {
        status: "queued",
        createdAt: minutes(-600),
        attemptStartedAt: minutes(-5),
      },
    ],
    [
      "live lease",
      {
        status: "processing",
        createdAt: minutes(-20),
        attemptStartedAt: minutes(-2),
        leaseUntil: minutes(4),
      },
    ],
    [
      "expired lease",
      {
        status: "processing",
        createdAt: minutes(-20),
        attemptStartedAt: minutes(-7),
        leaseUntil: minutes(-1),
      },
    ],
    [
      "legacy processing, no lease",
      { status: "processing", createdAt: minutes(-7) },
    ],
    [
      "legacy processing, young",
      { status: "processing", createdAt: minutes(-3) },
    ],
    ["completed", { status: "completed", createdAt: minutes(-600) }],
    // 2026-10-06 이어가기 대기(queued + leaseUntil): 30분 대기열 상한이 아니라 시간창으로 판정.
    [
      "continuation pending past the plain queue limit",
      {
        status: "queued",
        createdAt: minutes(-50),
        attemptStartedAt: minutes(-45),
        leaseUntil: minutes(75),
      },
    ],
    [
      "continuation window expired",
      {
        status: "queued",
        createdAt: minutes(-200),
        attemptStartedAt: minutes(-121),
        leaseUntil: minutes(-1),
      },
    ],
  ];

  it.each(cases)("%s", (_name, partial) => {
    const row: Row = {
      attemptStartedAt: null,
      leaseUntil: null,
      ...partial,
    };
    const swept =
      matches(row, staleAuditJobsWhere("queued", T0)) ||
      matches(row, staleAuditJobsWhere("processing", T0));
    expect(swept).toBe(isStaleAuditJob(row as never, T0.getTime()));
  });
});
