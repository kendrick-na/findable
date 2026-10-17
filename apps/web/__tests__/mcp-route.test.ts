/**
 * /api/mcp 라우트 통합 — 실제 MCP 프로토콜(JSON-RPC over Streamable HTTP)로 호출한다.
 * @vitest-environment node
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  findFirst: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  Prisma: {},
  database: {
    auditJob: {
      count: fx.count,
      create: fx.create,
      findFirst: fx.findFirst,
      findUnique: fx.findUnique,
      findMany: vi.fn(async () => []),
    },
    lead: { create: vi.fn() },
  },
}));
vi.mock("@repo/audit/runner", () => ({ runAuditJob: vi.fn() }));
vi.mock("@repo/observability/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@repo/audit/public-url-security", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@repo/audit/public-url-security")>();
  return {
    ...real,
    assertPublicUrl: vi.fn(async (u: URL) => {
      if (u.hostname === "private.test") {
        throw new Error("URL_PRIVATE");
      }
    }),
  };
});

const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

async function rpc(
  method: string,
  params: unknown = {},
  extra: Record<string, string> = {}
) {
  const { POST } = await import("@/app/api/mcp/route");
  const response = await POST(
    new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      headers: { ...HEADERS, ...extra },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
  );
  const text = await response.text();
  // JSON 또는 SSE(data: 줄) 둘 다 처리.
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  const json = dataLine ? dataLine.slice(5).trim() : text;
  let body: unknown = null;
  try {
    body = JSON.parse(json);
  } catch {
    body = text;
  }
  return { status: response.status, body: body as Record<string, any> };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  fx.count.mockResolvedValue(0);
  fx.findFirst.mockResolvedValue(null);
  fx.findUnique.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("스위치 꺼짐(기본)", () => {
  it("아무 설정이 없으면 503 이고 DB·외부를 건드리지 않는다", async () => {
    const out = await rpc("tools/list");
    expect(out.status).toBe(503);
    expect(fx.count).not.toHaveBeenCalled();
    expect(fx.create).not.toHaveBeenCalled();
  });
});

describe("스위치 켜짐", () => {
  beforeEach(() => vi.stubEnv("FINDABLE_MCP_ENABLED", "true"));

  it("허용되지 않은 Origin 은 403", async () => {
    const out = await rpc("tools/list", {}, { origin: "https://evil.example" });
    expect(out.status).toBe(403);
  });

  it("허용된 Origin(claude.ai)과 Origin 없음은 통과한다", async () => {
    expect(
      (await rpc("tools/list", {}, { origin: "https://claude.ai" })).status
    ).toBe(200);
    expect((await rpc("tools/list")).status).toBe(200);
  });

  it("도구 3개가 노출되고 전부 title·annotations 가 있다(읽기 전용 표시 포함)", async () => {
    const out = await rpc("tools/list");
    expect(out.status).toBe(200);
    const tools = out.body.result.tools as Array<Record<string, any>>;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "check_official_facts",
      "get_ai_visibility_result",
      "start_ai_visibility_check",
    ]);
    for (const tool of tools) {
      expect(tool.title || tool.annotations?.title).toBeTruthy();
      expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
      expect(typeof tool.annotations.destructiveHint).toBe("boolean");
      expect(typeof tool.annotations.openWorldHint).toBe("boolean");
      expect(tool.inputSchema).toBeTruthy();
    }
    const byName = Object.fromEntries(
      tools.map((t) => [t.name, t.annotations])
    );
    expect(byName.check_official_facts.readOnlyHint).toBe(true);
    expect(byName.get_ai_visibility_result.readOnlyHint).toBe(true);
    expect(byName.start_ai_visibility_check.readOnlyHint).toBe(false);
    expect(byName.start_ai_visibility_check.destructiveHint).toBe(false);
  });

  it("도구 설명에 업그레이드·결제·가격 문구가 없다", async () => {
    const out = await rpc("tools/list");
    const text = JSON.stringify(out.body.result.tools);
    expect(text).not.toMatch(
      /업그레이드|결제|요금제|구독|프리미엄|할인|upgrade|pricing/i
    );
  });

  it("start 도구: 측정 플래그가 꺼져 있고 캐시도 없으면 안내만 하고 job 을 만들지 않는다", async () => {
    const out = await rpc("tools/call", {
      name: "start_ai_visibility_check",
      arguments: { url: "brand.example", brand_name: "브랜드" },
    });
    expect(out.status).toBe(200);
    expect(out.body.result.isError).not.toBe(true);
    expect(out.body.result.structuredContent.state).toBe(
      "measurement_unavailable"
    );
    expect(fx.create).not.toHaveBeenCalled();
  });

  it("start 도구: 사설 주소는 사람 말 오류(isError)로 거절한다", async () => {
    const out = await rpc("tools/call", {
      name: "start_ai_visibility_check",
      arguments: { url: "http://private.test" },
    });
    expect(out.body.result.isError).toBe(true);
    expect(JSON.stringify(out.body.result.content)).toContain(
      "private_address"
    );
    expect(fx.create).not.toHaveBeenCalled();
  });

  it("get 도구: 모르는 job_id 는 job_not_found 이고 다른 경로 job 은 보여주지 않는다", async () => {
    fx.findUnique.mockResolvedValue({
      email: "victim@example.com",
      status: "completed",
      result: {},
      domain: "x",
      completedAt: null,
      createdAt: new Date(),
    });
    const out = await rpc("tools/call", {
      name: "get_ai_visibility_result",
      arguments: { job_id: "11111111-2222-4333-8444-555555555555" },
    });
    expect(out.body.result.isError).toBe(true);
    expect(JSON.stringify(out.body.result)).toContain("job_not_found");
    expect(JSON.stringify(out.body.result)).not.toContain("victim@example.com");
  });
});
