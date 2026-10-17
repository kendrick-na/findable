/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  alert: vi.fn(),
  engineStats: vi.fn(),
  freeUsage: vi.fn(),
  jobOutcomes: vi.fn(),
  queueWait: vi.fn(),
  quotaSignals: vi.fn(),
}));

vi.mock("@repo/observability/ops-alert", () => ({ captureOpsAlert: m.alert }));
vi.mock("@repo/observability/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/lib/ops-checks/load", () => ({
  loadEngineWindowStats: m.engineStats,
  loadFreeDailyUsage: m.freeUsage,
  loadJobOutcomes: m.jobOutcomes,
  loadQueueWait: m.queueWait,
  loadRecentFinishedQuotaSignals: m.quotaSignals,
}));

import { GET } from "../app/api/cron/ops-checks/route";
import {
  evaluateEngineRates,
  evaluateFreeCost,
  evaluateJobFailureRate,
  evaluateQueueWait,
  evaluateQuotaStreak,
} from "../lib/ops-checks/evaluate";
import { runOpsChecks } from "../lib/ops-checks/run";
import { opsThresholds } from "../lib/ops-checks/thresholds";

const T = opsThresholds({});

describe("임계값 — 환경값과 기본값", () => {
  it("기본값(발명한 시작점)", () => {
    expect(T).toEqual({
      costRatio: 0.8,
      engineFailRate: 0.4,
      engineMinCells: 20,
      engineRateLimitRate: 0.2,
      jobFailMinJobs: 5,
      jobFailRate: 0.3,
      queueWaitMinutes: 10,
      quotaStreak: 3,
    });
  });
  it("환경값이 우선하고, 잘못된 값은 기본값", () => {
    const t = opsThresholds({
      STABILITY_ALERT_ENGINE_FAIL_RATE: "0.1",
      STABILITY_ALERT_QUOTA_STREAK: "abc",
    });
    expect(t.engineFailRate).toBe(0.1);
    expect(t.quotaStreak).toBe(3);
  });
});

describe("① 엔진 실패·429 비율 경계", () => {
  const base = { cells: 100, engineId: "chatgpt", failed: 0, rateLimited: 0 };
  it("기준과 같으면 안 울리고, 넘으면 울린다", () => {
    expect(evaluateEngineRates([{ ...base, failed: 40 }], T)).toHaveLength(0);
    const over = evaluateEngineRates([{ ...base, failed: 41 }], T);
    expect(over.map((a) => a.kind)).toEqual(["engine_failure_rate"]);
    expect(over[0].message).toContain("chatgpt");
  });
  it("429 비율도 같은 경계(>)", () => {
    expect(evaluateEngineRates([{ ...base, rateLimited: 20 }], T)).toHaveLength(
      0
    );
    expect(
      evaluateEngineRates([{ ...base, rateLimited: 21 }], T).map((a) => a.kind)
    ).toEqual(["engine_rate_limit_rate"]);
  });
  it("표본이 적으면(20칸 미만) 판정하지 않는다", () => {
    expect(
      evaluateEngineRates(
        [{ cells: 19, engineId: "x", failed: 19, rateLimited: 19 }],
        T
      )
    ).toHaveLength(0);
    expect(
      evaluateEngineRates(
        [{ cells: 20, engineId: "x", failed: 20, rateLimited: 0 }],
        T
      )
    ).toHaveLength(1);
  });
});

describe("② 쿼터 연속 오류", () => {
  const q = (...flags: boolean[]) =>
    flags.map((quotaError) => ({ quotaError }));
  it("최근부터 연속 N건 이상이면 울린다", () => {
    expect(evaluateQuotaStreak(q(true, true), T)).toHaveLength(0);
    expect(evaluateQuotaStreak(q(true, true, true), T)).toHaveLength(1);
    expect(
      evaluateQuotaStreak(q(true, true, true, true), T)[0].context.streak
    ).toBe(4);
  });
  it("중간에 정상이 끼면 거기서 끊긴다", () => {
    expect(
      evaluateQuotaStreak(q(true, true, false, true, true, true), T)
    ).toHaveLength(0);
    expect(evaluateQuotaStreak([], T)).toHaveLength(0);
  });
});

describe("③ 대기 초과", () => {
  it("10분 이하는 안 울리고 넘으면 울린다", () => {
    expect(
      evaluateQueueWait({ count: 2, oldestWaitMinutes: 10 }, T)
    ).toHaveLength(0);
    expect(
      evaluateQueueWait({ count: 2, oldestWaitMinutes: 10.5 }, T)
    ).toHaveLength(1);
    expect(
      evaluateQueueWait({ count: 0, oldestWaitMinutes: 99 }, T)
    ).toHaveLength(0);
  });
});

describe("⑤ 측정 실패율", () => {
  it("표본 5건 미만은 판정 안 함, 30% 이하는 안 울림, 넘으면 울림", () => {
    expect(evaluateJobFailureRate({ completed: 0, failed: 4 }, T)).toHaveLength(
      0
    );
    expect(evaluateJobFailureRate({ completed: 7, failed: 3 }, T)).toHaveLength(
      0
    );
    expect(evaluateJobFailureRate({ completed: 6, failed: 4 }, T)).toHaveLength(
      1
    );
  });
});

