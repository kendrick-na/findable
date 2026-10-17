import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateMany, findUnique, findMany, logInfo } = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  logInfo: vi.fn(),
}));
vi.mock("@repo/database", () => ({
  database: { auditJob: { updateMany, findUnique, findMany } },
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: logInfo, warn: vi.fn(), error: vi.fn() },
}));

import { AUDIT_CONTINUATION_WINDOW_MS } from "./audit-execution-lease";
import {
  type AuditCheckpoint,
  makeAuditCheckpoint,
  readAuditCheckpoint,
} from "./checkpoint";
import {
  decideStuckResume,
  resumeStuckAuditJob,
  resumeStuckProcessingJobs,
} from "./resume-stuck";
import { isStabilityFlagOn } from "./stability-flags";
import {
  AUDIT_JOB_STALE_AFTER_MS,
  AUDIT_JOB_STALE_ERROR,
  reconcileStaleAuditJob,
  staleAuditJobsWhere,
} from "./stale-job";

const FLAG = "STABILITY_RESUME_STUCK_ENABLED";
const scope = {
  brandId: "brand-1",
  domain: "example.com",
  language: "both" as const,
  organizationId: "org-1",
};
const context = {
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
};
const createdAt = new Date(Date.now() - 20 * 60 * 1000);
const prompts = Array.from({ length: 20 }, (_, index) => ({
  text: `question ${index + 1}`,
  lang: "ko" as const,
  kind: "brand" as const,
}));

const checkpointWith = (
  done: number,
  extra: Partial<AuditCheckpoint> = {}
): AuditCheckpoint => {
  const base = makeAuditCheckpoint(
    scope,
    context,
    prompts,
    createdAt.toISOString()
  );
  return {
    ...base,
    responses: base.enginePlan.slice(0, done).map((engines) =>
      engines.map((engineId) => ({
        engineId,
        rawResponse: "답",
        brandMentioned: false,
        citedSources: [],
        durationMs: 10,
        isStub: false,
        errorMessage: null,
      }))
    ) as unknown as AuditCheckpoint["responses"],
    ...extra,
  };
};

const stuckRow = (
  checkpoint: unknown,
  extra: Record<string, unknown> = {}
) => ({
  id: "job-1",
  status: "processing",
  leaseToken: "tok-1",
  brandId: scope.brandId,
  organizationId: scope.organizationId,
  domain: scope.domain,
  language: scope.language,
  createdAt,
  checkpoint,
  ...extra,
});

describe("U3 flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("is off by default", () => {
    expect(isStabilityFlagOn(FLAG, {})).toBe(false);
  });
});

describe("decideStuckResume", () => {
  it("resumes a stale job with 7 of 20 answers and bumps continuation.count", () => {
    const decision = decideStuckResume(stuckRow(checkpointWith(7)));
    expect(decision.resume).toBe(true);
    if (decision.resume) {
      expect(decision.completed).toBe(7);
      expect(decision.total).toBe(20);
      expect(decision.checkpoint.continuation?.count).toBe(1);
      expect(decision.checkpoint.responses).toHaveLength(7);
      // 옛 코드(기준 커밋)의 reader 도 그대로 읽는다 — 새 필드 없음(N5).
      expect(readAuditCheckpoint(decision.checkpoint, scope)).not.toBeNull();
      expect(Object.keys(decision.checkpoint).sort()).toEqual(
        [...Object.keys(checkpointWith(7)), "continuation"].sort()
      );
    }
  });

  it("keeps failing when no answer was saved", () => {
    expect(decideStuckResume(stuckRow(checkpointWith(0)))).toEqual({
      resume: false,
      reason: "no_progress",
    });
    expect(decideStuckResume(stuckRow(null))).toEqual({
      resume: false,
      reason: "no_progress",
    });
  });

  it("keeps the old path when the limit is spent or all questions are done", () => {
    const spent = checkpointWith(7, {
      continuation: { count: 2, requestedAt: new Date().toISOString() },
    });
    expect(decideStuckResume(stuckRow(spent))).toEqual({
      resume: false,
      reason: "limit_reached",
    });
    expect(decideStuckResume(stuckRow(checkpointWith(20)))).toEqual({
      resume: false,
      reason: "all_done",
    });
  });

  it("counts up from an earlier continuation", () => {
    const once = checkpointWith(7, {
      continuation: { count: 1, requestedAt: new Date().toISOString() },
    });
    const decision = decideStuckResume(stuckRow(once));
    expect(decision.resume && decision.checkpoint.continuation?.count).toBe(2);
  });

  it("does not resume jobs without org/brand, corrupt checkpoints, or expired age", () => {
    expect(
      decideStuckResume(stuckRow(checkpointWith(7), { organizationId: null }))
    ).toEqual({ resume: false, reason: "no_scope" });
    expect(decideStuckResume(stuckRow({ version: 9 }))).toEqual({
      resume: false,
      reason: "invalid_checkpoint",
    });
    expect(
      decideStuckResume(
        stuckRow(checkpointWith(7)),
        createdAt.getTime() + 25 * 60 * 60 * 1000
      )
    ).toEqual({ resume: false, reason: "too_old" });
  });
});

