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

/** 토큰 검사를 켜고(check_official_facts 는 그때만 등록된다) 맞는 Authorization 헤더를 돌려준다. */
function factsAuth() {
  const good = `t_${randomBytes(12).toString("hex")}`;
  vi.stubEnv("FINDABLE_MCP_TOKEN_REQUIRED", "true");
  vi.stubEnv("FINDABLE_MCP_PREVIEW_TOKEN", good);
  vi.stubEnv("FINDABLE_MCP_PREVIEW_TOKEN_EXPIRES_AT", "2099-01-01T00:00:00Z");
  return { authorization: `Bearer ${good}` };
}

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
    vi.stubEnv("FINDABLE_MCP_PREVIEW_TOKEN", good);
    vi.stubEnv("FINDABLE_MCP_PREVIEW_TOKEN_EXPIRES_AT", "2099-01-01T00:00:00Z");
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
    vi.stubEnv("FINDABLE_MCP_PREVIEW_TOKEN", good);
    vi.stubEnv("FINDABLE_MCP_PREVIEW_TOKEN_EXPIRES_AT", "2099-01-01T00:00:00Z");
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
    vi.stubEnv("FINDABLE_MCP_PREVIEW_TOKEN", "");
    vi.stubEnv("FINDABLE_MCP_PREVIEW_TOKEN_EXPIRES_AT", "2099-01-01T00:00:00Z");
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
    const out = await runFacts(
      {
        allowlist: new Set([BRAND_ID]),
        db: toReadonlyDb(
          makeWatchedDb({
            brand: {
              id: BRAND_ID,
              name: "시험브랜드",
              domain: "brand.example",
            },
            job: null,
          }).db
        ),
        fetchImpl: fakeFetch,
        log: { error: vi.fn() },
      },
      "https://brand.example"
    );
    expect("response" in out).toBe(true);
    const res = ("response" in out ? out.response : {}) as Record<string, any>;
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

  describe("주소 정규화·리다이렉트 가둠", () => {
    const registered = {
      brand: { id: BRAND_ID, name: "시험브랜드", domain: "brand.example" },
      job: null,
    };

    async function facts(
      url: string,
      fetchImpl: typeof fetch,
      domain = "brand.example"
    ) {
      vi.doMock("@repo/audit/public-url-security", async (importOriginal) => {
        const real =
          await importOriginal<
            typeof import("@repo/audit/public-url-security")
          >();
        return { ...real, assertPublicUrl: vi.fn(async () => undefined) };
      });
      const { runFacts, toReadonlyDb } = await import("../lib/mcp/geo-tools");
      const out = await runFacts(
        {
          allowlist: new Set([BRAND_ID]),
          db: toReadonlyDb(
            makeWatchedDb({
              ...registered,
              brand: { ...registered.brand, domain },
            }).db
          ),
          fetchImpl,
          log: { error: vi.fn() },
        },
        url
      );
      vi.doUnmock("@repo/audit/public-url-security");
      return out;
    }

    const plainFetch = () =>
      vi.fn(
        async (input: unknown) =>
          new Response(
            String(input).endsWith("robots.txt")
              ? "User-agent: *\n"
              : "<html></html>",
            { status: 200 }
          )
      ) as unknown as typeof fetch & { mock: { calls: unknown[][] } };

    it("포트·사용자정보·유니코드 위장·서브도메인 위장·경로 속 호스트는 거부한다", async () => {
      for (const url of [
        "https://brand.example:8443",
        "https://user:pw@brand.example",
        "https://brand.example@evil.test",
        "https://bränd.example",
        "https://brand.example.evil.test",
        "https://evil.test/brand.example",
        "ftp://brand.example",
      ]) {
        const f = plainFetch();
        const out = await facts(url, f);
        expect(out, url).toEqual({ error: "not_available" });
        expect(f.mock.calls.length, url).toBe(0);
      }
    });

    it("대소문자·끝 점·www·유니코드 등록 도메인(punycode 동일)은 같은 호스트로 본다", async () => {
      for (const url of [
        "HTTPS://BRAND.EXAMPLE",
        "https://brand.example.",
        "https://www.brand.example",
        "brand.example",
      ]) {
        const out = await facts(url, plainFetch());
        expect("response" in out, url).toBe(true);
      }
      const idn = await facts(
        "https://bränd.example",
        plainFetch(),
        "bränd.example"
      );
      expect("response" in idn).toBe(true);
    });

    it("허용→외부 리다이렉트는 따라가지 않고(요청도 안 보냄) 그 항목만 확인 불가로 둔다", async () => {
      const seen: string[] = [];
      const f = vi.fn((input: unknown) => {
        const u = String(input);
        seen.push(u);
        if (u.endsWith("/llms.txt")) {
          return Promise.resolve(
            Response.redirect("https://evil.test/llms.txt", 302)
          );
        }
        return Promise.resolve(new Response("<html></html>", { status: 200 }));
      }) as unknown as typeof fetch;
      const out = await facts("https://brand.example", f);
      const res = ("response" in out ? out.response : {}) as Record<
        string,
        any
      >;
      expect(seen.some((u) => u.includes("evil.test"))).toBe(false);
      const llms = res.data.items.find((i: any) => i.key === "llms_txt");
      expect(llms.status).toBe("error");
      expect(res.data.items.find((i: any) => i.key === "json_ld").status).toBe(
        "missing"
      );
    });

    it("허용→허용(www) 리다이렉트는 따라가서 읽는다", async () => {
      const f = vi.fn((input: unknown) => {
        const u = String(input);
        if (u === "https://brand.example/llms.txt") {
          return Promise.resolve(
            Response.redirect("https://www.brand.example/llms.txt", 301)
          );
        }
        return Promise.resolve(
          new Response(u.endsWith("llms.txt") ? "# brand" : "<html></html>", {
            status: 200,
          })
        );
      }) as unknown as typeof fetch;
      const out = await facts("https://brand.example", f);
      const res = ("response" in out ? out.response : {}) as Record<
        string,
        any
      >;
      expect(res.data.items.find((i: any) => i.key === "llms_txt").status).toBe(
        "found"
      );
    });

    it("요약 문구는 「양호」 같은 평가 없이 규칙 기준 통과 건수만 말한다", async () => {
      const out = await facts("https://brand.example", plainFetch());
      const res = ("response" in out ? out.response : {}) as Record<
        string,
        any
      >;
      expect(res.message_ko).toContain("규칙 기준을 통과");
      expect(res.message_ko).not.toContain("양호");
      expect(res.data.summary_ko).toBe(res.message_ko);
    });
  });

  it("허용 목록에 없는 주소(사설·임의 URL 포함)는 not_available 로 거부한다", async () => {
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", BRAND_ID);
    for (const url of [
      "http://localhost",
      "https://other.example",
      "https://brand.example.evil.test",
      "not a url",
    ]) {
      const out = await rpc(
        "tools/call",
        { name: "check_official_facts", arguments: { url } },
        factsAuth()
      );
      expect(out.body.result.isError).toBe(true);
      expect(JSON.stringify(out.body.result.content)).toContain(
        "not_available"
      );
    }
  });

  it("토큰 검사가 꺼져 있으면 check_official_facts 는 목록에 없고 호출해도 없는 도구다(fail-closed)", async () => {
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", BRAND_ID);
    const list = await rpc("tools/list");
    const names = (list.body.result.tools as { name: string }[]).map(
      (t) => t.name
    );
    expect(names).not.toContain("check_official_facts");
    expect(names.sort()).toEqual([
      "get_answer_verdict_breakdown",
      "get_brand_measurement_summary",
    ]);
    const call = await rpc("tools/call", {
      name: "check_official_facts",
      arguments: { url: "https://brand.example" },
    });
    expect(
      call.body.error !== undefined || call.body.result?.isError === true
    ).toBe(true);
  });

  it("토큰 검사가 켜져 있으면 check_official_facts 가 목록에 있다", async () => {
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", BRAND_ID);
    const list = await rpc("tools/list", {}, factsAuth());
    const names = (list.body.result.tools as { name: string }[]).map(
      (t) => t.name
    );
    expect(names).toContain("check_official_facts");
  });

  it("읽기 전용 모드에서는 기존 registerFindableTools(직접 경로)가 한 번도 불리지 않는다", async () => {
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", BRAND_ID);
    const spy = vi.fn();
    vi.doMock("../lib/mcp/tools", () => ({ registerFindableTools: spy }));
    for (const method of ["tools/list", "tools/call"]) {
      await rpc(
        method,
        method === "tools/call"
          ? {
              name: "check_official_facts",
              arguments: { url: "https://brand.example" },
            }
          : {},
        factsAuth()
      );
    }
    expect(spy).not.toHaveBeenCalled();
    vi.doUnmock("../lib/mcp/tools");
  });

  it("허용 목록이 비어 있으면 등록 도메인이어도 거부한다", async () => {
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", "");
    const out = await rpc(
      "tools/call",
      {
        name: "check_official_facts",
        arguments: { url: "https://brand.example" },
      },
      factsAuth()
    );
    expect(out.body.result.isError).toBe(true);
    expect(JSON.stringify(out.body.result.content)).toContain("not_available");
  });

  it("등록 도메인이 사설 주소로 풀리면 기존 방어가 그대로 거절한다", async () => {
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", BRAND_ID);
    holder.db = makeWatchedDb({
      brand: { id: BRAND_ID, name: "시험브랜드", domain: "localhost" },
      job: makeJob(),
    }).db;
    const out = await rpc(
      "tools/call",
      { name: "check_official_facts", arguments: { url: "http://localhost" } },
      factsAuth()
    );
    expect(out.body.result.isError).toBe(true);
    expect(JSON.stringify(out.body.result.content)).toMatch(
      /url_unsafe|private_address|url_invalid/
    );
  });
});
