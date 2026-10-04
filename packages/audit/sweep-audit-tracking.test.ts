import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
const reconcile = vi.fn();
const reconcileBriefing = vi.fn();
vi.mock("@repo/database", () => ({ database: { $queryRawUnsafe: queryRaw } }));
vi.mock("./reconcile-audit-tracking", () => ({ reconcileAuditTracking: reconcile }));
vi.mock("./reconcile-briefing-tracking", () => ({ reconcileBriefingTracking: reconcileBriefing }));
vi.mock("@repo/observability/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { sweepAuditTrackingReconciliation } = await import("./sweep-audit-tracking");

describe("sweepAuditTrackingReconciliation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses a bounded age-filtered candidate batch and rechecks each marker", async () => {
    queryRaw.mockResolvedValue([{ id: "job-pending", corePending: true, briefingPending: false }, { id: "job-raced", corePending: true, briefingPending: false }]);
    reconcile.mockResolvedValueOnce("completed").mockResolvedValueOnce("skipped");
    await expect(
      sweepAuditTrackingReconciliation(new Date("2026-10-04T00:00:00Z"))
    ).resolves.toMatchObject({ completed: 1, skipped: 1, failed: 0, bounded: false });
    expect(queryRaw).toHaveBeenCalledWith(
      expect.stringContaining("postprocessing"),
      new Date("2026-10-03T23:50:00.000Z"),
      10
    );
    expect(reconcile).toHaveBeenNthCalledWith(2, "job-raced");
    expect(reconcileBriefing).not.toHaveBeenCalled();
  });

  it("selects a briefing-only crash without invoking core replay", async () => {
    queryRaw.mockResolvedValue([{ id: "job-briefing", corePending: false, briefingPending: true }]);
    reconcileBriefing.mockResolvedValue("completed");
    await expect(sweepAuditTrackingReconciliation()).resolves.toMatchObject({ completed: 1, failed: 0 });
    expect(reconcileBriefing).toHaveBeenCalledWith("job-briefing");
    expect(reconcile).not.toHaveBeenCalled();
    expect(queryRaw.mock.calls[0][0]).toContain("briefingTracking");
  });

  it("does not treat a full batch as unbounded", async () => {
    queryRaw.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ id: `job-${i}`, corePending: true, briefingPending: false })));
    reconcile.mockResolvedValue("skipped");
    await expect(sweepAuditTrackingReconciliation()).resolves.toMatchObject({ bounded: true });
  });

  it("returns bounded when candidate DB lookup does not settle", async () => {
    vi.useFakeTimers();
    queryRaw.mockReturnValue(new Promise(() => undefined));
    try {
      const run = sweepAuditTrackingReconciliation();
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(run).resolves.toMatchObject({ failed: 1, bounded: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
