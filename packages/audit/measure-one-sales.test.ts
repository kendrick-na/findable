/**
 * 영업(관리자) 측정 — 20문항 한 회차 옵션과 이어가기 구동 (2026-10-14).
 *
 * 계약: ①영업 경로만 promptLimit 20 + 이어가기 + 브랜드의 언어·업종·시장·별칭을 넘긴다
 *   ②Job 행에 언어·업종을 남긴다(이어가기가 Job 행에서 다시 읽는다) ③폴링이 대기를 알아본다
 *   ④이어가기 구동은 절대 throw 하지 않는다 ⑤대시보드(고객) 측정은 이 옵션을 쓰지 않는다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  brandFindUnique: vi.fn(),
  trackingCount: vi.fn(),
  jobFindFirst: vi.fn(),
  jobFindUnique: vi.fn(),
  jobCreate: vi.fn(),
  jobUpdateMany: vi.fn(),
  reconcile: vi.fn(),
  continueAuditJob: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("@repo/database", () => ({
  database: {
    brand: { findUnique: mocks.brandFindUnique },
    tracking: { count: mocks.trackingCount },
    auditJob: {
      findFirst: mocks.jobFindFirst,
      findUnique: mocks.jobFindUnique,
      create: mocks.jobCreate,
      updateMany: mocks.jobUpdateMany,
    },
  },
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: mocks.logError },
}));
vi.mock("./runner", () => ({ runAuditJob: vi.fn() }));
vi.mock("./audit-continuation", () => ({
  continueAuditJob: mocks.continueAuditJob,
}));
vi.mock("./stale-job", () => ({ reconcileStaleAuditJob: mocks.reconcile }));

import {
  checkMeasureOne,
  driveMeasureContinuation,
  salesMeasureOptions,
  startMeasureOne,
} from "./measure-one";
import { SALES_PROMPT_LIMIT } from "./prompt-limits";

const brand = {
  id: "brand-1",
  name: "프란츠",
  domain: "franz.example",
  organizationId: "org-sales",
  industry: "beauty",
  marketScope: "korea",
  entityVariants: ["FRANZ", "", 3],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.trackingCount.mockResolvedValue(10);
});

describe("salesMeasureOptions", () => {
  it("영업 경로: 20문항 · 이어가기 · 브랜드의 언어·업종·시장·별칭", () => {
    expect(
      salesMeasureOptions({
        brandVariants: ["FRANZ"],
        industry: "beauty",
        marketScope: "korea",
      })
    ).toEqual({
      brandVariants: ["FRANZ"],
      continueWhenTruncated: true,
      industry: "beauty",
      language: "ko",
      marketScope: "korea",
      promptLimit: 20,
    });
    expect(SALES_PROMPT_LIMIT).toBe(20);
  });

  it("시장이 없으면 예전처럼 both (영업 브랜드는 시장을 안 가진 경우가 많다)", () => {
    expect(salesMeasureOptions({ brandVariants: [] }).language).toBe("both");
    expect(
      salesMeasureOptions({ brandVariants: [], marketScope: "global" }).language
    ).toBe("en");
  });
});

describe("startMeasureOne — 브랜드 값을 싣고 Job 행에 언어·업종을 남긴다", () => {
  it("새 Job: 시장→언어, 업종 저장, 반환에 브랜드 값 포함(별칭은 문자열만)", async () => {
    mocks.brandFindUnique.mockResolvedValue(brand);
    mocks.jobFindFirst.mockResolvedValue(null);
    mocks.jobCreate.mockResolvedValue({ id: "job-1" });
    const started = await startMeasureOne("brand-1");
    expect(mocks.jobCreate.mock.calls[0]?.[0].data).toMatchObject({
      brandId: "brand-1",
      industry: "beauty",
      language: "ko",
      organizationId: "org-sales",
    });
    expect(started).toMatchObject({
      brandVariants: ["FRANZ"],
      industry: "beauty",
      jobId: "job-1",
      marketScope: "korea",
    });
  });

  it("이미 진행 중이면 새 Job 을 만들지 않고 같은 Job 과 브랜드 값을 돌려준다", async () => {
    mocks.brandFindUnique.mockResolvedValue(brand);
    mocks.jobFindFirst.mockResolvedValue({ id: "running-1", status: "queued" });
    mocks.reconcile.mockResolvedValue("queued");
    const started = await startMeasureOne("brand-1");
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    expect(started).toMatchObject({
      jobId: "running-1",
      skipped: "already_running",
      industry: "beauty",
    });
  });
});

describe("checkMeasureOne — 이어가기 대기를 알아본다", () => {
  const job = (over: Record<string, unknown>) => ({
    id: "job-1",
    brandId: "brand-1",
    createdAt: new Date(),
    status: "queued",
    ...over,
  });

  it("queued + leaseUntil(대기 표시) → waiting true, 아직 끝난 게 아니다", async () => {
    mocks.jobFindUnique.mockResolvedValue(
      job({ leaseUntil: new Date(Date.now() + 60_000) })
    );
    mocks.reconcile.mockResolvedValue("queued");
    expect(await checkMeasureOne("job-1", 10)).toMatchObject({
      done: false,
      status: "queued",
      waiting: true,
    });
  });

  it("진행 중·완료 회차는 waiting false", async () => {
    mocks.jobFindUnique.mockResolvedValue(job({ status: "processing" }));
    mocks.reconcile.mockResolvedValue("processing");
    expect((await checkMeasureOne("job-1", 10)).waiting).toBe(false);
    mocks.jobFindUnique.mockResolvedValue(job({ status: "completed" }));
    mocks.reconcile.mockResolvedValue("completed");
    expect(await checkMeasureOne("job-1", 10)).toMatchObject({
      done: true,
      waiting: false,
    });
  });
});

describe("driveMeasureContinuation", () => {
  it("이어가기를 한 걸음 구동한다", async () => {
    mocks.continueAuditJob.mockResolvedValue({
      jobId: "job-1",
      mode: "continue",
      ran: true,
      status: "queued",
    });
    await driveMeasureContinuation("job-1", 123);
    expect(mocks.continueAuditJob).toHaveBeenCalledWith("job-1", {
      invocationStartedAtMs: 123,
    });
  });

  it("실패해도 throw 하지 않고 로그만 남긴다(폴링 응답을 막지 않는다)", async () => {
    mocks.continueAuditJob.mockRejectedValue(new Error("boom"));
    await expect(driveMeasureContinuation("job-1", 1)).resolves.toBeUndefined();
    expect(mocks.logError).toHaveBeenCalled();
  });
});
