/**
 * 회귀 고정(특성화 테스트) — `POST /api/audit` 의 도메인 캐시·전역 일일 예산 동작.
 *
 * 왜 있나: MCP 커넥터(apps/web/lib/mcp)가 같은 캐시·예산 로직을 재사용하려고
 * 이 로직을 `lib/audit-gates.ts` 로 추출한다. 운영 진단 경로가 **조금도 달라지지 않음**을
 * 추출 전(현재 동작)과 후(추출본)에 같은 테스트로 증명한다. 이 파일은 추출 전에 먼저 통과시켰다.
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  count: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  leadCreate: vi.fn(),
}));

vi.mock("botid/server", () => ({
  checkBotId: vi.fn(async () => ({ isBot: false })),
}));
vi.mock("@repo/database", () => ({
  Prisma: {},
  database: {
    auditJob: {
      count: fx.count,
      findMany: fx.findMany,
      findFirst: fx.findFirst,
      findUnique: fx.findUnique,
      create: fx.create,
    },
    lead: { create: fx.leadCreate },
  },
}));
vi.mock("@repo/audit/runner", () => ({ runAuditJob: vi.fn() }));
vi.mock("@repo/audit/stale-job", () => ({
  isStaleAuditJob: vi.fn(() => false),
  reconcileStaleAuditJob: vi.fn(),
}));
vi.mock("@/app/api/audit/_lib/owner", () => ({
  resolveIsOwner: vi.fn(async () => false),
}));
vi.mock("@repo/observability/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
// `after()` 는 요청 범위 밖에서 던진다 — 응답 후 실행 자체는 이 테스트의 관심사가 아니다.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

const DAY_MS = 24 * 60 * 60 * 1000;

async function submit(body: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/audit/route");
  return POST(
    new NextRequest("http://localhost/api/audit", {
      method: "POST",
      body: JSON.stringify({
        email: "buyer@example.com",
        domain: "https://Brand.Example/",
        ...body,
      }),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FREE_AUDIT_PUBLIC_ENABLED", "true");
  // 상한은 모듈 로드 시 env 로 정해진다 — 매 테스트 새로 불러 이전 env 가 남지 않게 한다.
  vi.resetModules();
  fx.count.mockResolvedValue(0);
  fx.findMany.mockResolvedValue([]);
  fx.findFirst.mockResolvedValue(null);
  fx.findUnique.mockResolvedValue(null);
  fx.leadCreate.mockResolvedValue({});
  fx.create.mockResolvedValue({
    id: "job-new-1",
    status: "pending",
    createdAt: new Date(),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("도메인 캐시 (24h) — 현재 동작 고정", () => {
  it("완료된 공개 측정이 있으면 새 측정 없이 jobId 를 돌려준다", async () => {
    fx.findFirst.mockResolvedValueOnce({ id: "cached-1" });
    const response = await submit();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jobId: "cached-1",
      status: "completed",
      pollUrl: "/api/audit/cached-1",
      cached: true,
    });
    expect(fx.create).not.toHaveBeenCalled();
  });

  it("캐시 조회 조건: 정규화 도메인·같은 언어·완료·비공개(org) 제외·24h·최신순", async () => {
    fx.findFirst.mockResolvedValueOnce({ id: "cached-1" });
    const before = Date.now();
    await submit({ language: "ko" });
    const arg = fx.findFirst.mock.calls[0]?.[0] as {
      where: Record<string, unknown> & { createdAt: { gte: Date } };
      orderBy: unknown;
      select: unknown;
    };
    expect(arg.where).toMatchObject({
      domain: "brand.example",
      language: { in: ["ko"] },
      status: "completed",
      organizationId: null,
      NOT: { email: { startsWith: "org:" } },
    });
    const gte = arg.where.createdAt.gte.getTime();
    expect(gte).toBeGreaterThanOrEqual(before - DAY_MS - 1000);
    expect(gte).toBeLessThanOrEqual(Date.now() - DAY_MS + 1000);
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.select).toEqual({ id: true });
  });

  it("언어는 캐시 키다 — both 요청은 both 측정만 후보로 본다(F8)", async () => {
    await submit({ language: "both" });
    const arg = fx.findFirst.mock.calls[0]?.[0] as {
      where: { language: unknown };
    };
    expect(arg.where.language).toEqual({ in: ["both"] });
  });

  it("캐시로 줘도 리드는 적재한다(servedFromCache)", async () => {
    fx.findFirst.mockResolvedValueOnce({ id: "cached-1" });
    await submit({ language: "ko" });
    expect(fx.leadCreate).toHaveBeenCalledTimes(1);
    expect(fx.leadCreate.mock.calls[0]?.[0]).toEqual({
      data: {
        email: "buyer@example.com",
        domain: "brand.example",
        source: "free_audit",
        metadata: {
          language: "ko",
          jobId: "cached-1",
          servedFromCache: true,
        },
      },
    });
  });

  it("예산이 소진돼도 이미 측정된 도메인은 캐시로 본다(캐시가 예산보다 먼저)", async () => {
    fx.count.mockResolvedValue(9999);
    fx.findFirst.mockResolvedValueOnce({ id: "cached-1" });
    const response = await submit();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cached: true });
    expect(fx.count).not.toHaveBeenCalled();
  });
});

describe("전역 일일 예산 — 현재 동작 고정", () => {
  it("기본 예산 5만원 ÷ 단가 1,000원 = 하루 50건. 50건째는 429 + budgetExhausted", async () => {
    fx.count.mockResolvedValue(50);
    const response = await submit();
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ budgetExhausted: true });
    expect(fx.create).not.toHaveBeenCalled();
  });

  it("49건이면 통과해 새 측정을 만든다", async () => {
    fx.count.mockResolvedValue(49);
    const response = await submit({ language: "ko" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jobId: "job-new-1",
      status: "pending",
      pollUrl: "/api/audit/job-new-1",
    });
    expect(fx.create).toHaveBeenCalledTimes(1);
    const data = (
      fx.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    ).data;
    expect(data).toMatchObject({
      email: "buyer@example.com",
      domain: "brand.example",
      language: "ko",
    });
  });

  it("집계 조건: 최근 24h · 로그인 org 측정(email org:*)은 무료 예산에서 제외", async () => {
    const before = Date.now();
    await submit();
    const arg = fx.count.mock.calls[0]?.[0] as {
      where: {
        createdAt: { gte: Date };
        NOT: { email: { startsWith: string } };
      };
    };
    expect(arg.where.NOT).toEqual({ email: { startsWith: "org:" } });
    const gte = arg.where.createdAt.gte.getTime();
    expect(gte).toBeGreaterThanOrEqual(before - DAY_MS - 1000);
    expect(gte).toBeLessThanOrEqual(Date.now() - DAY_MS + 1000);
  });

  it("FINDABLE_DAILY_FREE_BUDGET_KRW 로 상한을 올릴 수 있다(10만원 → 100건)", async () => {
    vi.stubEnv("FINDABLE_DAILY_FREE_BUDGET_KRW", "100000");
    fx.count.mockResolvedValue(99);
    const ok = await submit();
    expect(ok.status).toBe(200);
    fx.count.mockResolvedValue(100);
    const blocked = await submit();
    expect(blocked.status).toBe(429);
  });

  it("무료 진단 공개 플래그가 꺼져 있으면 캐시·예산 조회 없이 404", async () => {
    vi.stubEnv("FREE_AUDIT_PUBLIC_ENABLED", "");
    const response = await submit();
    expect(response.status).toBe(404);
    expect(fx.findFirst).not.toHaveBeenCalled();
    expect(fx.count).not.toHaveBeenCalled();
  });
});
