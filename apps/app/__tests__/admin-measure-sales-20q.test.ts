/**
 * 관리자(영업) 측정 — 20문항 · 이어가기 구동 (2026-10-14).
 *
 * 🔴 계약:
 *   ① 영업 측정은 promptLimit 20 + 이어가기 + 브랜드의 언어·업종·시장·별칭으로 러너를 부른다
 *   ② 폴링이 「이어가기 대기」를 보면 한 걸음 이어 준다(응답은 막지 않는다) — 대기가 아니면 안 건드린다
 *   ③ 웹 API(`/api/admin/measure-one`)도 같은 옵션·같은 구동을 쓴다
 *   ④ 콘솔 폴링 상한은 이어가기 시간(15~20분)을 덮는다(예전 6분이면 이어가기를 구동하다 끊긴다)
 *
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  runAuditJob: vi.fn(),
  startMeasureOne: vi.fn(),
  checkMeasureOne: vi.fn(),
  driveMeasureContinuation: vi.fn(),
  afterCallbacks: [] as Array<() => unknown>,
}));

vi.mock("@repo/audit/measure-one", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startMeasureOne: h.startMeasureOne,
  checkMeasureOne: h.checkMeasureOne,
  driveMeasureContinuation: h.driveMeasureContinuation,
}));
vi.mock("@repo/audit/runner", () => ({ runAuditJob: h.runAuditJob }));
vi.mock("@repo/auth/admin", () => ({
  requireAdmin: () => Promise.resolve("admin_1"),
}));
vi.mock("@repo/database", () => ({ database: {} }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    h.afterCallbacks.push(fn);
  },
}));

import { pollMeasureOne, runMeasureOne } from "../app/actions/admin/measure";

const started = {
  brandId: "brand-1",
  brandName: "프란츠",
  brandVariants: ["FRANZ"],
  domain: "franz.example",
  industry: "beauty",
  jobId: "job-1",
  marketScope: "korea",
  organizationId: "org-sales",
  trackingBefore: 10,
};

beforeEach(() => {
  for (const fn of [
    h.runAuditJob,
    h.startMeasureOne,
    h.checkMeasureOne,
    h.driveMeasureContinuation,
  ]) {
    fn.mockReset();
  }
  h.afterCallbacks.length = 0;
});

describe("runMeasureOne — 영업 옵션으로 러너를 부른다", () => {
  it("promptLimit 20 · 이어가기 · 브랜드의 언어·업종·시장·별칭", async () => {
    h.startMeasureOne.mockResolvedValue(started);
    h.runAuditJob.mockResolvedValue(undefined);
    const result = await runMeasureOne("brand-1");
    expect(result.ok).toBe(true);
    for (const cb of h.afterCallbacks) {
      await cb();
    }
    expect(h.runAuditJob).toHaveBeenCalledTimes(1);
    expect(h.runAuditJob.mock.calls[0]?.[0]).toMatchObject({
      brandId: "brand-1",
      brandVariants: ["FRANZ"],
      continueWhenTruncated: true,
      industry: "beauty",
      jobId: "job-1",
      language: "ko",
      marketScope: "korea",
      organizationId: "org-sales",
      promptLimit: 20,
    });
  });

  it("이미 진행 중이면 러너를 새로 부르지 않는다", async () => {
    h.startMeasureOne.mockResolvedValue({
      ...started,
      skipped: "already_running",
    });
    await runMeasureOne("brand-1");
    expect(h.afterCallbacks).toHaveLength(0);
    expect(h.runAuditJob).not.toHaveBeenCalled();
  });
});

describe("pollMeasureOne — 대기를 보면 이어 준다", () => {
  const state = (waiting: boolean) => ({
    done: false,
    status: "queued",
    trackingDelta: 0,
    trackingNow: 10,
    waiting,
  });

  it("대기 중이면 응답 뒤에 이어가기를 한 걸음 구동한다", async () => {
    h.checkMeasureOne.mockResolvedValue(state(true));
    const result = await pollMeasureOne("job-1", 10);
    expect(result.waiting).toBe(true);
    expect(h.driveMeasureContinuation).not.toHaveBeenCalled(); // 응답을 막지 않는다
    expect(h.afterCallbacks).toHaveLength(1);
    await h.afterCallbacks[0]?.();
    expect(h.driveMeasureContinuation).toHaveBeenCalledWith(
      "job-1",
      expect.any(Number)
    );
  });

  it("대기가 아니면 이어가기를 건드리지 않는다", async () => {
    h.checkMeasureOne.mockResolvedValue(state(false));
    await pollMeasureOne("job-1", 10);
    expect(h.afterCallbacks).toHaveLength(0);
    expect(h.driveMeasureContinuation).not.toHaveBeenCalled();
  });
});

describe("소스 계약 — 웹 API·콘솔", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("웹 API 가 같은 옵션과 같은 구동을 쓴다(언어 both 고정이 없다)", () => {
    const route = read("../web/app/api/admin/measure-one/route.ts");
    expect(route).toContain("...salesMeasureOptions(started)");
    expect(route).toContain("driveMeasureContinuation(jobId");
    expect(route).not.toContain('language: "both"');
  });

  it("관리자 액션에도 언어 both 고정이 없다", () => {
    expect(read("app/actions/admin/measure.ts")).not.toContain(
      'language: "both"'
    );
  });

  it("콘솔 폴링 상한이 이어가기 시간을 덮는다(6분이 아니다)", () => {
    const consoleSrc = read(
      "app/(authenticated)/admin/measure/measure-console.tsx"
    );
    expect(consoleSrc).toContain("POLL_DEADLINE_MIN = 30");
    expect(consoleSrc).not.toContain("6 * 60 * 1000");
  });
});
