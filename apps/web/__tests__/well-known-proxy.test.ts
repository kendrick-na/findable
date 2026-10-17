/**
 * /.well-known/* 가 i18n(로케일 리다이렉트)·Arcjet 을 타지 않는다 — MCP·ChatGPT 도메인 인증 전제.
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isWellKnownPath } from "@/lib/well-known-path";

afterEach(() => vi.unstubAllEnvs());

describe("isWellKnownPath", () => {
  it("/.well-known 아래 경로만 참", () => {
    expect(isWellKnownPath("/.well-known/openai-apps-challenge")).toBe(true);
    expect(isWellKnownPath("/.well-known/oauth-protected-resource")).toBe(true);
    expect(isWellKnownPath("/.well-known")).toBe(true);
  });

  it("비슷해 보이는 일반 경로는 거짓 — 기존 라우트의 로케일 처리는 그대로", () => {
    for (const p of [
      "/",
      "/ko",
      "/en/pricing",
      "/pricing",
      "/api/mcp",
      "/well-known/x",
      "/x/.well-known/y",
      "/.well-knownx",
      "/ko/.well-known/x",
    ]) {
      expect(isWellKnownPath(p)).toBe(false);
    }
  });
});

describe("proxy.ts 계약", () => {
  const proxy = readFileSync(
    fileURLToPath(new URL("../proxy.ts", import.meta.url)),
    "utf8"
  );

  it("well-known 판정을 i18n·Arcjet 합성 호출보다 먼저 반환한다", () => {
    const early = proxy.indexOf("isWellKnownPath(pathname)");
    const compose = proxy.indexOf("await composedMiddleware(");
    expect(early).toBeGreaterThan(-1);
    expect(compose).toBeGreaterThan(early);
  });

  it("기존 /api·/trpc 조기 반환은 그대로 있다(회귀 가드)", () => {
    expect(proxy).toContain('pathname === "/api"');
    expect(proxy).toContain('pathname.startsWith("/api/")');
    expect(proxy).toContain('pathname.startsWith("/trpc/")');
  });

  it("matcher 의 기존 제외 규칙(api·_next·정적 파일)은 바뀌지 않았다", () => {
    expect(proxy).toContain(
      "(?!api|_next/static|_next/image|ingest|favicon.ico"
    );
    expect(proxy).toContain('"/(api|trpc)(.*)"');
  });
});

describe("/.well-known/openai-apps-challenge 라우트", () => {
  it("토큰이 없으면 404(제출 전엔 아무것도 노출하지 않는다)", async () => {
    vi.resetModules();
    const { GET } = await import(
      "@/app/.well-known/openai-apps-challenge/route"
    );
    expect(GET().status).toBe(404);
  });

  it("토큰이 있으면 text/plain 으로 토큰만 돌려준다(JSON 아님)", async () => {
    vi.stubEnv("OPENAI_APPS_CHALLENGE_TOKEN", "  token-123  ");
    vi.resetModules();
    const { GET } = await import(
      "@/app/.well-known/openai-apps-challenge/route"
    );
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("token-123");
  });
});
