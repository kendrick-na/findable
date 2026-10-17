/**
 * MCP 커넥터 — 진단 연결(캐시 우선·플래그·상한·중복 방지·비공개 보호) + 결과 변환.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  publishable: true,
  restricted: false,
  metrics: null as unknown,
}));

vi.mock("@repo/audit/public-url-security", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@repo/audit/public-url-security")>();
  return {
    ...real,
    assertPublicUrl: vi.fn((url: URL) =>
      url.hostname === "private.test"
        ? Promise.reject(new Error("URL_PRIVATE"))
        : Promise.resolve()
    ),
  };
});
// 판정 함수는 격리하고(변환 논리만 시험), 실제 함수의 '닫힘'은 아래 별도 테스트가 본다.
vi.mock("@repo/audit/normalize-stored-metrics", () => ({
  withRecomputedAuditMetrics: (r: unknown) => r,
  isPublishableAuditResult: () => fx.publishable,
  citationPrescriptionsRestricted: () => fx.restricted,
}));
vi.mock("@repo/audit/run-quality", () => ({ metricsOf: () => fx.metrics }));

import {
  type BridgeDeps,
  getAiVisibilityResult,
  startAiVisibilityCheck,
} from "@/lib/mcp/audit-bridge";
import { MCP_SYSTEM_EMAIL } from "@/lib/mcp/flags";
import { toMcpResult } from "@/lib/mcp/result";

const JOB_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_JOB = "99999999-2222-4333-8444-555555555555";

function goodMetrics() {
  return {
    enginesCovered: ["chatgpt", "claude", "naver", "gemini"],
    enginesWithMention: ["chatgpt", "naver"],
    errors: [{ engineId: "gemini", message: "timeout" }],
    topCitedDomains: [
      { domain: "a.com", count: 3 },
      { domain: "b.com", count: 2 },
      { domain: "c.com", count: 1 },
      { domain: "d.com", count: 1 },
    ],
  };
}

function makeDeps(over: Partial<BridgeDeps> = {}) {
  const tasks: Array<() => Promise<void>> = [];
  type Aj = BridgeDeps["db"]["auditJob"];
  const db = {
    auditJob: {
      count: vi.fn<Aj["count"]>(async () => 0),
      create: vi.fn<Aj["create"]>(async () => ({ id: JOB_ID })),
      findFirst: vi.fn<Aj["findFirst"]>(async () => null),
      findUnique: vi.fn<Aj["findUnique"]>(async () => null),
    },
  };
  const deps: BridgeDeps = {
    after: (t) => tasks.push(t),
    db,
    findCachedByDomain: vi.fn(async () => null),
    isDailyBudgetExhausted: vi.fn(async () => false),
    log: { error: vi.fn(), info: vi.fn() },
    runAuditJob: vi.fn(async () => undefined),
    ...over,
  };
  return { deps, db, tasks };
}

const input = {
  url: "brand.example",
  brandName: "브랜드",
  language: "ko" as const,
  client: "claude",
};
const completedJob = {
  completedAt: new Date("2026-10-17T01:00:00Z"),
  createdAt: new Date("2026-10-17T00:55:00Z"),
  domain: "brand.example",
  email: "someone-else@example.com",
  result: { any: "thing" },
  status: "completed" as const,
};

beforeEach(() => {
  fx.publishable = true;
  fx.restricted = false;
  fx.metrics = goodMetrics();
});
afterEach(() => vi.unstubAllEnvs());

describe("결과 변환 — 계산하지 않고, 못 잰 것을 0 으로 말하지 않는다", () => {
  it("측정 실패 엔진은 mentioned:null + error, 분모는 성공 엔진 수", () => {
    const out = toMcpResult(completedJob, "브랜드", "claude");
    expect(out).not.toBeNull();
    expect(out?.engines).toEqual([
      expect.objectContaining({
        engine: "chatgpt",
        mentioned: true,
        availability: "measured",
      }),
      expect.objectContaining({
        engine: "claude",
        mentioned: false,
        availability: "measured",
      }),
      expect.objectContaining({
        engine: "naver",
        mentioned: true,
        availability: "measured",
      }),
      expect.objectContaining({
        engine: "gemini",
        mentioned: null,
        availability: "error",
      }),
    ]);
    expect(out?.findings[0]?.text_ko).toBe(
      "측정에 성공한 AI 엔진 3곳 중 2곳에서 브랜드가 언급되었습니다."
    );
  });

  it("인용 도메인은 상위 3개만, 인용 해석이 제한된 결과에는 아예 넣지 않는다", () => {
    const open = toMcpResult(completedJob, null, "claude");
    expect(open?.findings[1]?.text_ko).toBe(
      "답변에서 자주 인용된 도메인: a.com(3회), b.com(2회), c.com(1회)"
    );
    fx.restricted = true;
    expect(toMcpResult(completedJob, null, "claude")?.findings).toHaveLength(1);
  });

  it("표시 불가 판정이면 null — 숫자를 내보내지 않는다", () => {
    fx.publishable = false;
    expect(toMcpResult(completedJob, null, "claude")).toBeNull();
  });

  it("커버된 엔진이 0개면 null", () => {
    fx.metrics = { enginesCovered: [], enginesWithMention: [] };
    expect(toMcpResult(completedJob, null, "claude")).toBeNull();
  });

  it("응답에 이메일·비용·PDF 같은 내부 필드가 없다", () => {
    const text = JSON.stringify(toMcpResult(completedJob, "브랜드", "claude"));
    expect(text).not.toContain("someone-else@example.com");
    expect(text).not.toMatch(/email|cost|pdf|crew|jobId/i);
    expect(text).toContain("매번 달라질 수 있");
  });
});

describe("start_ai_visibility_check", () => {
  it("캐시가 있으면 측정 플래그와 상관없이 즉시 결과를 주고 job_id 를 노출하지 않는다", async () => {
    const { deps, db } = makeDeps({
      findCachedByDomain: vi.fn(async () => "cached-job"),
    });
    db.auditJob.findUnique.mockResolvedValue(completedJob);
    const out = await startAiVisibilityCheck(input, deps);
    expect(out).toMatchObject({ state: "completed", source: "cache" });
    expect(JSON.stringify(out)).not.toMatch(/cached-job|job_id|someone-else/);
    expect(db.auditJob.create).not.toHaveBeenCalled();
  });

  it("MEASURE 플래그가 꺼져 있으면(기본) 새 측정을 만들지 않고 안내한다", async () => {
    const { deps, db } = makeDeps();
    const out = await startAiVisibilityCheck(input, deps);
    expect(out).toMatchObject({ state: "measurement_unavailable" });
    expect(db.auditJob.create).not.toHaveBeenCalled();
    expect(deps.runAuditJob).not.toHaveBeenCalled();
  });

  it("표시 불가한 캐시는 없는 것으로 본다(꺼짐이면 안내)", async () => {
    fx.publishable = false;
    const { deps, db } = makeDeps({
      findCachedByDomain: vi.fn(async () => "c"),
    });
    db.auditJob.findUnique.mockResolvedValue(completedJob);
    expect(await startAiVisibilityCheck(input, deps)).toMatchObject({
      state: "measurement_unavailable",
    });
  });

  describe("MEASURE 켜짐", () => {
    beforeEach(() => {
      vi.stubEnv("FINDABLE_MCP_ENABLED", "true");
      vi.stubEnv("FINDABLE_MCP_MEASURE_ENABLED", "true");
    });

    it("새 측정은 시스템 주소로 job 을 만들고 응답 후 러너를 부른다(리드·이메일 없음)", async () => {
      const { deps, db, tasks } = makeDeps();
      const out = await startAiVisibilityCheck(input, deps);
      expect(out).toMatchObject({
        state: "started",
        job_id: JOB_ID,
        poll_after_seconds: 20,
      });
      expect(db.auditJob.create).toHaveBeenCalledWith({
        data: {
          email: MCP_SYSTEM_EMAIL,
          domain: "brand.example",
          language: "ko",
          ipAddress: null,
        },
        select: { id: true },
      });
      expect(deps.runAuditJob).not.toHaveBeenCalled(); // 응답 뒤에 실행
      await tasks[0]?.();
      expect(deps.runAuditJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: JOB_ID,
          domain: "brand.example",
          language: "ko",
          brandName: "브랜드",
        })
      );
    });

    it("러너가 던져도 응답 뒤 작업이 예외를 밖으로 내지 않는다", async () => {
      const { deps, tasks } = makeDeps({
        runAuditJob: vi.fn(() => Promise.reject(new Error("boom"))),
      });
      await startAiVisibilityCheck(input, deps);
      await expect(tasks[0]?.()).resolves.toBeUndefined();
      expect(deps.log.error).toHaveBeenCalledWith(
        "mcp.job.uncaught",
        expect.any(Object)
      );
    });

    it("같은 도메인이 진행 중이면 같은 job_id 를 돌려주고 새로 만들지 않는다", async () => {
      const { deps, db } = makeDeps();
      db.auditJob.findFirst.mockResolvedValue({ id: OTHER_JOB });
      const out = await startAiVisibilityCheck(input, deps);
      expect(out).toMatchObject({ state: "started", job_id: OTHER_JOB });
      expect(db.auditJob.create).not.toHaveBeenCalled();
    });

    it("MCP 일일 상한(기본 2)에 닿으면 rate_limited — 만들지 않는다", async () => {
      const { deps, db } = makeDeps();
      db.auditJob.count.mockResolvedValue(2);
      const out = await startAiVisibilityCheck(input, deps);
      expect(out).toMatchObject({
        state: "rate_limited",
        reason: "mcp_daily_cap",
        retry_after_seconds: 3600,
      });
      expect(db.auditJob.create).not.toHaveBeenCalled();
      const countArg = db.auditJob.count.mock.calls[0]?.[0] as {
        where: { email: string; NOT: unknown };
      };
      expect(countArg.where.email).toBe(MCP_SYSTEM_EMAIL);
      expect(countArg.where.NOT).toEqual({ status: "failed" });
    });

    it("상한을 환경변수로 올리면 그만큼 허용한다", async () => {
      vi.stubEnv("FINDABLE_MCP_DAILY_JOB_CAP", "5");
      const { deps, db } = makeDeps();
      db.auditJob.count.mockResolvedValue(4);
      expect(await startAiVisibilityCheck(input, deps)).toMatchObject({
        state: "started",
      });
    });

    it("상한 0 은 측정 전면 중단", async () => {
      vi.stubEnv("FINDABLE_MCP_DAILY_JOB_CAP", "0");
      const { deps } = makeDeps();
      expect(await startAiVisibilityCheck(input, deps)).toMatchObject({
        state: "rate_limited",
        reason: "mcp_daily_cap",
      });
    });

    it("전역 무료 예산이 소진되면 rate_limited(daily_budget)", async () => {
      const { deps, db } = makeDeps({
        isDailyBudgetExhausted: vi.fn(async () => true),
      });
      const out = await startAiVisibilityCheck(input, deps);
      expect(out).toMatchObject({
        state: "rate_limited",
        reason: "daily_budget",
      });
      expect(db.auditJob.create).not.toHaveBeenCalled();
    });

    it("예산이 소진돼도 캐시된 도메인은 결과를 받는다", async () => {
      const { deps, db } = makeDeps({
        isDailyBudgetExhausted: vi.fn(async () => true),
        findCachedByDomain: vi.fn(async () => "c"),
      });
      db.auditJob.findUnique.mockResolvedValue(completedJob);
      expect(await startAiVisibilityCheck(input, deps)).toMatchObject({
        state: "completed",
        source: "cache",
      });
    });
  });

  it("사설 주소·이상한 입력은 DB 를 건드리기 전에 거절한다", async () => {
    const { deps, db } = makeDeps();
    await expect(
      startAiVisibilityCheck({ ...input, url: "http://private.test" }, deps)
    ).rejects.toThrow("URL_PRIVATE");
    await expect(
      startAiVisibilityCheck({ ...input, url: "" }, deps)
    ).rejects.toThrow("URL_REQUIRED");
    expect(deps.findCachedByDomain).not.toHaveBeenCalled();
    expect(db.auditJob.create).not.toHaveBeenCalled();
  });
});

describe("get_ai_visibility_result", () => {
  it("UUID 가 아니면 조회하지 않고 not found", async () => {
    const { deps, db } = makeDeps();
    expect(
      await getAiVisibilityResult(
        { jobId: "1 OR 1=1", brandName: null, client: "claude" },
        deps
      )
    ).toEqual({ notFound: true });
    expect(db.auditJob.findUnique).not.toHaveBeenCalled();
  });

  it("MCP 가 만든 job 이 아니면(무료 폼·로그인 앱 job) UUID 를 알아도 not found", async () => {
    const { deps, db } = makeDeps();
    db.auditJob.findUnique.mockResolvedValue({
      ...completedJob,
      email: "victim@example.com",
    });
    expect(
      await getAiVisibilityResult(
        { jobId: JOB_ID, brandName: null, client: "claude" },
        deps
      )
    ).toEqual({ notFound: true });
    db.auditJob.findUnique.mockResolvedValue({
      ...completedJob,
      email: "org:abc",
    });
    expect(
      await getAiVisibilityResult(
        { jobId: JOB_ID, brandName: null, client: "claude" },
        deps
      )
    ).toEqual({ notFound: true });
  });

  it("없는 job 은 not found", async () => {
    const { deps } = makeDeps();
    expect(
      await getAiVisibilityResult(
        { jobId: JOB_ID, brandName: null, client: "claude" },
        deps
      )
    ).toEqual({ notFound: true });
  });

  it.each([
    "queued",
    "processing",
  ] as const)("%s 이면 processing + 15초 뒤 재확인", async (status) => {
    const { deps, db } = makeDeps();
    db.auditJob.findUnique.mockResolvedValue({
      ...completedJob,
      email: MCP_SYSTEM_EMAIL,
      status,
      result: null,
    });
    expect(
      await getAiVisibilityResult(
        { jobId: JOB_ID, brandName: null, client: "claude" },
        deps
      )
    ).toMatchObject({
      state: "processing",
      poll_after_seconds: 15,
    });
  });

  it("failed 이면 사람 말 안내 + 정보 링크", async () => {
    const { deps, db } = makeDeps();
    db.auditJob.findUnique.mockResolvedValue({
      ...completedJob,
      email: MCP_SYSTEM_EMAIL,
      status: "failed",
    });
    const out = await getAiVisibilityResult(
      { jobId: JOB_ID, brandName: null, client: "chatgpt" },
      deps
    );
    expect(out).toMatchObject({ state: "failed" });
    expect(JSON.stringify(out)).toContain("utm_medium=chatgpt");
  });

  it("completed + 표시 가능이면 결과, 표시 불가면 result_unavailable", async () => {
    const { deps, db } = makeDeps();
    db.auditJob.findUnique.mockResolvedValue({
      ...completedJob,
      email: MCP_SYSTEM_EMAIL,
    });
    expect(
      await getAiVisibilityResult(
        { jobId: JOB_ID, brandName: "브랜드", client: "claude" },
        deps
      )
    ).toMatchObject({
      state: "completed",
      result: { domain: "brand.example", brand_name: "브랜드" },
    });
    fx.publishable = false;
    expect(
      await getAiVisibilityResult(
        { jobId: JOB_ID, brandName: null, client: "claude" },
        deps
      )
    ).toMatchObject({
      state: "result_unavailable",
    });
  });
});
