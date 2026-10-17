// biome-ignore-all lint/suspicious/useAwait: 모의 DB 는 async 시그니처만 맞춘다
/**
 * 안정성 U2 — start-tracking 입장 관리·일/월 상한.
 * 꺼짐 = 기존과 같은 DB 호출 순서·같은 러너 입력·같은 응답(모의 DB로 고정).
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    afterQueue: [] as Array<() => Promise<void>>,
    runAuditJob: vi.fn(),
    groupBy: vi.fn(),
    count: vi.fn(),
    plan: vi.fn(),
    track:
      <T>(name: string, value: () => T) =>
      (..._args: unknown[]) => {
        calls.push(name);
        return Promise.resolve(value());
      },
  };
});

vi.mock("@repo/database", () => ({
  database: {
    organization: {
      findUnique: m.track("org.findUnique", () => ({ id: "o1" })),
    },
    brand: {
      findFirst: m.track("brand.findFirst", () => ({ id: "b1" })),
      findUnique: m.track("brand.findUnique", () => ({
        entityVariants: ["설화", " "],
        industry: "beauty",
        marketScope: "korea",
      })),
    },
    auditJob: {
      findMany: m.track("job.findMany", () => []),
      findFirst: m.track("job.findFirst", () => null),
      create: m.track("job.create", () => ({ id: "j1" })),
      groupBy: (...a: unknown[]) => {
        m.calls.push("job.groupBy");
        return m.groupBy(...a);
      },
      count: (...a: unknown[]) => {
        m.calls.push("job.count");
        return m.count(...a);
      },
    },
  },
}));
vi.mock("@repo/audit/runner", () => ({ runAuditJob: m.runAuditJob }));
vi.mock("@repo/audit/brand-setup", () => ({
  loadSetupReadinessRecord: vi.fn(async () => undefined),
}));
vi.mock("@repo/audit/market-scope", () => ({
  auditLanguageForMarketScope: () => "ko",
}));
vi.mock("@repo/auth/server", () => ({
  auth: async () => ({ userId: "u1" }),
  clerkClient: vi.fn(),
}));
vi.mock("@repo/auth/plan-server", () => ({ getCurrentPlan: m.plan }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => {
    m.afterQueue.push(fn);
  },
}));
vi.mock("@/lib/audit/runtime-readiness", () => ({
  getAuditRuntimeReadiness: () => ({ ready: true, missing: [] }),
}));
vi.mock("@/lib/brand/brand-capacity", () => ({
  brandCapacityBlock: async () => null,
}));
vi.mock("@/lib/db/scoped", () => ({ requireOrg: async () => "o1" }));
vi.mock("@/lib/i18n", () => ({
  getAppDictionary: async () => ({
    brandErrors: {
      measureStartFailed: "MSF",
      serverError: "SERVER",
    },
  }),
}));

import { startOrgTracking } from "../app/actions/brand/start-tracking";
import { resetAdmissionErrorStreak } from "../lib/audit-queue/admission";

const flush = async () => {
  for (const fn of m.afterQueue.splice(0)) {
    await fn();
  }
};
const input = { domain: "example.com", brandName: "예시" };
const BASE_CALLS = [
  "org.findUnique",
  "brand.findFirst",
  "brand.findUnique",
  "job.findMany",
  "job.findFirst",
  "job.create",
];
const EXPECTED_RUN_INPUT = {
  jobId: "j1",
  domain: "example.com",
  language: "ko",
  brandName: "예시",
  brandVariants: ["설화"],
  organizationId: "o1",
  brandId: "b1",
  industry: "beauty",
  marketScope: "korea",
  continueWhenTruncated: true,
  setupReadiness: undefined,
};

beforeEach(() => {
  m.calls.length = 0;
  m.afterQueue.length = 0;
  m.runAuditJob.mockReset();
  m.groupBy.mockReset().mockResolvedValue([]);
  m.count.mockReset().mockResolvedValue(0);
  m.plan.mockReset().mockResolvedValue("growth");
  resetAdmissionErrorStreak();
  vi.stubEnv("STABILITY_ADMISSION_ENABLED", "");
  vi.stubEnv("STABILITY_ORG_DAILY_CAP_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("꺼짐 동일성", () => {
  it("플래그가 꺼져 있으면 DB 호출 순서·러너 입력·응답이 기존과 같다", async () => {
    // 상한이 가득 찬 상황이어도(조회 자체를 안 하므로) 무시돼야 한다.
    m.groupBy.mockResolvedValue([{ email: "org:x", _count: { _all: 99 } }]);
    const result = await startOrgTracking(input);
    await flush();
    expect(result).toEqual({ ok: true, jobId: "j1" });
    expect(m.calls).toEqual(BASE_CALLS);
    expect(m.plan).not.toHaveBeenCalled();
    expect(m.runAuditJob).toHaveBeenCalledTimes(1);
    expect(m.runAuditJob).toHaveBeenCalledWith(
      expect.objectContaining(EXPECTED_RUN_INPUT)
    );
    expect(Object.keys(m.runAuditJob.mock.calls[0][0]).sort()).toEqual(
      [...Object.keys(EXPECTED_RUN_INPUT), "invocationStartedAtMs"].sort()
    );
  });
});

describe("입장 관리(켜짐)", () => {
  beforeEach(() => vi.stubEnv("STABILITY_ADMISSION_ENABLED", "1"));

  it("여유가 있으면 지금과 똑같이 즉시 시작한다(같은 러너 입력)", async () => {
    m.groupBy.mockResolvedValue([{ email: "org:x", _count: { _all: 1 } }]);
    const result = await startOrgTracking(input);
    await flush();
    expect(result).toEqual({ ok: true, jobId: "j1" });
    expect(m.runAuditJob).toHaveBeenCalledWith(
      expect.objectContaining(EXPECTED_RUN_INPUT)
    );
    expect(m.calls.filter((c) => c === "job.groupBy")).toHaveLength(1);
  });

  it("전역 상한(8)에 닿으면 대기: job 은 만들되 러너는 부르지 않고 성공을 돌려준다", async () => {
    m.groupBy.mockResolvedValue([
      { email: "org:a", _count: { _all: 2 } },
      { email: "org:b", _count: { _all: 2 } },
      { email: "intake@free.com", _count: { _all: 2 } }, // 무료·내부도 센다
      { email: "org:f1", _count: { _all: 2 } },
    ]);
    const result = await startOrgTracking(input);
    await flush();
    expect(result).toEqual({ ok: true, jobId: "j1" });
    expect(m.calls).toContain("job.create");
    expect(m.runAuditJob).not.toHaveBeenCalled();
  });

  it("고객별 상한: 스타터는 1건이라 이미 1건이면 대기, 그로스는 2건 미만이면 시작", async () => {
    m.groupBy.mockResolvedValue([{ email: "org:o1", _count: { _all: 1 } }]);
    m.plan.mockResolvedValue("starter");
    await startOrgTracking(input);
    await flush();
    expect(m.runAuditJob).not.toHaveBeenCalled();

    m.plan.mockResolvedValue("growth");
    await startOrgTracking(input);
    await flush();
    expect(m.runAuditJob).toHaveBeenCalledTimes(1);
  });

  it("조회 DB 오류가 연속 3번이면 시작을 보류(대기 줄), 그 전엔 예전처럼 즉시 시작", async () => {
    m.groupBy.mockRejectedValue(new Error("db down"));
    await startOrgTracking(input);
    await flush();
    await startOrgTracking(input);
    await flush();
    expect(m.runAuditJob).toHaveBeenCalledTimes(2);
    await startOrgTracking(input);
    await flush();
    expect(m.runAuditJob).toHaveBeenCalledTimes(2);
    // 회복되면 연속 기록이 지워진다.
    m.groupBy.mockResolvedValue([]);
    await startOrgTracking(input);
    await flush();
    expect(m.runAuditJob).toHaveBeenCalledTimes(3);
  });

  it("쿼리는 직렬이고 개수 조회는 groupBy 1회뿐이다(풀 max 1)", async () => {
    await startOrgTracking(input);
    expect(m.calls.filter((c) => c === "job.groupBy")).toHaveLength(1);
    expect(m.calls.filter((c) => c === "job.count")).toHaveLength(0);
  });
});

describe("수동 측정 일·월 상한(켜짐)", () => {
  beforeEach(() => vi.stubEnv("STABILITY_ORG_DAILY_CAP_ENABLED", "1"));

  it("그로스 일 상한(5) 이상이면 rate_limited 로 거부하고 job 을 만들지 않는다", async () => {
    m.count.mockResolvedValue(5);
    const result = await startOrgTracking(input);
    expect(result).toEqual({ error: "MSF", code: "rate_limited" });
    expect(m.calls).not.toContain("job.create");
  });

  it("일 상한 미만이어도 월 상한(그로스 100)에 닿으면 거부한다", async () => {
    m.count.mockResolvedValueOnce(1).mockResolvedValueOnce(100);
    const result = await startOrgTracking(input);
    expect(result).toEqual({ error: "MSF", code: "rate_limited" });
  });

  it("플랜별 숫자: 스타터 2·스케일 10", async () => {
    m.plan.mockResolvedValue("starter");
    m.count.mockResolvedValue(2);
    expect(await startOrgTracking(input)).toMatchObject({
      code: "rate_limited",
    });
    m.plan.mockResolvedValue("scale");
    m.count.mockResolvedValue(9);
    await startOrgTracking(input);
    await flush();
    expect(m.runAuditJob).toHaveBeenCalledTimes(1);
  });

  it("무료는 영향 없다(조회도 안 한다)", async () => {
    m.plan.mockResolvedValue("free");
    m.count.mockResolvedValue(999);
    const result = await startOrgTracking(input);
    expect(result).toEqual({ ok: true, jobId: "j1" });
    expect(m.count).not.toHaveBeenCalled();
  });

  it("자동 갱신 표식(ipAddress)이 붙은 건은 세지 않는 조건을 쿼리에 담는다", async () => {
    await startOrgTracking(input);
    const where = m.count.mock.calls[0][0].where;
    expect(where.status).toEqual({ not: "failed" });
    expect(where.OR).toEqual([
      { ipAddress: null },
      { ipAddress: { not: "auto-refresh" } },
    ]);
  });
});
