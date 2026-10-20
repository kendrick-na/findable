/**
 * 실제 MCP route(POST /api/mcp)·DB 손잡이 경계·리다이렉트·DNS 실패·사설 주소로 해석되는 허용 도메인 — 모의 DNS 로 고정.
 * 외부 호출·실제 DB 는 없다(fetch·DNS·DB 모두 가짜). 플래그는 시험 안에서만 켠다.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BRAND_ID,
  makeJob,
  makeWatchedDb,
  OTHER_BRAND_ID,
  rpc,
} from "./mcp-geo-fixtures";

const holder = vi.hoisted(() => ({
  dns: new Map<string, "fail" | "ok" | "private">(),
  fetched: [] as string[],
  db: null as unknown,
}));

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
// 모의 DNS: 호스트별로 정상·사설 주소로 해석·해석 실패를 돌려준다.
vi.mock("@repo/audit/public-url-security", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@repo/audit/public-url-security")>();
  return {
    ...real,
    assertPublicUrl: vi.fn((u: URL) => {
      const mode = holder.dns.get(u.hostname) ?? "ok";
      if (mode === "private") {
        return Promise.reject(new Error("URL_PRIVATE"));
      }
      if (mode === "fail") {
        return Promise.reject(new Error("URL_DNS"));
      }
      return Promise.resolve();
    }),
  };
});

function setDb(domain = "brand.example") {
  holder.db = makeWatchedDb({
    brand: { id: BRAND_ID, name: "시험브랜드", domain },
    job: makeJob(),
  }).db;
}

/** 요청 URL 을 기록하고, 경로·호스트별로 정해 둔 응답을 돌려주는 가짜 fetch. */
function stubFetch(
  respond: (url: string) => Response = () =>
    new Response("<html></html>", { status: 200 })
) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: unknown) => {
      const url = String(input);
      holder.fetched.push(url);
      return Promise.resolve(respond(url));
    })
  );
}

const TOKEN = "t_route_integration_token_value";
const AUTH = { authorization: `Bearer ${TOKEN}` };

async function facts(url: string, headers: Record<string, string> = AUTH) {
  const out = await rpc(
    "tools/call",
    { name: "check_official_facts", arguments: { url } },
    headers
  );
  return out.body.result as Record<string, any>;
}

