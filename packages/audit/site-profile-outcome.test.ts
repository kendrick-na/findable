import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@repo/observability/log", () => ({
  log: { warn: vi.fn(), info: vi.fn() },
}));
vi.mock("./public-url-security", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assertPublicUrl: () => Promise.resolve(),
}));
const render = vi.hoisted(() => ({ renderSiteHtml: vi.fn() }));
const imageModel = vi.hoisted(() => ({ extractImageText: vi.fn() }));
vi.mock("@repo/ai/lib/image-text", () => ({
  extractImageText: imageModel.extractImageText,
}));
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
  vi.stubEnv("SITE_HTTP_FALLBACK_ENABLED", "");
  vi.stubEnv("SITE_IMAGE_TEXT_ENABLED", "");
  vi.stubEnv("SITE_CERT_SIBLING_HOST_ENABLED", "");
  imageModel.extractImageText.mockReset();
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
    expect(out).toEqual({
      methods: [],
      outcome: "robots_blocked",
      profile: null,
    });
  });

  it("HTTPS 인증서 호스트 불일치는 cert_host_mismatch(원인 세분)", async () => {
    const cause = Object.assign(new Error("altnames"), {
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
    });
    install(() => new Error("fetch failed", { cause }));
    expect((await readSiteProfileWithOutcome("example.test")).outcome).toBe(
      "cert_host_mismatch"
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

// ── 인증서 오류 + 평문 http 폴백(플래그 SITE_HTTP_FALLBACK_ENABLED) ────────────────────────────────
const certError = () =>
  new Error("fetch failed", {
    cause: Object.assign(
      new Error("Hostname/IP does not match certificate's altnames"),
      {
        code: "ERR_TLS_CERT_ALTNAME_INVALID",
      }
    ),
  });
/** https 는 인증서 오류, http 는 route 가 응답한다. 요청한 (프로토콜, 경로) 를 모두 기록한다. */
let seen: string[] = [];
const installTls = (httpRoute: Route) => {
  seen = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL | string) => {
      const url = new URL(String(input));
      seen.push(`${url.protocol}${url.pathname}`);
      if (url.protocol === "https:") {
        return Promise.reject(certError());
      }
      const out = httpRoute(url);
      return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
    })
  );
};