describe("⑥ 원가", () => {
  it("상한의 80% 에 도달하면 울린다(미만은 안 울림)", () => {
    expect(evaluateFreeCost({ cap: 50, count: 39 }, T)).toHaveLength(0);
    expect(evaluateFreeCost({ cap: 50, count: 40 }, T)).toHaveLength(1);
    expect(evaluateFreeCost({ cap: 0, count: 5 }, T)).toHaveLength(0);
  });
});

describe("알림 context 에 개인정보가 없다", () => {
  it("모든 알림의 context 는 숫자·고정 단어·엔진 이름뿐", () => {
    const all = [
      ...evaluateEngineRates(
        [{ cells: 100, engineId: "chatgpt", failed: 90, rateLimited: 90 }],
        T
      ),
      ...evaluateQuotaStreak(
        [{ quotaError: true }, { quotaError: true }, { quotaError: true }],
        T
      ),
      ...evaluateQueueWait({ count: 3, oldestWaitMinutes: 30 }, T),
      ...evaluateJobFailureRate({ completed: 1, failed: 9 }, T),
      ...evaluateFreeCost({ cap: 10, count: 10 }, T),
    ];
    expect(all).toHaveLength(6);
    const serialized = JSON.stringify(all);
    expect(serialized).not.toMatch(/@|org:|\d+\.\d+\.\d+\.\d+|https?:/);
    for (const alert of all) {
      for (const key of Object.keys(alert.context)) {
        expect(key).not.toMatch(/email|ip|domain|jobId|orgId|user/i);
      }
    }
  });
});

describe("runOpsChecks", () => {
  beforeEach(() => {
    for (const fn of Object.values(m)) {
      fn.mockReset();
    }
    m.engineStats.mockResolvedValue([]);
    m.quotaSignals.mockResolvedValue([]);
    m.queueWait.mockResolvedValue({ count: 0, oldestWaitMinutes: 0 });
    m.jobOutcomes.mockResolvedValue({ completed: 10, failed: 0 });
    m.freeUsage.mockResolvedValue({ cap: 50, count: 1 });
  });
  it("정상이면 알림 0", async () => {
    const summary = await runOpsChecks(new Date(), {});
    expect(summary).toEqual({ alerts: [], failedChecks: [] });
    expect(m.alert).not.toHaveBeenCalled();
  });
  it("기준 초과 항목만 captureOpsAlert 로 올린다", async () => {
    m.queueWait.mockResolvedValue({ count: 2, oldestWaitMinutes: 25 });
    m.freeUsage.mockResolvedValue({ cap: 50, count: 45 });
    const summary = await runOpsChecks(new Date(), {});
    expect(summary.alerts.map((a) => a.kind).sort()).toEqual([
      "free_cost_budget",
      "queue_wait",
    ]);
    expect(m.alert).toHaveBeenCalledTimes(2);
  });
  it("한 점검의 조회가 실패해도 나머지는 계속 돌고, 오류 원문은 알림에 안 실린다", async () => {
    m.engineStats.mockRejectedValue(
      new Error("password=hunter2 host=10.0.0.9")
    );
    m.queueWait.mockResolvedValue({ count: 1, oldestWaitMinutes: 40 });
    const summary = await runOpsChecks(new Date(), {});
    expect(summary.failedChecks).toEqual(["engine_rates"]);
    expect(summary.alerts.map((a) => a.kind)).toEqual(["queue_wait"]);
    expect(JSON.stringify(m.alert.mock.calls)).not.toContain("hunter2");
    expect(JSON.stringify(summary)).not.toContain("hunter2");
  });
});

describe("cron 라우트", () => {
  const SECRET = "test-cron-secret";
  const request = (authorized: boolean) =>
    new Request("https://findable.test/api/cron/ops-checks", {
      headers: authorized ? { authorization: `Bearer ${SECRET}` } : {},
    }) as unknown as Parameters<typeof GET>[0];

  beforeEach(() => {
    for (const fn of Object.values(m)) {
      fn.mockReset();
    }
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("STABILITY_OPS_ALERTS_ENABLED", "");
  });

  it("인증 없으면 거절 — 플래그·조회 이전", async () => {
    vi.stubEnv("STABILITY_OPS_ALERTS_ENABLED", "1");
    const response = await GET(request(false));
    expect(response.status).toBe(401);
    expect(m.engineStats).not.toHaveBeenCalled();
  });
  it("플래그 꺼짐이면 아무 조회·알림도 없이 skip", async () => {
    const response = await GET(request(true));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, skipped: "flag_off" });
    expect(m.engineStats).not.toHaveBeenCalled();
    expect(m.freeUsage).not.toHaveBeenCalled();
    expect(m.alert).not.toHaveBeenCalled();
  });
  it("플래그 켜짐이면 점검을 돌린다", async () => {
    vi.stubEnv("STABILITY_OPS_ALERTS_ENABLED", "true");
    m.engineStats.mockResolvedValue([]);
    m.quotaSignals.mockResolvedValue([]);
    m.queueWait.mockResolvedValue({ count: 0, oldestWaitMinutes: 0 });
    m.jobOutcomes.mockResolvedValue({ completed: 1, failed: 0 });
    m.freeUsage.mockResolvedValue({ cap: 50, count: 1 });
    const response = await GET(request(true));
    expect(response.status).toBe(200);
    expect(m.engineStats).toHaveBeenCalledTimes(1);
  });
});
