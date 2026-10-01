import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ updateMany: vi.fn() }));
vi.mock("@repo/database", () => ({
  database: { auditJob: { updateMany: mocks.updateMany } },
}));

import {
  claimAuditExecution,
  saveQuestionCheckpoint,
} from "./audit-execution-lease";

describe("audit execution lease", () => {
  beforeEach(() => vi.clearAllMocks());

  it("claims only a queued job and sets a six-minute fencing lease", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date("2026-10-01T00:00:00.000Z");
    expect(await claimAuditExecution("job-1", now, "token-1")).toBe("token-1");
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "queued" },
      data: {
        status: "processing",
        attemptStartedAt: now,
        leaseToken: "token-1",
        leaseUntil: new Date("2026-10-01T00:06:00.000Z"),
      },
    });
  });

  it("does not grant a second claim to an already-running job", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimAuditExecution("job-1")).toBeNull();
  });

  it("fences every checkpoint write by the current execution token", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      saveQuestionCheckpoint("job-1", "old-token", {} as never)
    ).rejects.toThrow("lost its processing job");
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "job-1",
          status: "processing",
          leaseToken: "old-token",
        },
      })
    );
  });
});
