/**
 * 정리 cron 은 시간창이 지난 이어가기 대기를 실패시키지 않고 잠정 마감한다(2026-10-06).
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  continueOldestPendingAudit: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  database: { auditJob: { updateMany: mocks.updateMany } },
}));
vi.mock("@repo/audit/audit-continuation", () => ({
  continueOldestPendingAudit: mocks.continueOldestPendingAudit,
}));
vi.mock("@repo/audit/sweep-audit-tracking", () => ({
  sweepAuditTrackingReconciliation: vi.fn(async () => ({
    completed: 0,
    skipped: 0,
    failed: 0,
    bounded: false,
  })),
}));
vi.mock("@repo/security/cron", () => ({ denyIfNotCron: () => null }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@repo/observability/ops-alert", () => ({ captureOpsAlert: vi.fn() }));

const { GET } = await import("../app/api/cron/sweep-stuck-jobs/route");

const run = async () =>
  (await (
    await GET(
      new Request("https://www.test/api/cron/sweep-stuck-jobs") as never
    )
  ).json()) as { finalizedContinuation: string | null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 0 });
  mocks.continueOldestPendingAudit.mockResolvedValue(null);
});

describe("sweep-stuck-jobs continuation finalize", () => {
  it("never sends a continuation wait to the queue-timeout failure", async () => {
    await run();
    const queuedSweep = mocks.updateMany.mock.calls
      .map(([args]) => args)
      .find((args) => args.where.status === "queued");
    expect(queuedSweep?.where.leaseUntil).toBeNull();
  });

  it("finalizes one expired wait as provisional via the shared continuation path", async () => {
    mocks.continueOldestPendingAudit.mockResolvedValue({
      jobId: "job_expired",
      mode: "finalize",
      ran: true,
      status: "completed",
    });
    expect((await run()).finalizedContinuation).toBe("job_expired");
    expect(mocks.continueOldestPendingAudit).toHaveBeenCalledWith(
      expect.objectContaining({ expiredOnly: true })
    );
  });

  it("keeps sweeping when the finalize step throws", async () => {
    mocks.continueOldestPendingAudit.mockRejectedValue(new Error("db down"));
    expect((await run()).finalizedContinuation).toBeNull();
  });
});
