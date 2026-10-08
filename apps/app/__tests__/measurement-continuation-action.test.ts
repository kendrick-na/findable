/**
 * 마감으로 잘린 측정의 이어가기 — 화면 폴링 계약(2026-10-06).
 *
 * - 이어가기 대기(queued + leaseUntil)는 폴링에 `needs_continuation` 으로 보인다.
 * - `continueOrgTracking` 은 내 org 의 대기 Job 일 때만 after() 로 이어가기를 건다.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  after: vi.fn(),
  continueAuditJob: vi.fn(),
  requireOrg: vi.fn(),
  readiness: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  database: { auditJob: { findFirst: mocks.findFirst } },
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@repo/audit/audit-continuation", () => ({
  continueAuditJob: mocks.continueAuditJob,
}));
vi.mock("@/lib/db/scoped", () => ({ requireOrg: mocks.requireOrg }));
vi.mock("@/lib/audit/runtime-readiness", () => ({
  getAuditRuntimeReadiness: mocks.readiness,
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { getTrackingStatus } = await import(
  "../app/actions/brand/tracking-status"
);
const { continueOrgTracking } = await import(
  "../app/actions/brand/continue-tracking"
);

const now = Date.now();
const pendingJob = {
  id: "job_1",
  email: "org:org_1",
  status: "queued",
  createdAt: new Date(now - 50 * 60_000),
  attemptStartedAt: new Date(now - 45 * 60_000),
  leaseUntil: new Date(now + 75 * 60_000),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOrg.mockResolvedValue("org_1");
  mocks.readiness.mockReturnValue({ ready: true });
});

describe("polling status", () => {
  it("reports a pending continuation instead of a stale queue entry", async () => {
    mocks.findFirst.mockResolvedValue(pendingJob);
    expect(await getTrackingStatus("job_1")).toBe("needs_continuation");
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job_1", email: "org:org_1" },
      })
    );
  });

  it("tells a late-answer round apart from a question continuation (2026-10-07)", async () => {
    mocks.findFirst.mockResolvedValue({
      ...pendingJob,
      checkpoint: {
        lateReask: { count: 1, requestedAt: new Date(now).toISOString() },
      },
    });
    expect(await getTrackingStatus("job_1")).toBe("needs_late_answers");

    mocks.findFirst.mockResolvedValue({
      ...pendingJob,
      checkpoint: { continuation: { count: 1, requestedAt: "x" } },
    });
    expect(await getTrackingStatus("job_1")).toBe("needs_continuation");
  });

  it("keeps a plain fresh queued job as queued", async () => {
    mocks.findFirst.mockResolvedValue({
      ...pendingJob,
      createdAt: new Date(),
      attemptStartedAt: null,
      leaseUntil: null,
    });
    expect(await getTrackingStatus("job_1")).toBe("queued");
  });
});

describe("continueOrgTracking", () => {
  it("schedules exactly one background continuation for my pending job", async () => {
    mocks.findFirst.mockResolvedValue(pendingJob);
    mocks.continueAuditJob.mockResolvedValue({
      jobId: "job_1",
      ran: true,
      status: "completed",
    });

    expect(await continueOrgTracking("job_1")).toEqual({ ok: true });
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await (mocks.after.mock.calls[0]?.[0] as () => Promise<void>)();
    expect(mocks.continueAuditJob).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ organizationId: "org_1" })
    );
  });

  it("does nothing for a job that is not waiting for continuation", async () => {
    mocks.findFirst.mockResolvedValue({ ...pendingJob, status: "processing" });
    expect(await continueOrgTracking("job_1")).toEqual({
      ok: false,
      reason: "not_pending",
    });
    mocks.findFirst.mockResolvedValue(null);
    expect(await continueOrgTracking("job_other_org")).toEqual({
      ok: false,
      reason: "not_pending",
    });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("leaves the job for the cron when the runtime is not configured", async () => {
    mocks.findFirst.mockResolvedValue(pendingJob);
    mocks.readiness.mockReturnValue({ ready: false, missing: ["X"] });
    expect(await continueOrgTracking("job_1")).toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("refuses without an organisation session", async () => {
    mocks.requireOrg.mockRejectedValue(new Error("no org"));
    expect(await continueOrgTracking("job_1")).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