describe("resumeStuckAuditJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  const staleWhere = () => staleAuditJobsWhere("processing", new Date());

  it("moves to queued + leaseUntil with a conditional updateMany", async () => {
    findUnique.mockResolvedValue(stuckRow(checkpointWith(7)));
    updateMany.mockResolvedValue({ count: 1 });
    const now = new Date();
    const outcome = await resumeStuckAuditJob({
      jobId: "job-1",
      now,
      staleWhere: staleWhere(),
    });
    expect(outcome).toEqual({ resumed: true });
    const args = updateMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      id: "job-1",
      status: "processing",
      leaseToken: "tok-1",
    });
    expect(args.data).toMatchObject({
      status: "queued",
      leaseToken: null,
      attemptStartedAt: now,
    });
    expect(args.data.leaseUntil.getTime()).toBe(
      now.getTime() + AUDIT_CONTINUATION_WINDOW_MS
    );
    expect(args.data.checkpoint.continuation.count).toBe(1);
    expect(logInfo).toHaveBeenCalledWith("audit.stuck.resumed", {
      jobId: "job-1",
      completedQuestions: 7,
      totalQuestions: 20,
      continuation: 1,
    });
  });

  it("does nothing when someone else already took the job (count 0) and stays idempotent", async () => {
    findUnique.mockResolvedValue(stuckRow(checkpointWith(7)));
    updateMany.mockResolvedValue({ count: 0 });
    const first = await resumeStuckAuditJob({
      jobId: "job-1",
      staleWhere: staleWhere(),
    });
    expect(first).toEqual({ resumed: false, reason: "lost_race" });
    // 두 번째 실행: 이미 queued 로 바뀐 행 → updateMany 호출조차 없다.
    updateMany.mockClear();
    findUnique.mockResolvedValue(
      stuckRow(checkpointWith(7), { status: "queued" })
    );
    const second = await resumeStuckAuditJob({
      jobId: "job-1",
      staleWhere: staleWhere(),
    });
    expect(second).toEqual({ resumed: false, reason: "lost_race" });
    expect(updateMany).not.toHaveBeenCalled();
    expect(logInfo).not.toHaveBeenCalled();
  });

  it("never writes when the job has no progress", async () => {
    findUnique.mockResolvedValue(stuckRow(checkpointWith(0)));
    const outcome = await resumeStuckAuditJob({
      jobId: "job-1",
      staleWhere: staleWhere(),
    });
    expect(outcome).toEqual({ resumed: false, reason: "no_progress" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("sweeps candidates and counts only the resumed ones", async () => {
    findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    findUnique
      .mockResolvedValueOnce(stuckRow(checkpointWith(7), { id: "a" }))
      .mockResolvedValueOnce(stuckRow(checkpointWith(0), { id: "b" }));
    updateMany.mockResolvedValue({ count: 1 });
    expect(
      await resumeStuckProcessingJobs({
        now: new Date(),
        staleWhere: staleWhere(),
      })
    ).toBe(1);
  });
});

describe("reconcileStaleAuditJob (start-tracking path) agrees with the sweep", () => {
  const stale = {
    id: "job-1",
    email: "org:org-1",
    createdAt,
    attemptStartedAt: new Date(Date.now() - AUDIT_JOB_STALE_AFTER_MS - 60_000),
    leaseUntil: null,
    status: "processing" as const,
  };
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("flag off: fails exactly as before and never reads the checkpoint", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    expect(await reconcileStaleAuditJob(stale)).toBe("failed");
    expect(findUnique).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].data).toMatchObject({
      status: "failed",
      errorMessage: AUDIT_JOB_STALE_ERROR,
      leaseToken: null,
      leaseUntil: null,
    });
  });

  it("flag on with saved answers: returns queued (start-tracking then keeps the old job)", async () => {
    vi.stubEnv(FLAG, "true");
    findUnique.mockResolvedValue(stuckRow(checkpointWith(7)));
    updateMany.mockResolvedValue({ count: 1 });
    expect(await reconcileStaleAuditJob(stale)).toBe("queued");
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].data.status).toBe("queued");
    expect(updateMany.mock.calls[0][0].where).toMatchObject({
      email: "org:org-1",
      status: "processing",
    });
  });

  it("flag on without answers: falls through to the same failed update", async () => {
    vi.stubEnv(FLAG, "true");
    findUnique.mockResolvedValue(stuckRow(checkpointWith(0)));
    updateMany.mockResolvedValue({ count: 1 });
    expect(await reconcileStaleAuditJob(stale)).toBe("failed");
    expect(updateMany.mock.calls[0][0].data).toMatchObject({
      status: "failed",
      errorMessage: AUDIT_JOB_STALE_ERROR,
    });
  });
});
