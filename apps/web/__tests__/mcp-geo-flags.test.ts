/**
 * 토큰 모드·허용 목록 해석·꺼짐 회귀·M-facts — 지시서 4절 시험 7·8 (+M-facts 등록).
 * 토큰 값은 시험 안에서 임의 문자열로 만들고 로그·스냅샷에 남기지 않는다.
 * @vitest-environment node
 */
import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BRAND_ID, makeJob, makeWatchedDb, rpc } from "./mcp-geo-fixtures";

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@repo/database", () => ({
  Prisma: {},
  database: new Proxy(
    {},
    { get: (_t, prop) => (holder.db as Record<string, unknown>)[String(prop)] }
  ),
}));
vi.mock("@repo/audit/runner", () => ({ runAuditJob: vi.fn() }));
vi.mock("@repo/observability/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const token = () => `t_${randomBytes(12).toString("hex")}`;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("FINDABLE_MCP_ENABLED", "true");
  holder.db = makeWatchedDb({
    brand: { id: BRAND_ID, name: "시험브랜드", domain: "brand.example" },
    job: makeJob(),
  }).db;
});
afterEach(() => vi.unstubAllEnvs());

describe("7. 토큰 모드", () => {
  beforeEach(() => {
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", BRAND_ID);
    vi.stubEnv("FINDABLE_MCP_TOKEN_REQUIRED", "true");
  });

  it("헤더 없음·형식 다름·값 다름은 401, 맞으면 통과한다", async () => {
    const good = token();
    vi.stubEnv("FINDABLE_MCP_READONLY_TOKEN", good);
    expect((await rpc("tools/list")).status).toBe(401);
    expect((await rpc("tools/list", {}, { authorization: good })).status).toBe(
      401
    ); // Bearer 접두사 없음
    expect(
      (await rpc("tools/list", {}, { authorization: `Bearer ${token()}` }))
        .status
    ).toBe(401);
    expect(
      (await rpc("tools/list", {}, { authorization: `Bearer ${good}x` })).status
    ).toBe(401);
    const passed = await rpc(
      "tools/list",
      {},
      { authorization: `Bearer ${good}` }
    );
    expect(passed.status).toBe(200);
    expect(
      (passed.body.result.tools as { name: string }[]).map((t) => t.name).sort()
    ).toEqual([
      "check_official_facts",
      "get_answer_verdict_breakdown",
      "get_brand_measurement_summary",
    ]);
  });

  it("거부 응답에 토큰 값이 들어 있지 않고 DB 도 건드리지 않는다", async () => {
    const good = token();
    vi.stubEnv("FINDABLE_MCP_READONLY_TOKEN", good);
    const wrong = token();
    const watched = makeWatchedDb({ brand: null, job: null });
    holder.db = watched.db;
    const out = await rpc(
      "tools/call",
      {
        name: "get_brand_measurement_summary",
        arguments: { brand_id: BRAND_ID },
      },
      { authorization: `Bearer ${wrong}` }
    );
    expect(out.status).toBe(401);
    const text = JSON.stringify(out.body);
    expect(text).not.toContain(good);
    expect(text).not.toContain(wrong);
    expect(watched.reads).toEqual([]);
  });

  it("토큰 검사가 켜졌는데 서버 토큰이 없으면 아무도 통과하지 못한다", async () => {
    vi.stubEnv("FINDABLE_MCP_READONLY_TOKEN", "");
    expect((await rpc("tools/list")).status).toBe(401);
    expect(
      (await rpc("tools/list", {}, { authorization: "Bearer " })).status
    ).toBe(401);
    expect(
      (await rpc("tools/list", {}, { authorization: `Bearer ${token()}` }))
        .status
    ).toBe(401);
  });

  it("checkReadonlyToken: 검사가 꺼져 있으면 헤더와 무관하게 ok", async () => {
    vi.stubEnv("FINDABLE_MCP_TOKEN_REQUIRED", "");
    const { checkReadonlyToken } = await import("../lib/mcp/geo-flags");
    expect(checkReadonlyToken(null)).toBe("ok");
  });
});