describe("인증서 오류 — http 폴백", () => {
  it("[플래그 꺼짐] https 인증서 오류면 http 를 시도하지 않고 cert_host_mismatch 로 끝난다", async () => {
    installTls(() => html(RICH));
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out).toEqual({
      methods: [],
      outcome: "cert_host_mismatch",
      profile: null,
    });
    expect(seen.every((u) => u.startsWith("https:"))).toBe(true);
  });

  it("[플래그 켜짐] 인증서 오류 뒤 같은 호스트 http 로 읽고 httpFallback 표시(정상 사이트는 ok)", async () => {
    vi.stubEnv("SITE_HTTP_FALLBACK_ENABLED", "true");
    installTls((u) => (u.pathname === "/" ? html(RICH) : text("", 404)));
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("ok");
    expect(out.httpFallback).toBe(true);
    expect(seen).toContain("http:/");
  });

  it("[플래그 켜짐] http 로 읽어도 JS 앱 틀이면 정직하게 render_needed(렌더링 불가) 로 끝난다", async () => {
    vi.stubEnv("SITE_HTTP_FALLBACK_ENABLED", "true");
    installTls((u) => (u.pathname === "/" ? html(THIN) : text("", 404)));
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("render_needed");
    expect(out.profile?.thin).toBe(true);
    expect(out.httpFallback).toBe(true);
  });

  it("[플래그 켜짐] 렌더링을 돌렸는데도 얇으면 thin_after_render", async () => {
    vi.stubEnv("SITE_HTTP_FALLBACK_ENABLED", "true");
    installTls((u) => (u.pathname === "/" ? html(THIN) : text("", 404)));
    render.renderSiteHtml.mockResolvedValue(THIN);
    expect((await readSiteProfileWithOutcome("example.test")).outcome).toBe(
      "thin_after_render"
    );
  });

  it("[플래그 켜짐] http 가 https 로 되돌리면(같은 인증서 오류) 원래 인증서 오류로 끝난다", async () => {
    vi.stubEnv("SITE_HTTP_FALLBACK_ENABLED", "true");
    installTls((u) =>
      u.pathname === "/robots.txt"
        ? text("", 404)
        : Response.redirect("https://example.test/", 301)
    );
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out).toEqual({
      methods: [],
      outcome: "cert_host_mismatch",
      profile: null,
    });
  });

  it("[플래그 켜짐] 인증서 오류가 아닌 실패(5xx)는 http 폴백을 쓰지 않는다", async () => {
    vi.stubEnv("SITE_HTTP_FALLBACK_ENABLED", "true");
    install(() => text("err", 503));
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("fetch_failed");
    expect(calls.every((p) => p !== undefined)).toBe(true);
    expect(out.httpFallback).toBeUndefined();
  });

  it("[플래그 켜짐] http 쪽 robots 가 홈을 막으면 http 로도 읽지 않는다(robots_blocked)", async () => {
    vi.stubEnv("SITE_HTTP_FALLBACK_ENABLED", "true");
    installTls((u) =>
      u.pathname === "/robots.txt"
        ? text("User-agent: *\nDisallow: /")
        : html(RICH)
    );
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("robots_blocked");
    expect(seen).not.toContain("http:/");
  });

  it("🔒 TLS 검증을 끄는 코드가 읽기·이미지 모듈에 없다(rejectUnauthorized·NODE_TLS_REJECT_UNAUTHORIZED·insecure dispatcher)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of [
      "./site-profile.ts",
      "./site-image-text.ts",
      "./site-render.ts",
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(
        /rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|ignoreHTTPSErrors|--ignore-certificate-errors|allowInsecure/i
      );
    }
  });
});

// ── 이미지 속 글자 읽기(플래그 SITE_IMAGE_TEXT_ENABLED) — 가짜 이미지·가짜 모델 ──────────────────────
const PAGE_WITH_IMAGES = `<html><head><title>x</title></head><body><div id="root"></div>
<img src="/logo.png" width="300" height="80" alt="logo">
<img src="/detail1.png" width="800" height="1200" alt="상품 상세">
<img src="/detail2.png" width="800" height="1000">
<img src="/private/secret.png" width="800" height="900">
<img src="/icon-small.png" width="40" height="40">
</body></html>`;
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
const imageRoute =
  (page: string, robots = ""): Route =>
  (u) => {
    if (u.pathname === "/") {
      return html(page);
    }
    if (u.pathname === "/robots.txt") {
      return robots ? text(robots) : text("", 404);
    }
    if (u.pathname.endsWith(".png")) {
      return new Response(PNG, {
        headers: { "content-type": "image/png" },
        status: 200,
      });
    }
    return text("", 404);
  };

