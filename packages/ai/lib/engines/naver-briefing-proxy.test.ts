// NAVER_BRIEFING_PROXY(2026-10-07 CEO 결정) — 프록시 모드 env 파싱·기본값,
// 그리고 봇 확인 화면은 우회·재시도 없이 실패로 기록되는지 검사한다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRIEFING_FAIL_PREFIX } from "./briefing-failure";
import {
  DEFAULT_NAVER_BRIEFING_PROXY,
  detectNaverChallenge,
  naverBriefingAdapter,
  naverBriefingProxyMode,
} from "./naver-briefing-adapter";

const query = {
  engineId: "naver-briefing" as const,
  language: "ko" as const,
  prompt: "나이키 페가수스 후기",
  brandName: "나이키",
};

function htmlFetch(html: string) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: { rawHtml: html } }), {
      status: 200,
    })
  );
}

function sentProxy(fetchMock: ReturnType<typeof vi.fn>): unknown {
  const init = fetchMock.mock.calls[0]?.[1] as { body: string };
  return (JSON.parse(init.body) as { proxy?: unknown }).proxy;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("naverBriefingProxyMode", () => {
  it("defaults to auto (current production behaviour) when unset", () => {
    expect(DEFAULT_NAVER_BRIEFING_PROXY).toBe("auto");
    expect(naverBriefingProxyMode(undefined)).toBe("auto");
    expect(naverBriefingProxyMode("")).toBe("auto");
  });

  it("accepts basic and auto, case/space-insensitive", () => {
    expect(naverBriefingProxyMode("basic")).toBe("basic");
    expect(naverBriefingProxyMode(" BASIC ")).toBe("basic");
    expect(naverBriefingProxyMode("auto")).toBe("auto");
  });

  it("does not accept enhanced or typos (falls back to the default)", () => {
    expect(naverBriefingProxyMode("enhanced")).toBe("auto");
    expect(naverBriefingProxyMode("stealth")).toBe("auto");
    expect(naverBriefingProxyMode("basci")).toBe("auto");
  });
});

describe("naverBriefingAdapter proxy + challenge handling", () => {
  it("sends proxy=auto by default", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    vi.stubEnv("NAVER_BRIEFING_PROXY", "");
    const f = htmlFetch("<html><body>no briefing</body></html>");
    vi.stubGlobal("fetch", f);
    await naverBriefingAdapter(query);
    expect(sentProxy(f)).toBe("auto");
  });

  it("sends proxy=basic when NAVER_BRIEFING_PROXY=basic", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    vi.stubEnv("NAVER_BRIEFING_PROXY", "basic");
    const f = htmlFetch("<html><body>no briefing</body></html>");
    vi.stubGlobal("fetch", f);
    await naverBriefingAdapter(query);
    expect(sentProxy(f)).toBe("basic");
  });

  it("records a challenge page as a clean [봇확인] failure with exactly one request", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    vi.stubEnv("NAVER_BRIEFING_PROXY", "basic");
    const f = htmlFetch(
      "<html><body><div id='ncaptcha'>자동입력 방지를 위해 아래 문자를 입력해 주세요</div></body></html>"
    );
    vi.stubGlobal("fetch", f);
    const res = await naverBriefingAdapter(query);
    expect(f).toHaveBeenCalledTimes(1);
    expect(res.errorMessage?.startsWith(BRIEFING_FAIL_PREFIX.challenge)).toBe(
      true
    );
    expect(res.brandMentioned).toBe(false);
    expect(res.rawResponse).toBe("");
  });

  it("keeps a normal page without a briefing as 「미노출」, not a challenge", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    const f = htmlFetch("<html><body><div>일반 검색 결과</div></body></html>");
    vi.stubGlobal("fetch", f);
    const res = await naverBriefingAdapter(query);
    expect(res.errorMessage).toContain("AI 브리핑 미노출");
  });

  it("does not flag a page that has a briefing block even if a marker appears", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    const f = htmlFetch(
      `<html><body><div data-block-id="ai-briefing-1"><p>${"나이키 페가수스는 쿠션이 좋고 입문 러너에게 무난한 러닝화입니다. ".repeat(4)}</p></div><script>var x="ncaptcha";</script></body></html>`
    );
    vi.stubGlobal("fetch", f);
    const res = await naverBriefingAdapter(query);
    expect(res.errorMessage).toBeNull();
  });
});

describe("detectNaverChallenge", () => {
  it("matches common captcha / challenge markers", () => {
    expect(detectNaverChallenge("<div>자동입력 방지</div>")).toBe(true);
    expect(
      detectNaverChallenge(
        "<script src='https://challenges.cloudflare.com/x.js'></script>"
      )
    ).toBe(true);
    expect(detectNaverChallenge("<div>일반 검색 결과</div>")).toBe(false);
  });
});
