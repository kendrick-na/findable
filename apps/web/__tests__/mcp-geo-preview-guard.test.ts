/**
 * 프리뷰 한정 장치: 운영 거부 가드·빈 허용 목록 무요청·토큰 만료. 값(토큰)은 시험 안에서 임의 문자열로 만들고 출력하지 않는다.
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

const token = `t_${randomBytes(12).toString("hex")}`;
const AUTH = { authorization: `Bearer ${token}` };
let fetchSpy: ReturnType<typeof vi.fn>;
let watched: ReturnType<typeof makeWatchedDb>;

beforeEach(() => {
  vi.resetModules();
  watched = makeWatchedDb({
    brand: { id: BRAND_ID, name: "시험브랜드", domain: "brand.example" },
    job: makeJob(),
  });
  holder.db = watched.db;
  fetchSpy = vi.fn(() => Promise.resolve(new Response("<html></html>")));
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("FINDABLE_MCP_ENABLED", "true");
  vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", BRAND_ID);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function previewOn(expires = "2099-01-01T00:00:00Z") {
  vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
  vi.stubEnv("FINDABLE_MCP_TOKEN_REQUIRED", "true");
  vi.stubEnv("FINDABLE_MCP_PREVIEW_TOKEN", token);
  vi.stubEnv("FINDABLE_MCP_PREVIEW_TOKEN_EXPIRES_AT", expires);
}

describe("운영 환경 거부 가드(등록 안 함)", () => {
  it("VERCEL_ENV=production 이면 읽기 전용 모드를 켜 놨어도 503 이고 DB·네트워크를 건드리지 않는다", async () => {
    previewOn();
    vi.stubEnv("VERCEL_ENV", "production");
    const out = await rpc("tools/list", {}, AUTH);
    expect(out.status).toBe(503);
    expect(watched.reads).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("VERCEL_ENV 가 없고 NODE_ENV=production 이어도 거부한다", async () => {
    previewOn();
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    expect((await rpc("tools/list", {}, AUTH)).status).toBe(503);
  });

  it("프리뷰 배포(VERCEL_ENV=preview, NODE_ENV=production)는 허용한다 — 프리뷰도 NODE_ENV 가 production 이기 때문", async () => {
    previewOn();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    const out = await rpc("tools/list", {}, AUTH);
    expect(out.status).toBe(200);
    const names = (out.body.result.tools as { name: string }[]).map(
      (t) => t.name
    );
    expect(names).toContain("check_official_facts");
    expect(names).not.toContain("start_ai_visibility_check");
  });

  it("운영에서는 공식 정보 점검 도구를 등록하지 않는다(등록 함수 직접 확인)", async () => {
    vi.stubEnv("FINDABLE_MCP_TOKEN_REQUIRED", "true");
    vi.stubEnv("VERCEL_ENV", "production");
    const { registerGeoReadonlyTools, toReadonlyDb } = await import(
      "../lib/mcp/geo-tools"
    );
    const names: string[] = [];
    registerGeoReadonlyTools(
      { registerTool: (n: string) => names.push(n) } as never,
      {
        allowlist: new Set([BRAND_ID]),
        db: toReadonlyDb(watched.db),
        log: { error: vi.fn() },
      }
    );
    expect(names.sort()).toEqual([
      "get_answer_verdict_breakdown",
      "get_brand_measurement_summary",
    ]);
  });

  it("기존 직접 경로(읽기 전용 모드 꺼짐)도 운영에서는 점검 도구가 모든 주소를 거부한다", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const out = await rpc("tools/call", {
      name: "check_official_facts",
      arguments: { url: "https://brand.example" },
    });
    expect(out.body.result.isError).toBe(true);
    expect(JSON.stringify(out.body.result.content)).toContain("not_available");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("허용 목록이 비면 네트워크 요청이 나가지 않는다", () => {
  it("빈 허용 목록 + 프리뷰: 점검 호출이 거부되고 fetch 호출 0", async () => {
    previewOn();
    vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", "");
    const out = await rpc(
      "tools/call",
      {
        name: "check_official_facts",
        arguments: { url: "https://brand.example" },
      },
      AUTH
    );
    expect(out.body.result.isError).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("프리뷰 토큰 만료", () => {
  it("만료 전이면 통과, 지났으면 거부, 만료 환경변수가 없거나 읽을 수 없어도 거부", async () => {
    previewOn("2099-01-01T00:00:00Z");
    expect((await rpc("tools/list", {}, AUTH)).status).toBe(200);

    vi.stubEnv("FINDABLE_MCP_PREVIEW_TOKEN_EXPIRES_AT", "2000-01-01T00:00:00Z");
    expect((await rpc("tools/list", {}, AUTH)).status).toBe(401);

    vi.stubEnv("FINDABLE_MCP_PREVIEW_TOKEN_EXPIRES_AT", "");
    expect((await rpc("tools/list", {}, AUTH)).status).toBe(401);

    vi.stubEnv("FINDABLE_MCP_PREVIEW_TOKEN_EXPIRES_AT", "not-a-date");
    expect((await rpc("tools/list", {}, AUTH)).status).toBe(401);
  });

  it("예전 이름(FINDABLE_MCP_READONLY_TOKEN)은 더 이상 토큰으로 인정하지 않는다", async () => {
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    vi.stubEnv("FINDABLE_MCP_TOKEN_REQUIRED", "true");
    vi.stubEnv("FINDABLE_MCP_READONLY_TOKEN", token);
    vi.stubEnv("FINDABLE_MCP_PREVIEW_TOKEN_EXPIRES_AT", "2099-01-01T00:00:00Z");
    expect((await rpc("tools/list", {}, AUTH)).status).toBe(401);
  });

  it("거부 응답에 토큰 값이 나오지 않는다", async () => {
    previewOn("2000-01-01T00:00:00Z");
    const out = await rpc("tools/list", {}, AUTH);
    expect(JSON.stringify(out.body)).not.toContain(token);
  });
});