describe("이미지 속 글자 읽기", () => {
  it("[플래그 꺼짐] 얇은 사이트여도 이미지를 내려받지도 모델을 부르지도 않는다", async () => {
    install(imageRoute(PAGE_WITH_IMAGES));
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("render_needed");
    expect(calls.some((p) => p.endsWith(".png"))).toBe(false);
    expect(imageModel.extractImageText).not.toHaveBeenCalled();
  });

  it("[플래그 켜짐] 글자가 얇으면 로고·아이콘 제외 이미지의 글자를 재료에 합쳐 image_text_used", async () => {
    vi.stubEnv("SITE_IMAGE_TEXT_ENABLED", "true");
    install(imageRoute(PAGE_WITH_IMAGES));
    imageModel.extractImageText.mockResolvedValue({
      inputTokens: 1200,
      outputTokens: 80,
      text: `프란츠 시카 크림 ${"민감성 피부 보습 진정 ".repeat(15)}`,
    });
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("image_text_used");
    expect(out.profile?.thin).toBe(false);
    expect(out.profile?.bodySnippet).toContain("프란츠 시카 크림");
    expect(out.imageText?.readable).toBeGreaterThan(0);
    expect(out.imageText?.inputTokens).toBeGreaterThan(0);
    // 로고·작은 아이콘은 가져오지 않는다
    expect(calls).not.toContain("/logo.png");
    expect(calls).not.toContain("/icon-small.png");
  });

  it("[플래그 켜짐] robots 금지 경로 이미지는 가져오지 않는다(제3자 사이트)", async () => {
    vi.stubEnv("SITE_IMAGE_TEXT_ENABLED", "true");
    install(imageRoute(PAGE_WITH_IMAGES, "User-agent: *\nDisallow: /private/"));
    imageModel.extractImageText.mockResolvedValue({
      inputTokens: 1,
      outputTokens: 1,
      text: "상세 설명 문구 여러 단어",
    });
    await readSiteProfileWithOutcome("example.test");
    expect(calls).not.toContain("/private/secret.png");
    expect(calls).toContain("/detail1.png");
  });

  it("[플래그 켜짐] 모델이 글자를 못 읽으면 image_text_failed(사유 코드) — 지어내지 않는다", async () => {
    vi.stubEnv("SITE_IMAGE_TEXT_ENABLED", "true");
    install(imageRoute(PAGE_WITH_IMAGES));
    imageModel.extractImageText.mockResolvedValue({
      inputTokens: 1,
      outputTokens: 1,
      text: "",
    });
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("image_text_failed");
    expect(out.profile?.thin).toBe(true);
    expect(out.imageText?.readable).toBe(0);
  });

  it("[플래그 켜짐] 모델 호출이 오류여도 읽기는 정상 종료하고 image_text_failed", async () => {
    vi.stubEnv("SITE_IMAGE_TEXT_ENABLED", "true");
    install(imageRoute(PAGE_WITH_IMAGES));
    imageModel.extractImageText.mockRejectedValue(new Error("model down"));
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("image_text_failed");
    expect(out.imageText?.failed).toBeGreaterThan(0);
  });

  it("[플래그 켜짐] 호출 상한: 사이트당 이미지 수·원가 상한을 넘기지 않는다", async () => {
    vi.stubEnv("SITE_IMAGE_TEXT_ENABLED", "true");
    vi.stubEnv("SITE_IMAGE_TEXT_MAX_IMAGES", "1");
    install(imageRoute(PAGE_WITH_IMAGES));
    imageModel.extractImageText.mockResolvedValue({
      inputTokens: 1,
      outputTokens: 1,
      text: "",
    });
    await readSiteProfileWithOutcome("example.test");
    expect(imageModel.extractImageText).toHaveBeenCalledTimes(1);
  });

  it("[플래그 켜짐] 글자가 충분한 사이트는 이미지에 손대지 않는다", async () => {
    vi.stubEnv("SITE_IMAGE_TEXT_ENABLED", "true");
    install(imageRoute(RICH));
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("ok");
    expect(imageModel.extractImageText).not.toHaveBeenCalled();
  });
});

// ── 인증서 형제 호스트(플래그 SITE_CERT_SIBLING_HOST_ENABLED) + 읽기 방법 기록 ───────────────────────
const altnameError = (list: string) =>
  new Error("fetch failed", {
    cause: Object.assign(
      new Error(
        `Hostname/IP does not match certificate's altnames: Host: shop.example.co.kr. is not in the cert's altnames: ${list}`
      ),
      { code: "ERR_TLS_CERT_ALTNAME_INVALID" }
    ),
  });
const installSibling = (list: string, okHosts: string[], thin = false) => {
  seen = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL | string) => {
      const url = new URL(String(input));
      seen.push(`${url.protocol}//${url.hostname}${url.pathname}`);
      if (url.protocol === "https:" && url.hostname === "shop.example.co.kr") {
        return Promise.reject(altnameError(list));
      }
      if (url.protocol === "https:" && okHosts.includes(url.hostname)) {
        return Promise.resolve(
          url.pathname === "/" ? html(thin ? THIN : RICH) : text("", 404)
        );
      }
      return Promise.reject(altnameError(list));
    })
  );
};