describe("허용 목록·모드 플래그 해석", () => {
  it("쉼표 목록을 공백 제거해 읽고 비어 있으면 빈 집합", async () => {
    const { readonlyBrandAllowlist } = await import("../lib/mcp/geo-flags");
    vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", " a-1 , b-2,, ");
    expect([...readonlyBrandAllowlist()]).toEqual(["a-1", "b-2"]);
    vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", "");
    expect(readonlyBrandAllowlist().size).toBe(0);
  });

  it("읽기 전용 모드는 서버 스위치가 꺼져 있으면 켜지지 않는다", async () => {
    vi.stubEnv("FINDABLE_MCP_ENABLED", "");
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    const { mcpReadonlyModeEnabled } = await import("../lib/mcp/geo-flags");
    expect(mcpReadonlyModeEnabled()).toBe(false);
    expect((await rpc("tools/list")).status).toBe(503);
  });
});

describe("8. 읽기 전용 모드 꺼짐 회귀", () => {
  it("서버만 켜면 기존 도구 3개가 그대로 나온다(토큰·허용 목록 설정이 있어도 무관)", async () => {
    vi.stubEnv("FINDABLE_MCP_TOKEN_REQUIRED", "true");
    vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", BRAND_ID);
    const out = await rpc("tools/list");
    expect(out.status).toBe(200);
    const tools = out.body.result.tools as Record<string, any>[];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "check_official_facts",
      "get_ai_visibility_result",
      "start_ai_visibility_check",
    ]);
    expect(
      tools.find((t) => t.name === "start_ai_visibility_check")?.annotations
        ?.readOnlyHint
    ).toBe(false);
    expect(
      tools.find((t) => t.name === "get_ai_visibility_result")?.annotations
        ?.readOnlyHint
    ).toBe(true);
  });
});

describe("M-facts — 읽기 전용 모드 안에서의 점검", () => {
  it("정상 응답은 live_fetch 봉투를 가지고 항목은 화이트리스트만 싣는다", async () => {
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    const fakeFetch = vi.fn(
      async (input: unknown) =>
        new Response(
          String(input).endsWith("robots.txt")
            ? "User-agent: GPTBot\nDisallow: /\n"
            : "<html></html>",
          { status: 200 }
        )
    ) as unknown as typeof fetch;
    vi.doMock("@repo/audit/public-url-security", async (importOriginal) => {
      const real =
        await importOriginal<
          typeof import("@repo/audit/public-url-security")
        >();
      return { ...real, assertPublicUrl: vi.fn(async () => undefined) };
    });
    const { runFacts, toReadonlyDb } = await import("../lib/mcp/geo-tools");
    const res = (await runFacts(
      {
        allowlist: new Set(),
        db: toReadonlyDb(makeWatchedDb({ brand: null, job: null }).db),
        fetchImpl: fakeFetch,
        log: { error: vi.fn() },
      },
      "https://brand.example"
    )) as Record<string, any>;
    expect(res.status).toBe("ok");
    expect(res.tool).toBe("check_official_facts");
    expect(res.evidence.source_ids.value.kind).toBe("live_fetch");
    expect(res.evidence.source_ids.value.checked_url).toBe(
      "https://brand.example"
    );
    expect(res.evidence.observed.status).toBe("unavailable");
    expect(res.data.items.map((i: any) => i.key).sort()).toEqual([
      "json_ld",
      "llms_txt",
      "robots_ai_crawlers",
      "sitemap",
    ]);
    // 화이트리스트: 항목은 key·status·detail 만.
    for (const item of res.data.items) {
      expect(Object.keys(item).sort()).toEqual(["detail", "key", "status"]);
    }
    vi.doUnmock("@repo/audit/public-url-security");
  });

  it("사설 주소는 사람 말 오류(isError)로 거절한다", async () => {
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    const out = await rpc("tools/call", {
      name: "check_official_facts",
      arguments: { url: "http://localhost" },
    });
    expect(out.body.result.isError).toBe(true);
    expect(JSON.stringify(out.body.result.content)).toMatch(
      /url_unsafe|private_address|url_invalid/
    );
  });
});
