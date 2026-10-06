import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHATGPT_WEB_FAIL,
  isChatgptChallengePage,
  parseChatgptWebHtml,
  runChatgptWeb,
} from "./chatgpt-web-adapter";
import { costOf } from "./cost";

const ANSWER_HTML = `<html><body>
<div data-message-author-role="user"><p>러닝화 추천</p></div>
<div data-message-author-role="assistant"><div class="markdown">
<p>1. <strong>나이키</strong> 페가수스 — 입문용으로 좋아요.</p>
<p>2. 아식스 젤 — 쿠션이 좋아요. <a href="https://www.runnersworld.com/review?utm_source=chatgpt.com">Runner's World</a></p>
<a href="https://chatgpt.com/share/x">share</a>
<button>Copy</button>
</div></div></body></html>`;

const CHALLENGE_HTML =
  "<html><head><title>Just a moment...</title></head><body><script src='https://challenges.cloudflare.com/turnstile/v0/api.js'></script></body></html>";

const query = {
  engineId: "chatgpt-web" as const,
  language: "ko" as const,
  prompt: "러닝화 추천해줘",
  brandName: "나이키",
};

function okFetch(html: string, credits?: number) {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        data: {
          rawHtml: html,
          ...(credits === undefined
            ? {}
            : { metadata: { creditsUsed: credits } }),
        },
      }),
      { status: 200 }
    )
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("parseChatgptWebHtml", () => {
  it("takes the last assistant turn, keeps external citations, drops ChatGPT links and utm_source", () => {
    const parsed = parseChatgptWebHtml(ANSWER_HTML);
    expect(parsed?.text).toContain("나이키");
    expect(parsed?.text).not.toContain("Copy");
    expect(parsed?.links).toEqual([
      {
        url: "https://www.runnersworld.com/review",
        domain: "www.runnersworld.com",
        title: "Runner's World",
      },
    ]);
    expect(parsed?.streaming).toBe(false);
  });

  it("returns null when there is no assistant answer", () => {
    expect(parseChatgptWebHtml("<div>login</div>")).toBeNull();
  });

  it("flags a still-streaming answer", () => {
    const parsed = parseChatgptWebHtml(
      `${ANSWER_HTML}<button data-testid="stop-button"></button>`
    );
    expect(parsed?.streaming).toBe(true);
  });
});

describe("isChatgptChallengePage", () => {
  it("detects Cloudflare / Turnstile pages", () => {
    expect(isChatgptChallengePage(CHALLENGE_HTML)).toBe(true);
  });
  it("never calls a real answer a challenge", () => {
    expect(
      isChatgptChallengePage(`${ANSWER_HTML}<!-- cf-chl- leftover -->`)
    ).toBe(false);
  });
});

describe("runChatgptWeb", () => {
  it("is a stub (not a failure, no cost) without FIRECRAWL_API_KEY", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await runChatgptWeb(query);
    expect(res.isStub).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(costOf(res).krw).toBe(0);
  });

  it("asks logged-out chatgpt.com via Firecrawl actions with a basic proxy and no cache", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
    const fetchMock = okFetch(ANSWER_HTML);
    vi.stubGlobal("fetch", fetchMock);
    const res = await runChatgptWeb(query, { timeoutMs: 40_000 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(body.url).toBe("https://chatgpt.com/");
    // 🔴 우회 금지: stealth/enhanced 프록시를 쓰지 않는다.
    expect(body.proxy).toBe("basic");
    expect(body.maxAge).toBe(0);
    expect(body.storeInCache).toBe(false);
    expect(body.timeout).toBe(40_000);
    expect(body.location.country).toBe("KR");
    expect(body.actions.map((a: { type: string }) => a.type)).toEqual([
      "wait",
      "click",
      "write",
      "press",
      "wait",
      "executeJavascript",
    ]);
    expect(body.actions[2].text).toBe(query.prompt);

    expect(res.errorMessage).toBeNull();
    expect(res.brandMentioned).toBe(true);
    expect(res.mentionPosition).toBe(1);
    expect(res.citedSources).toHaveLength(1);
    expect(res.usage).toMatchObject({
      costModel: "credit",
      creditsUsed: 1,
      source: "web",
    });
  });

  it("uses Firecrawl's reported credits when present", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
    vi.stubGlobal("fetch", okFetch(ANSWER_HTML, 3));
    const res = await runChatgptWeb(query);
    expect(res.usage?.creditsUsed).toBe(3);
  });

  it("records a challenge as a clean, billed failure — never retries or escalates", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
    const fetchMock = okFetch(CHALLENGE_HTML);
    vi.stubGlobal("fetch", fetchMock);
    const res = await runChatgptWeb(query);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.errorMessage?.startsWith(CHATGPT_WEB_FAIL.challenge)).toBe(true);
    expect(res.brandMentioned).toBe(false);
    expect(res.usage?.creditsUsed).toBe(1);
    expect(costOf(res).krw).toBeGreaterThan(0);
  });

  it("does not use an answer that was still being generated", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
    vi.stubGlobal(
      "fetch",
      okFetch(`${ANSWER_HTML}<button data-testid="stop-button"></button>`)
    );
    const res = await runChatgptWeb(query);
    expect(res.errorMessage?.startsWith(CHATGPT_WEB_FAIL.incomplete)).toBe(
      true
    );
  });

  it.each([
    [402, CHATGPT_WEB_FAIL.credits],
    [401, CHATGPT_WEB_FAIL.auth],
    [429, CHATGPT_WEB_FAIL.rateLimit],
  ])("classifies Firecrawl HTTP %s without charging", async (status, prefix) => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status }))
    );
    const res = await runChatgptWeb(query);
    expect(res.errorMessage?.startsWith(prefix)).toBe(true);
    expect(res.usage?.creditsUsed).toBeUndefined();
  });

  it("reports a missing composer (challenge/login wall/UI change) as its own failure", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          '{"error":"Element not found for selector #prompt-textarea"}',
          {
            status: 500,
          }
        )
      )
    );
    const res = await runChatgptWeb(query);
    expect(res.errorMessage?.startsWith(CHATGPT_WEB_FAIL.composerMissing)).toBe(
      true
    );
  });

  it("stops at its own cap with a timeout failure instead of throwing", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
          })
      )
    );
    const res = await runChatgptWeb(query, { timeoutMs: 20 });
    expect(res.errorMessage?.startsWith(CHATGPT_WEB_FAIL.timeout)).toBe(true);
  });

  it("rethrows when the run deadline (parent signal) aborts", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
          })
      )
    );
    const pending = runChatgptWeb({ ...query, signal: controller.signal });
    controller.abort(new DOMException("deadline", "AbortError"));
    await expect(pending).rejects.toThrow("deadline");
  });
});