beforeEach(() => {
  vi.resetModules();
  holder.dns.clear();
  holder.fetched.length = 0;
  vi.stubEnv("FINDABLE_MCP_ENABLED", "true");
  vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", BRAND_ID);
  setDb();
  stubFetch();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("읽기 전용 모드 route — 공식 정보 점검", () => {
  beforeEach(() => {
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    vi.stubEnv("FINDABLE_MCP_TOKEN_REQUIRED", "true");
    vi.stubEnv("FINDABLE_MCP_READONLY_TOKEN", TOKEN);
  });

  it("허용 도메인은 읽고, 임의 도메인은 요청 없이 거부한다", async () => {
    const good = await facts("https://brand.example");
    expect(good.isError).not.toBe(true);
    expect(holder.fetched.length).toBeGreaterThan(0);
    holder.fetched.length = 0;
    const bad = await facts("https://other.example");
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toContain("not_available");
    expect(holder.fetched).toEqual([]);
  });

  it("허용 도메인이 사설 주소로 해석되면 아무것도 읽지 않고 거절한다", async () => {
    holder.dns.set("brand.example", "private");
    const res = await facts("https://brand.example");
    expect(res.isError).toBe(true);
    expect(holder.fetched).toEqual([]);
  });

  it("DNS 해석에 실패하면 읽지 않고 사람 말 오류로 거절한다", async () => {
    holder.dns.set("brand.example", "fail");
    const res = await facts("https://brand.example");
    expect(res.isError).toBe(true);
    expect(holder.fetched).toEqual([]);
  });

  it("허용→외부 리다이렉트는 외부로 요청하지 않고 그 항목만 확인 불가", async () => {
    stubFetch((url) =>
      url.endsWith("/llms.txt")
        ? Response.redirect("https://evil.test/llms.txt", 302)
        : new Response("<html></html>", { status: 200 })
    );
    const res = await facts("https://brand.example");
    expect(holder.fetched.some((u) => u.includes("evil.test"))).toBe(false);
    const items = res.structuredContent.data.items as {
      key: string;
      status: string;
    }[];
    expect(items.find((i) => i.key === "llms_txt")?.status).toBe("error");
  });

  it("허용→허용(www) 리다이렉트는 따라간다", async () => {
    stubFetch((url) =>
      url === "https://brand.example/llms.txt"
        ? Response.redirect("https://www.brand.example/llms.txt", 301)
        : new Response(url.endsWith("llms.txt") ? "# brand" : "<html></html>", {
            status: 200,
          })
    );
    const res = await facts("https://brand.example");
    const items = res.structuredContent.data.items as {
      key: string;
      status: string;
    }[];
    expect(items.find((i) => i.key === "llms_txt")?.status).toBe("found");
  });

  it("다른 브랜드 ID·허용 목록 밖은 요약 도구에서도 같은 not_available", async () => {
    const out = await rpc(
      "tools/call",
      {
        name: "get_brand_measurement_summary",
        arguments: { brand_id: OTHER_BRAND_ID },
      },
      AUTH
    );
    expect(JSON.stringify(out.body.result.content)).toContain("not_available");
  });
});

describe("기존 직접 경로(읽기 전용 모드 꺼짐) — 공식 정보 점검도 허용 목록 한정", () => {
  it("허용 목록이 비어 있으면 어떤 주소도 읽지 않는다(fail-closed)", async () => {
    vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", "");
    const res = await facts("https://brand.example", {});
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("not_available");
    expect(holder.fetched).toEqual([]);
  });

  it("임의 URL·사설 주소는 거부하고, 허용 목록 브랜드의 도메인만 읽는다", async () => {
    for (const url of [
      "https://other.example",
      "http://localhost",
      "https://brand.example.evil.test",
      "https://brand.example:8443",
    ]) {
      const res = await facts(url, {});
      expect(res.isError, url).toBe(true);
    }
    expect(holder.fetched).toEqual([]);
    const good = await facts("https://brand.example", {});
    expect(good.isError).not.toBe(true);
    // 기존 출력 모양(도구 스키마)은 유지된다.
    const sc = good.structuredContent;
    expect(Object.keys(sc).sort()).toEqual(
      ["checked_at", "checked_url", "items", "limits_ko", "summary_ko"].sort()
    );
    expect(sc.summary_ko).not.toContain("양호");
  });

  it("도구 이름·입력 스키마는 그대로다(brand_name 선택 입력 유지)", async () => {
    const list = await rpc("tools/list");
    const tool = (list.body.result.tools as Record<string, any>[]).find(
      (t) => t.name === "check_official_facts"
    );
    expect(Object.keys(tool?.inputSchema.properties).sort()).toEqual([
      "brand_name",
      "url",
    ]);
  });
});

describe("DB 손잡이 경계", () => {
  it("읽기 손잡이에는 쓰기 메서드가 없고, 부르면 실패한다", async () => {
    const { toReadonlyDb } = await import("../lib/mcp/geo-tools");
    const ro = toReadonlyDb(
      makeWatchedDb({
        brand: { id: BRAND_ID, name: "n", domain: "d.example" },
        job: makeJob(),
      }).db
    ) as unknown as Record<string, Record<string, unknown>>;
    expect(Object.keys(ro.auditJob).sort()).toEqual(["findFirst", "findMany"]);
    expect(Object.keys(ro.brand)).toEqual(["findFirst"]);
    for (const write of ["create", "update", "delete", "upsert"]) {
      expect(ro.auditJob?.[write]).toBeUndefined();
      expect(() => (ro.auditJob?.[write] as () => void)()).toThrow();
    }
  });

  it("도구 호출 전체에서 쓰기 접근 기록이 없다(읽기 전용 모드 route)", async () => {
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    const watched = makeWatchedDb({
      brand: { id: BRAND_ID, name: "시험브랜드", domain: "brand.example" },
      job: makeJob(),
    });
    holder.db = watched.db;
    for (const name of [
      "get_brand_measurement_summary",
      "get_answer_verdict_breakdown",
    ]) {
      await rpc("tools/call", { name, arguments: { brand_id: BRAND_ID } });
    }
    expect(watched.writes).toEqual([]);
    expect(watched.reads.length).toBeGreaterThan(0);
  });
});

describe("최종 직렬화 응답 크기 상한(64KB) — 실제 route 경로", () => {
  const huge = {
    checked_at: "2026-10-20T00:00:00.000Z",
    checked_url: "https://brand.example",
    items: Array.from({ length: 5000 }, (_v, i) => ({
      detail: `상세 ${"가".repeat(200)}`,
      key: `k${i}`,
      status: "found",
    })),
    limits_ko: "한계",
    summary_ko: "원문 요약",
  };
  const mockHuge = () =>
    vi.doMock("../lib/mcp/official-facts", async (importOriginal) => {
      const real =
        await importOriginal<typeof import("../lib/mcp/official-facts")>();
      return {
        ...real,
        checkOfficialFacts: vi.fn(() => Promise.resolve(huge)),
      };
    });
  const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

  it("읽기 전용 모드: 큰 점검 결과는 항목을 줄이고 truncated:true 로 표시하며 직렬화 크기가 상한 이하다", async () => {
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    vi.stubEnv("FINDABLE_MCP_TOKEN_REQUIRED", "true");
    vi.stubEnv("FINDABLE_MCP_READONLY_TOKEN", TOKEN);
    mockHuge();
    const res = await facts("https://brand.example");
    const sc = res.structuredContent;
    expect(sc.truncation).toMatchObject({ truncated: true });
    expect(sc.data.items.length).toBeLessThanOrEqual(20);
    expect(bytes(sc)).toBeLessThanOrEqual(64 * 1024);
    expect(bytes(res.content)).toBeLessThanOrEqual(2 * 64 * 1024);
    vi.doUnmock("../lib/mcp/official-facts");
  });

  it("기존 직접 경로: 큰 점검 결과는 항목을 비우고 truncated:true 로 응답하며 크기가 상한 이하다", async () => {
    mockHuge();
    const res = await facts("https://brand.example", {});
    const sc = res.structuredContent;
    expect(sc.truncated).toBe(true);
    expect(sc.items).toEqual([]);
    expect(bytes(sc)).toBeLessThanOrEqual(64 * 1024);
    vi.doUnmock("../lib/mcp/official-facts");
  });
});

// 허용 목록 정규화 정책: 대소문자·끝 점·`www.` 접두사는 같은 호스트로 본다. IDN 은 punycode 로 정규화해 비교한다.
// 서브도메인(brand.example 의 하위가 아닌 위장 포함)·포트·사용자정보·IP 리터럴은 같은 호스트로 보지 않는다.
describe("허용 목록 호스트 정규화 회귀", () => {
  beforeEach(() => {
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    vi.stubEnv("FINDABLE_MCP_TOKEN_REQUIRED", "true");
    vi.stubEnv("FINDABLE_MCP_READONLY_TOKEN", TOKEN);
  });

  it("IPv6·IPv4 리터럴 주소는 등록 도메인이 아니므로 요청 없이 거부한다", async () => {
    for (const url of [
      "http://[::1]/",
      "https://[2001:db8::1]/",
      "http://127.0.0.1/",
      "http://[::ffff:127.0.0.1]/",
    ]) {
      const res = await facts(url);
      expect(res.isError, url).toBe(true);
    }
    expect(holder.fetched).toEqual([]);
  });

  it("정책: 끝 점·대문자·www. 는 같은 호스트로 본다", async () => {
    for (const url of [
      "https://brand.example.",
      "https://BRAND.example",
      "https://www.brand.example",
    ]) {
      const res = await facts(url);
      expect(res.isError, url).not.toBe(true);
    }
  });

  it("IDN: 등록된 한글·악센트 도메인은 유니코드와 punycode 표기 모두 같은 호스트이고, 비슷하게 생긴 다른 문자는 거부한다", async () => {
    setDb("bränd.example");
    for (const url of [
      "https://bränd.example",
      "https://xn--brnd-moa.example",
    ]) {
      const res = await facts(url);
      expect(res.isError, url).not.toBe(true);
    }
    holder.fetched.length = 0;
    // 키릴 문자 а(U+0430)를 섞은 위장 도메인
    const spoof = await facts("https://brаnd.example");
    expect(spoof.isError).toBe(true);
    expect(holder.fetched.some((u) => u.includes("xn--br"))).toBe(false);
  });
});
