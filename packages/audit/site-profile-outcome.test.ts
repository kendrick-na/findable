import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@repo/observability/log", () => ({
  log: { warn: vi.fn(), info: vi.fn() },
}));
vi.mock("./public-url-security", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assertPublicUrl: () => Promise.resolve(),
}));
const render = vi.hoisted(() => ({ renderSiteHtml: vi.fn() }));
vi.mock("./site-render", () => ({
  renderSiteHtml: render.renderSiteHtml,
  siteRenderStatus: () => "flag_off",
}));

import { readSiteProfileWithOutcome } from "./site-profile";

const RICH = `<html><head><title>프란츠 | 스킨케어</title></head><body><h1>프란츠</h1><p>${"민감성 피부를 위한 보습 크림 서비스입니다. ".repeat(20)}</p></body></html>`;
const THIN =
  "<html><head><title>x</title></head><body><div id='root'></div></body></html>";

type Route = (url: URL) => Response | Promise<Response> | Error;
let calls: string[] = [];
const install = (route: Route) => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL | string) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      const out = route(url);
      return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
    })
  );
};
const html = (body: string) =>
  new Response(body, { headers: { "content-type": "text/html" }, status: 200 });
const text = (body: string, status = 200) => new Response(body, { status });

beforeEach(() => {
  render.renderSiteHtml.mockReset();
  render.renderSiteHtml.mockResolvedValue(null);
  vi.stubEnv("SITE_ROBOTS_FIRST_ENABLED", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("사이트 읽기 사유 코드(readSiteProfileWithOutcome)", () => {
  it("정상 사이트는 ok", async () => {
    install((u) => (u.pathname === "/" ? html(RICH) : text("", 404)));
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("ok");
    expect(out.profile?.thin).toBe(false);
  });

  it("robots 가 홈을 막으면 robots_blocked + 프로필 없음", async () => {
    install((u) =>
      u.pathname === "/robots.txt"
        ? text("User-agent: *\nDisallow: /")
        : html(RICH)
    );
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out).toEqual({ outcome: "robots_blocked", profile: null });
  });

  it("HTTPS 인증서 오류는 certificate_error", async () => {
    const cause = Object.assign(new Error("altnames"), {
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
    });
    install(() => new Error("fetch failed", { cause }));
    expect((await readSiteProfileWithOutcome("example.test")).outcome).toBe(
      "certificate_error"
    );
  });

  it("홈이 HTML 이 아니면 not_html, 5xx 면 fetch_failed", async () => {
    install(
      () =>
        new Response("x", { headers: { "content-type": "application/pdf" } })
    );
    expect((await readSiteProfileWithOutcome("example.test")).outcome).toBe(
      "not_html"
    );
    install(() => text("err", 503));
    expect((await readSiteProfileWithOutcome("example.test")).outcome).toBe(
      "fetch_failed"
    );
  });

  it("글자가 거의 없는 JS 사이트는 렌더링이 못 채우면 render_needed(프로필은 돌려준다)", async () => {
    install((u) => (u.pathname === "/" ? html(THIN) : text("", 404)));
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("render_needed");
    expect(out.profile?.thin).toBe(true);
  });

  it("렌더링을 돌렸는데도 얇으면 thin_after_render(글이 이미지 안에 있는 사이트)", async () => {
    install((u) => (u.pathname === "/" ? html(THIN) : text("", 404)));
    render.renderSiteHtml.mockResolvedValue(THIN);
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("thin_after_render");
  });

  it("렌더링이 채워 주면 ok", async () => {
    install((u) => (u.pathname === "/" ? html(THIN) : text("", 404)));
    render.renderSiteHtml.mockResolvedValue(RICH);
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("ok");
    expect(out.profile?.rendered).toBe(true);
  });
});

describe("robots 우회 금지 불변식", () => {
  const BLOCKED_ROBOTS = "User-agent: *\nDisallow: /";
  const SITEMAP =
    "<urlset><url><loc>https://example.test/service/secret</loc></url><url><loc>https://example.test/service/open</loc></url></urlset>";

  it("금지 경로(/service/secret)는 사이트맵에 있어도 절대 요청하지 않는다", async () => {
    install((u) => {
      if (u.pathname === "/robots.txt") {
        return text("User-agent: *\nDisallow: /service/secret");
      }
      if (u.pathname === "/sitemap.xml") {
        return text(SITEMAP);
      }
      return html(RICH);
    });
    await readSiteProfileWithOutcome("example.test");
    expect(calls).not.toContain("/service/secret");
  });

  it("[플래그 켜짐] 홈이 막혀 있으면 홈 페이지(/)를 아예 요청하지 않는다", async () => {
    vi.stubEnv("SITE_ROBOTS_FIRST_ENABLED", "true");
    install((u) =>
      u.pathname === "/robots.txt" ? text(BLOCKED_ROBOTS) : html(RICH)
    );
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("robots_blocked");
    expect(calls).toEqual(["/robots.txt"]);
  });

  it("[플래그 꺼짐 — 예전 동작 고정] 홈을 먼저 받은 뒤 robots 로 막는다(그래서 켜는 것을 권한다)", async () => {
    install((u) =>
      u.pathname === "/robots.txt" ? text(BLOCKED_ROBOTS) : html(RICH)
    );
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("robots_blocked");
    expect(calls).toContain("/");
  });

  it("robots.txt 가 없으면(404) 막히지 않은 것으로 읽는다(플래그 켜짐에서도 정상 사이트는 ok)", async () => {
    vi.stubEnv("SITE_ROBOTS_FIRST_ENABLED", "true");
    install((u) => (u.pathname === "/" ? html(RICH) : text("", 404)));
    expect((await readSiteProfileWithOutcome("example.test")).outcome).toBe(
      "ok"
    );
  });
});
