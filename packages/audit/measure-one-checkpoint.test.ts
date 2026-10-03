import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  brandFindUnique: vi.fn(),
  trackingCount: vi.fn(),
  jobFindFirst: vi.fn(),
  jobCreate: vi.fn(),
  jobUpdateMany: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("@repo/database", () => ({
  database: {
    brand: { findUnique: mocks.brandFindUnique },
    tracking: { count: mocks.trackingCount },
    auditJob: {
      findFirst: mocks.jobFindFirst,
      create: mocks.jobCreate,
      updateMany: mocks.jobUpdateMany,
    },
  },
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));
vi.mock("./runner", () => ({ runAuditJob: vi.fn() }));
vi.mock("./stale-job", () => ({
  reconcileStaleAuditJob: mocks.reconcile,
}));

import { makeAuditCheckpoint } from "./checkpoint";
import { startMeasureOne } from "./measure-one";

const brand = {
  id: "brand-1",
  name: "Example",
  domain: "example.com",
  organizationId: "org-1",
};
const recentDate = new Date(Date.now() - 60_000);
const recentCreatedAt = () => recentDate;
const checkpoint = makeAuditCheckpoint(
  {
    brandId: brand.id,
    domain: brand.domain,
    language: "both",
    organizationId: brand.organizationId,
  },
  {
    brandName: brand.name,
    brandVariants: [],
    identityGrounded: true,
    officialSiteIdentity: {
      finalUrl: "https://example.com",
      title: brand.name,
      description: null,
      h1: null,
      siteName: null,
    },
  },
  [{ text: "Question", lang: "ko" }],
  recentDate.toISOString()
);

describe("admin re-measure checkpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.brandFindUnique.mockResolvedValue(brand);
    mocks.trackingCount.mockResolvedValue(0);
    mocks.jobCreate.mockResolvedValue({ id: "new-job" });
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("atomically requeues only a matching timed-out checkpoint", async () => {
    mocks.jobFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "old-job",
      createdAt: recentCreatedAt(),
      checkpoint,
      errorMessage: "FUNCTION_INVOCATION_TIMEOUT",
    });
    const result = await startMeasureOne(brand.id);
    expect(result.jobId).toBe("old-job");
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "old-job", status: "failed" }),
        data: expect.objectContaining({ status: "queued", leaseToken: null }),
      })
    );
  });

  it("does not resume a checkpoint from a different organization", async () => {
    mocks.jobFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "old-job",
      createdAt: recentCreatedAt(),
      checkpoint: {
        ...checkpoint,
        scope: { ...checkpoint.scope, organizationId: "other-org" },
      },
      errorMessage: "stuck-swept: timed out",
    });
    await startMeasureOne(brand.id);
    expect(mocks.jobCreate).toHaveBeenCalledOnce();
    expect(mocks.jobUpdateMany).not.toHaveBeenCalled();
  });

  it("does not resume a non-timeout failure", async () => {
    mocks.jobFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "old-job",
      createdAt: recentCreatedAt(),
      checkpoint,
      errorMessage: "invalid official site",
    });
    await startMeasureOne(brand.id);
    expect(mocks.jobCreate).toHaveBeenCalledOnce();
    expect(mocks.jobUpdateMany).not.toHaveBeenCalled();
  });

  it("does not fork a second paid run when another click wins the requeue", async () => {
    mocks.jobFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "old-job",
      createdAt: recentCreatedAt(),
      checkpoint,
      errorMessage: "FUNCTION_INVOCATION_TIMEOUT",
    });
    mocks.jobUpdateMany.mockResolvedValue({ count: 0 });
    await expect(startMeasureOne(brand.id)).rejects.toThrow("already resumed");
    expect(mocks.jobCreate).not.toHaveBeenCalled();
  });

  it("never resumes an old checkpoint after a newer completed run", async () => {
    const failedAt = recentCreatedAt();
    mocks.jobFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "old-job",
        createdAt: failedAt,
        checkpoint,
        errorMessage: "FUNCTION_INVOCATION_TIMEOUT",
      })
      .mockResolvedValueOnce({ id: "newer-completed" });
    const result = await startMeasureOne(brand.id);
    expect(result.jobId).toBe("new-job");
    expect(mocks.jobUpdateMany).not.toHaveBeenCalled();
    expect(mocks.jobFindFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "completed",
          createdAt: { gt: failedAt },
        }),
      })
    );
  });

  it("starts fresh when the checkpoint is older than 24 hours", async () => {
    mocks.jobFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "old-job",
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      checkpoint,
      errorMessage: "FUNCTION_INVOCATION_TIMEOUT",
    });
    expect((await startMeasureOne(brand.id)).jobId).toBe("new-job");
    expect(mocks.jobUpdateMany).not.toHaveBeenCalled();
  });

  it("stops after repeated attempts with no saved question progress", async () => {
    mocks.jobFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "old-job",
      createdAt: recentCreatedAt(),
      checkpoint: {
        ...checkpoint,
        retry: { attempt: 2, attemptStartResponses: 0, noProgressFailures: 1 },
      },
      errorMessage: "FUNCTION_INVOCATION_TIMEOUT",
    });
    await expect(startMeasureOne(brand.id)).rejects.toThrow("no-progress stop");
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    expect(mocks.jobUpdateMany).not.toHaveBeenCalled();
  });
});
