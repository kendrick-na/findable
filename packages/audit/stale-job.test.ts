import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMany, findUnique } = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUnique: vi.fn(),
}));
vi.mock("@repo/database", () => ({
  database: { auditJob: { updateMany, findUnique } },
}));

import {
  AUDIT_JOB_QUEUE_STALE_AFTER_MS,
  AUDIT_JOB_QUEUE_STALE_ERROR,
  AUDIT_JOB_STALE_AFTER_MS,
  AUDIT_JOB_STALE_ERROR,
  isStaleAuditJob,
  reconcileStaleAuditJob,
} from "./stale-job";

const oldJob = {
  id: "job-1",
  email: "org:one",
  createdAt: new Date(Date.now() - AUDIT_JOB_STALE_AFTER_MS - 60_000),
  status: "processing" as const,
};

describe("serverless audit timeout recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not falsely fail an active measurement", async () => {
    const job = { ...oldJob, createdAt: new Date() };
    expect(isStaleAuditJob(job)).toBe(false);
    expect(await reconcileStaleAuditJob(job)).toBe("processing");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("uses the resumed attempt instead of the original job creation time", async () => {
    const resumed = {
      ...oldJob,
      attemptStartedAt: new Date(),
      leaseUntil: null,
    };
    expect(isStaleAuditJob(resumed)).toBe(false);
    expect(await reconcileStaleAuditJob({ ...resumed, email: "org:one" })).toBe(
      "processing"
    );
    expect(updateMany).not.toHaveBeenCalled();
  });
  it("does not kill a delayed but unclaimed job on the execution timeout", () => {
    const queued = { ...oldJob, status: "queued" as const };
    expect(isStaleAuditJob(queued)).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });
  it("expires a queue entry only after its separate thirty-minute limit", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const queued = {
      ...oldJob,
      status: "queued" as const,
      createdAt: new Date(Date.now() - AUDIT_JOB_QUEUE_STALE_AFTER_MS - 60_000),
    };
    expect(isStaleAuditJob(queued)).toBe(true);
    expect(await reconcileStaleAuditJob(queued)).toBe("failed");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "queued" }),
        data: expect.objectContaining({
          errorMessage: AUDIT_JOB_QUEUE_STALE_ERROR,
        }),
      })
    );
  });

  it("expires an abandoned execution lease", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const expired = {
      ...oldJob,
      attemptStartedAt: new Date(),
      leaseUntil: new Date(Date.now() - 1000),
    };
    expect(isStaleAuditJob(expired)).toBe(true);
    expect(await reconcileStaleAuditJob({ ...expired, email: "org:one" })).toBe(
      "failed"
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leaseUntil: { lt: expect.any(Date) },
        }),
      })
    );
  });

  it("atomically fails a timed-out measurement under its original owner", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    expect(await reconcileStaleAuditJob(oldJob)).toBe("failed");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "job-1",
          email: "org:one",
          status: "processing",
        }),
        data: expect.objectContaining({
          status: "failed",
          errorMessage: AUDIT_JOB_STALE_ERROR,
        }),
      })
    );
  });

  it("preserves a completion that races with timeout cleanup", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue({ status: "completed" });
    expect(await reconcileStaleAuditJob(oldJob)).toBe("completed");
  });
});