describe("인증서 형제 호스트", () => {
  const LIST =
    "DNS:example.co.kr, DNS:www.example.co.kr, DNS:other-company.com";

  it("[플래그 꺼짐] 형제 호스트를 시도하지 않고 cert_host_mismatch", async () => {
    installSibling(LIST, ["example.co.kr"]);
    const out = await readSiteProfileWithOutcome("shop.example.co.kr");
    expect(out.outcome).toBe("cert_host_mismatch");
    expect(seen.some((u) => u.includes("//example.co.kr"))).toBe(false);
  });

  it("[플래그 켜짐] 같은 인증서의 같은 가족 호스트로 https 검증을 유지한 채 읽는다 — 다른 회사 이름은 시도하지 않는다", async () => {
    vi.stubEnv("SITE_CERT_SIBLING_HOST_ENABLED", "true");
    installSibling(LIST, ["example.co.kr"]);
    const out = await readSiteProfileWithOutcome("shop.example.co.kr");
    expect(out.outcome).toBe("ok");
    expect(out.methods).toEqual(["cert_sibling_host"]);
    expect(seen.every((u) => !u.includes("other-company.com"))).toBe(true);
    expect(seen.every((u) => u.startsWith("https:"))).toBe(true);
  });

  it("[플래그 켜짐] 형제 호스트도 안 되면 http 폴백 플래그가 있을 때만 http 로 이어진다", async () => {
    vi.stubEnv("SITE_CERT_SIBLING_HOST_ENABLED", "true");
    installSibling(LIST, []);
    expect(
      (await readSiteProfileWithOutcome("shop.example.co.kr")).outcome
    ).toBe("cert_host_mismatch");
  });
});

describe("읽기 방법 기록(methods)", () => {
  it("일반 읽기는 plain", async () => {
    install((u) => (u.pathname === "/" ? html(RICH) : text("", 404)));
    expect((await readSiteProfileWithOutcome("example.test")).methods).toEqual([
      "plain",
    ]);
  });
  it("렌더링으로 채웠으면 render", async () => {
    install((u) => (u.pathname === "/" ? html(THIN) : text("", 404)));
    render.renderSiteHtml.mockResolvedValue(RICH);
    expect((await readSiteProfileWithOutcome("example.test")).methods).toEqual([
      "render",
    ]);
  });
  it("http 폴백 + 렌더링 + 이미지 글자 읽기가 이어지면 세 방법이 모두 기록된다", async () => {
    vi.stubEnv("SITE_HTTP_FALLBACK_ENABLED", "true");
    vi.stubEnv("SITE_IMAGE_TEXT_ENABLED", "true");
    seen = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: URL | string) => {
        const url = new URL(String(input));
        seen.push(`${url.protocol}${url.pathname}`);
        if (url.protocol === "https:") {
          return Promise.reject(certError());
        }
        if (url.pathname === "/") {
          return Promise.resolve(html(PAGE_WITH_IMAGES));
        }
        if (url.pathname.endsWith(".png")) {
          return Promise.resolve(
            new Response(PNG, {
              headers: { "content-type": "image/png" },
              status: 200,
            })
          );
        }
        return Promise.resolve(text("", 404));
      })
    );
    render.renderSiteHtml.mockResolvedValue(PAGE_WITH_IMAGES); // 렌더링을 돌렸지만 여전히 얇다
    imageModel.extractImageText.mockResolvedValue({
      inputTokens: 100,
      outputTokens: 10,
      text: `프란츠 시카 크림 ${"민감성 피부 보습 진정 ".repeat(15)}`,
    });
    const out = await readSiteProfileWithOutcome("example.test");
    expect(out.outcome).toBe("image_text_used");
    expect(out.methods).toEqual(["http_fallback", "image_text"]);
    expect(out.httpFallback).toBe(true);
  });
});
