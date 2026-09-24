import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMany, findUnique } = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUnique: vi.fn(),
}));
vi.mock("@repo/database", () => ({
  database: { auditJob: { updateMany, findUnique } },
}));

import {
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

  it("atomically fails a timed-out measurement under its original owner", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    expect(await reconcileStaleAuditJob(oldJob)).toBe("failed");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "job-1",
          email: "org:one",
          status: { in: ["queued", "processing"] },
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
