/**
 * 읽기 전용 MCP 모드 — 실제 JSON-RPC(POST /api/mcp)로 호출한다.
 * 지시서 4절 시험 1·2·3·4·10(+도구 목록·annotations).
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

let watched: ReturnType<typeof makeWatchedDb>;

function setDb(
  brand: Record<string, unknown> | null,
  job: Record<string, unknown> | null
) {
  watched = makeWatchedDb({ brand, job });
  holder.db = watched.db;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("FINDABLE_MCP_ENABLED", "true");
  vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
  vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", BRAND_ID);
  setDb(
    { id: BRAND_ID, name: "시험브랜드", domain: "brand.example" },
    makeJob()
  );
});
afterEach(() => vi.unstubAllEnvs());

const NEW_TOOLS = [
  "check_official_facts",
  "get_answer_verdict_breakdown",
  "get_brand_measurement_summary",
];

describe("1. start_* 미등록", () => {
  it("tools/list 에 측정 시작·기존 조회 도구가 없고 읽기 도구만 있다", async () => {
    const out = await rpc("tools/list");
    expect(out.status).toBe(200);
    const names = (out.body.result.tools as { name: string }[])
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(NEW_TOOLS);
    expect(names).not.toContain("start_ai_visibility_check");
    expect(names).not.toContain("get_ai_visibility_result");
  });

  it("이름으로 직접 불러도 없는 도구이며 DB 를 건드리지 않는다", async () => {
    for (const name of [
      "start_ai_visibility_check",
      "get_ai_visibility_result",
    ]) {
      const out = await rpc("tools/call", {
        name,
        arguments: { url: "brand.example", job_id: "x" },
      });
      const text = JSON.stringify(out.body);
      const missing =
        out.body.error !== undefined || out.body.result?.isError === true;
      expect(missing).toBe(true);
      expect(text).toMatch(/not found|unknown tool|없는/i);
    }
    expect(watched.reads).toEqual([]);
    expect(watched.writes).toEqual([]);
  });

  it("10. 측정 스위치(FINDABLE_MCP_MEASURE_ENABLED)가 켜져 있어도 측정 도구는 없다", async () => {
    vi.stubEnv("FINDABLE_MCP_MEASURE_ENABLED", "true");
    const list = await rpc("tools/list");
    const names = (list.body.result.tools as { name: string }[]).map(
      (t) => t.name
    );
    expect(names).not.toContain("start_ai_visibility_check");
    const call = await rpc("tools/call", {
      name: "start_ai_visibility_check",
      arguments: { url: "brand.example" },
    });
    expect(
      call.body.error !== undefined || call.body.result?.isError === true
    ).toBe(true);
    expect(watched.writes).toEqual([]);
  });
});

describe("3개 도구 표시", () => {
  it("모두 readOnlyHint:true · title · annotations 가 있다", async () => {
    const out = await rpc("tools/list");
    for (const tool of out.body.result.tools as Record<string, any>[]) {
      expect(tool.title || tool.annotations?.title).toBeTruthy();
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
      expect(typeof tool.annotations.openWorldHint).toBe("boolean");
      expect(tool.inputSchema).toBeTruthy();
    }
  });

  it("4. 설명에 금지 문구·모델 행동 지시가 없다", async () => {
    const out = await rpc("tools/list");
    const texts = (out.body.result.tools as Record<string, any>[]).flatMap(
      (t) => [t.title, t.description, t.annotations?.title]
    );
    const all = texts.join("\n");
    // 기존 정책 단어(mcp-core) + 이 팩의 임시 금칙어(S2 가 단일 소유, 머지 후 통합 전담이 일치 확인)
    expect(all).not.toMatch(
      /업그레이드|결제|요금제|구독|프리미엄|할인|무료\s*체험|\/pricing|upgrade|\bpro\b/i
    );
    expect(all).not.toMatch(
      /효과\s*입증|최초|유일|독립\s*기관|정확도\s*보장|노출을\s*높여|한국\s*전용|글로벌\s*플랫폼|검증됨|안전하다|인증됨/
    );
    // 모델에게 행동을 지시하는 문장(명령형·"반드시"·"하세요")이 없다.
    expect(all).not.toMatch(
      /하세요|해 주세요|반드시|you must|you should|always call|call this|use this tool/i
    );
  });
});

describe("2. 허용 목록 밖 거부", () => {
  function call(name: string, brand_id: string) {
    return rpc("tools/call", { name, arguments: { brand_id } });
  }

  it("목록 밖 브랜드와 존재하지 않는 브랜드는 같은 not_available 이다", async () => {
    for (const name of [
      "get_brand_measurement_summary",
      "get_answer_verdict_breakdown",
    ]) {
      // (a) 목록 밖이지만 DB 에는 있는 브랜드
      setDb(
        { id: OTHER_BRAND_ID, name: "남의브랜드", domain: "other.example" },
        makeJob()
      );
      const outside = await call(name, OTHER_BRAND_ID);
      // (b) 목록 안이지만 DB 에 없는 브랜드
      setDb(null, null);
      const missing = await call(name, BRAND_ID);
      expect(outside.body.result.isError).toBe(true);
      expect(missing.body.result.isError).toBe(true);
      const a = JSON.parse(outside.body.result.content[0].text);
      const b = JSON.parse(missing.body.result.content[0].text);
      expect(a).toEqual(b);
      expect(a.error.code).toBe("not_available");
      expect(JSON.stringify(a)).not.toContain("남의브랜드");
    }
  });

  it("허용 목록이 비어 있으면 아무 브랜드도 읽지 않고 DB 도 건드리지 않는다", async () => {
    vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", "");
    const out = await call("get_brand_measurement_summary", BRAND_ID);
    expect(out.body.result.isError).toBe(true);
    expect(JSON.parse(out.body.result.content[0].text).error.code).toBe(
      "not_available"
    );
    expect(watched.reads).toEqual([]);
  });
});

describe("3. DB 쓰기 0", () => {
  it("새 도구 호출 전체에서 읽기 외 메서드가 한 번도 불리지 않는다", async () => {
    for (const name of [
      "get_brand_measurement_summary",
      "get_answer_verdict_breakdown",
    ]) {
      const out = await rpc("tools/call", {
        name,
        arguments: { brand_id: BRAND_ID },
      });
      expect(out.body.result.isError).not.toBe(true);
    }
    // 목록 밖·없는 브랜드·결과 없음 경로까지 모두.
    await rpc("tools/call", {
      name: "get_brand_measurement_summary",
      arguments: { brand_id: OTHER_BRAND_ID },
    });
    setDb({ id: BRAND_ID, name: "시험브랜드", domain: "brand.example" }, null);
    await rpc("tools/call", {
      name: "get_answer_verdict_breakdown",
      arguments: { brand_id: BRAND_ID },
    });
    expect(watched.writes).toEqual([]);
    expect(
      watched.reads.every((r) =>
        ["auditJob.findFirst", "auditJob.findMany", "brand.findFirst"].includes(
          r
        )
      )
    ).toBe(true);
  });

  it("읽기 전용 모드에서는 쓰기 가능한 의존성(makeBridgeDeps)을 만들지 않는다", async () => {
    vi.doMock("../lib/mcp/server", async (importOriginal) => {
      const real = await importOriginal<typeof import("../lib/mcp/server")>();
      return { ...real, makeBridgeDeps: vi.fn(real.makeBridgeDeps) };
    });
    const server = await import("../lib/mcp/server");
    await rpc("tools/list");
    await rpc("tools/call", {
      name: "get_brand_measurement_summary",
      arguments: { brand_id: BRAND_ID },
    });
    expect(server.makeBridgeDeps).not.toHaveBeenCalled();
    vi.doUnmock("../lib/mcp/server");
  });
});
