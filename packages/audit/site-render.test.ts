import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ enabled: false, getBrowser: vi.fn() }));
vi.mock("./keys", () => ({ keys: () => ({ SITE_RENDER_ENABLED: h.enabled }) }));
vi.mock("./pdf-generator", () => ({ getBrowser: h.getBrowser }));
vi.mock("@repo/observability/log", () => ({
  log: { warn: vi.fn(), info: vi.fn() },
}));

import {
  isBlockedRequestUrl,
  isSiteRenderEnabled,
  renderSiteHtml,
  siteRenderStatus,
} from "./site-render";

beforeEach(() => {
  h.enabled = false;
  h.getBrowser.mockReset();
});

describe("isSiteRenderEnabled — 기본 off, Preview 에서는 항상 off", () => {
  it("플래그가 꺼져 있으면 off", () => {
    expect(isSiteRenderEnabled({})).toBe(false);
  });
  it("켜져 있으면 on", () => {
    h.enabled = true;
    expect(isSiteRenderEnabled({})).toBe(true);
  });
  it("켜져 있어도 Vercel Preview 에서는 off", () => {
    h.enabled = true;
    expect(isSiteRenderEnabled({ VERCEL_ENV: "preview" })).toBe(false);
  });
});

describe("siteRenderStatus — 로컬·운영 설정 불일치를 로그로 드러낸다", () => {
  it("플래그 없음 → flag_off, 켜짐 → enabled, 켜져 있어도 Preview → vercel_preview", () => {
    expect(siteRenderStatus({})).toBe("flag_off");
    h.enabled = true;
    expect(siteRenderStatus({})).toBe("enabled");
    expect(siteRenderStatus({ VERCEL_ENV: "preview" })).toBe("vercel_preview");
  });
});

describe("renderSiteHtml", () => {
  it("꺼져 있으면 브라우저를 띄우지 않고 null", async () => {
    expect(await renderSiteHtml("kakaopay.com")).toBeNull();
    expect(h.getBrowser).not.toHaveBeenCalled();
  });

  it("브라우저 실행이 실패해도 던지지 않는다(null)", async () => {
    h.enabled = true;
    h.getBrowser.mockRejectedValue(new Error("no chrome"));
    expect(await renderSiteHtml("example.com")).toBeNull();
  });

  it("사설 주소 도메인은 브라우저에 가기 전에 막는다", async () => {
    h.enabled = true;
    expect(await renderSiteHtml("http://127.0.0.1")).toBeNull();
    expect(h.getBrowser).not.toHaveBeenCalled();
  });

  it("정상이면 그린 HTML 을 돌려주고 브라우저를 닫는다", async () => {
    h.enabled = true;
    const close = vi.fn().mockResolvedValue(undefined);
    const page = {
      setUserAgent: vi.fn(),
      setViewport: vi.fn(),
      setRequestInterception: vi.fn(),
      on: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue("<html><h1>그려진 글</h1></html>"),
    };
    h.getBrowser.mockResolvedValue({ newPage: async () => page, close });
    expect(await renderSiteHtml("example.com")).toContain("그려진 글");
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("isBlockedRequestUrl — 브라우저가 내부망을 찌르지 못하게", () => {
  it.each([
    "http://localhost:3000/x",
    "http://127.0.0.1/",
    "http://10.0.0.5/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://192.168.0.1/",
    "http://[::1]/",
    "file:///etc/passwd",
    "ftp://example.com/x",
  ])("막는다: %s", (url) => {
    expect(isBlockedRequestUrl(url)).toBe(true);
  });
  it.each([
    "https://kakaopay.com/",
    "https://cdn.example.com/app.js",
    "data:text/plain,hi",
  ])("통과: %s", (url) => {
    expect(isBlockedRequestUrl(url)).toBe(false);
  });
});
