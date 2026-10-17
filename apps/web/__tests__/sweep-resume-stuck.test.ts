/**
 * U3(STABILITY_RESUME_STUCK_ENABLED): 정리 cron 은 받은 답이 있는 stale processing 을 실패 대신
 * 이어가기 대기로 돌린다. 꺼짐이면 기존과 같은 DB 호출·응답이다.
 *
 * @vitest-environment node
 */
import { makeAuditCheckpoint } from "@repo/audit/checkpoint";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  continueOldestPendingAudit: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  database: {
    auditJob: {
      updateMany: mocks.updateMany,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
    },
  },
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

const scope = {
  brandId: "brand-1",
  domain: "example.com",
  language: "both" as const,
  organizationId: "org-1",
};
const createdAt = new Date(Date.now() - 20 * 60 * 1000);
const prompts = Array.from({ length: 20 }, (_, index) => ({
  text: `q${index}`,
  lang: "ko" as const,
  kind: "brand" as const,
}));
const savedCheckpoint = (done: number) => {
  const base = makeAuditCheckpoint(
    scope,
    {
      brandName: "Example",
      brandVariants: [],
      identityGrounded: true,
      officialSiteIdentity: {
        finalUrl: "https://example.com",
        title: null,
        description: null,
        h1: null,
        siteName: null,
      },
    },
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
        durationMs: 1,
        isStub: false,
        errorMessage: null,
      }))
    ),
  };
};
const row = (done: number) => ({
  id: "job-1",
  status: "processing",
  leaseToken: "tok",
  createdAt,
  ...scope,
  checkpoint: savedCheckpoint(done),
});

const run = async () =>
  (await (
    await GET(
      new Request("https://www.test/api/cron/sweep-stuck-jobs") as never
    )
  ).json()) as { swept: Record<string, unknown> };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 0 });
  mocks.findMany.mockResolvedValue([]);
  mocks.continueOldestPendingAudit.mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sweep-stuck-jobs U3 resume", () => {
  it("flag off: no new DB reads, same failed sweep (stuck-swept) and same response keys", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 2 });
    const body = await run();
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(body.swept).toEqual({
      crew: 0,
      fast: 2,
      tracking: { completed: 0, skipped: 0, failed: 0, bounded: false },
    });
    const processingSweep = mocks.updateMany.mock.calls[0][0];
    expect(processingSweep.where.status).toBe("processing");
    expect(processingSweep.data).toMatchObject({
      status: "failed",
      leaseToken: null,
      leaseUntil: null,
    });
    expect(processingSweep.data.errorMessage).toContain("stuck-swept");
  });

  it("flag on, 7 of 20 answers: moves the job to queued + leaseUntil before the failed sweep", async () => {
    vi.stubEnv("STABILITY_RESUME_STUCK_ENABLED", "true");
    mocks.findMany.mockResolvedValue([{ id: "job-1" }]);
    mocks.findUnique.mockResolvedValue(row(7));
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const body = await run();
    expect(body.swept.resumed).toBe(1);
    const resume = mocks.updateMany.mock.calls[0][0];
    expect(resume.data.status).toBe("queued");
    expect(resume.data.leaseUntil).toBeInstanceOf(Date);
    expect(resume.data.checkpoint.continuation.count).toBe(1);
    // 그다음 기존 failed 정리가 그대로 이어서 불린다(이미 바뀐 행은 조건에서 빠진다).
    expect(mocks.updateMany.mock.calls[1][0].data.errorMessage).toContain(
      "stuck-swept"
    );
  });

  it("flag on, no answers: still failed by the unchanged sweep (no resume write)", async () => {
    vi.stubEnv("STABILITY_RESUME_STUCK_ENABLED", "true");
    mocks.findMany.mockResolvedValue([{ id: "job-1" }]);
    mocks.findUnique.mockResolvedValue(row(0));
    const body = await run();
    expect(body.swept.resumed).toBe(0);
    expect(
      mocks.updateMany.mock.calls.some(
        ([args]) => args.data.status === "queued" && args.data.checkpoint
      )
    ).toBe(false);
    expect(mocks.updateMany.mock.calls[0][0].data.status).toBe("failed");
  });

  it("flag on, another worker already took it (count 0): resume is skipped, nothing double-written", async () => {
    vi.stubEnv("STABILITY_RESUME_STUCK_ENABLED", "true");
    mocks.findMany.mockResolvedValue([{ id: "job-1" }]);
    mocks.findUnique.mockResolvedValue(row(7));
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect((await run()).swept.resumed).toBe(0);
  });
});
