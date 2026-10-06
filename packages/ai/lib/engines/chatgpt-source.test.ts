import { log } from "@repo/observability/log";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineQuery, EngineResponse } from "./types";

vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const resp = (
  engineId: EngineQuery["engineId"],
  over: Partial<EngineResponse> = {}
): EngineResponse => ({
  brandMentioned: true,
  citedSources: [{ url: "https://a.com/x", domain: "a.com" }],
  durationMs: 10,
  engineId,
  errorMessage: null,
  isStub: false,
  mentionListSize: null,
  mentionPosition: 1,
  rawResponse: "answer",
  sentiment: null,
  shareOfVoice: null,
  ...over,
});

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  apiSearch: vi.fn(),
  web: vi.fn(),
}));

vi.mock("./global-adapters", () => ({
  chatgptAdapter: (q: EngineQuery) => mocks.api(q),
  chatgptApiSearchAdapter: (q: EngineQuery) => mocks.apiSearch(q),
  claudeAdapter: (q: EngineQuery) => Promise.resolve(resp(q.engineId)),
  geminiAdapter: (q: EngineQuery) => Promise.resolve(resp(q.engineId)),
  perplexityAdapter: (q: EngineQuery) => Promise.resolve(resp(q.engineId)),
}));
vi.mock("./chatgpt-web-adapter", () => ({
  chatgptWebAdapter: (q: EngineQuery) => mocks.web(q, {}),
  runChatgptWeb: (q: EngineQuery, o: { timeoutMs: number }) => mocks.web(q, o),
}));

const { queryAllEngines } = await import("./index");
const { auditCost } = await import("./cost");
const {
  CHATGPT_WEB_ENGINE_SET,
  chatgptEngineSetKey,
  citationOverlap,
  createChatgptRoutedAdapter,
  isChatgptWebShadowEnabled,
} = await import("./chatgpt-source");

const webOk = (over: Partial<EngineResponse> = {}) =>
  resp("chatgpt-web", {
    brandMentioned: false,
    citedSources: [
      { url: "https://a.com/y", domain: "a.com" },
      { url: "https://b.com", domain: "www.b.com" },
    ],
    rawResponse: "web answer",
    usage: {
      inputTokens: null,
      outputTokens: null,
      costModel: "credit",
      creditsUsed: 1,
      source: "web",
    },
    ...over,
  });

const webFail = (message: string, creditsUsed?: number) =>
  resp("chatgpt-web", {
    brandMentioned: false,
    citedSources: [],
    rawResponse: "",
    errorMessage: message,
    usage: {
      inputTokens: null,
      outputTokens: null,
      costModel: "credit",
      source: "web",
      ...(creditsUsed === undefined ? {} : { creditsUsed }),
    },
  });

const base = { prompt: "q", language: "ko" as const, brandName: "B" };

beforeEach(() => {
  mocks.api.mockReset();
  mocks.apiSearch.mockReset();
  mocks.web.mockReset();
  vi.mocked(log.info).mockClear();
  vi.mocked(log.warn).mockClear();
  mocks.api.mockImplementation((q: EngineQuery) =>
    Promise.resolve(resp(q.engineId))
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("flags default off — production unchanged", () => {
  it("CHATGPT_SOURCE unset → API adapter only, no web call, no shadow, no engine-set key", async () => {
    vi.stubEnv("CHATGPT_SOURCE", "");
    vi.stubEnv("CHATGPT_WEB_SHADOW", "");
    const [chatgpt] = await queryAllEngines(base, ["chatgpt"]);
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.web).not.toHaveBeenCalled();
    expect(chatgpt?.shadowChatgptWeb).toBeUndefined();
    expect(chatgpt?.usage?.source).toBeUndefined();
    expect(chatgptEngineSetKey()).toBeUndefined();
  });
});

describe("shadow (CHATGPT_WEB_SHADOW=true)", () => {
  beforeEach(() => {
    vi.stubEnv("CHATGPT_WEB_SHADOW", "true");
    vi.stubEnv("CHATGPT_SOURCE", "api");
  });

  it("stores the web answer + comparison next to the API answer without changing it", async () => {
    mocks.web.mockResolvedValue(webOk());
    const [chatgpt, claude] = await queryAllEngines(base, [
      "chatgpt",
      "claude",
    ]);
    // Main answer is byte-identical to what the API adapter returned.
    const { shadowChatgptWeb, ...main } = chatgpt as EngineResponse;
    expect(main).toEqual(resp("chatgpt"));
    expect(claude?.shadowChatgptWeb).toBeUndefined();
    expect(shadowChatgptWeb).toMatchObject({
      outcome: "ok",
      text: "web answer",
      brandMentioned: false,
      error: null,
      creditsUsed: 1,
      comparison: { mentionAgreement: false, citationOverlap: 0.5 },
    });
    // logged-out web run is asked as a separate engine, never with the main signal object
    expect(mocks.web.mock.calls[0]?.[0]?.engineId).toBe("chatgpt-web");
    expect(log.info).toHaveBeenCalledWith(
      "engine.chatgpt_web.shadow",
      expect.objectContaining({
        outcome: "ok",
        mentionAgreement: false,
        citationOverlap: 0.5,
      })
    );
  });

  it("never delays the batch: a slow shadow is cut when the main batch ends (grace 0)", async () => {
    let shadowSignal: AbortSignal | undefined;
    mocks.web.mockImplementation(
      (q: EngineQuery) =>
        new Promise((_, reject) => {
          shadowSignal = q.signal;
          q.signal?.addEventListener("abort", () =>
            reject(new DOMException("cut", "AbortError"))
          );
        })
    );
    const started = Date.now();
    const [chatgpt] = await queryAllEngines(base, ["chatgpt"]);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(chatgpt?.errorMessage).toBeNull();
    expect(chatgpt?.shadowChatgptWeb).toMatchObject({
      outcome: "skipped_budget",
      comparison: null,
      creditsUsed: 1,
    });
    expect(shadowSignal?.aborted).toBe(true);
  });

  it("waits for the shadow only within CHATGPT_WEB_SHADOW_GRACE_MS", async () => {
    vi.stubEnv("CHATGPT_WEB_SHADOW_GRACE_MS", "50");
    mocks.web.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(webOk()), 10))
    );
    const [chatgpt] = await queryAllEngines(base, ["chatgpt"]);
    expect(chatgpt?.shadowChatgptWeb?.outcome).toBe("ok");
  });

  it("a crashing shadow never fails or changes the main run", async () => {
    mocks.web.mockRejectedValue(new Error("boom"));
    const [chatgpt] = await queryAllEngines(base, ["chatgpt"]);
    expect(chatgpt?.errorMessage).toBeNull();
    expect(chatgpt?.brandMentioned).toBe(true);
    expect(chatgpt?.shadowChatgptWeb?.outcome).toBe("failed");
  });

  it("records a challenge as a failed shadow with no comparison", async () => {
    mocks.web.mockResolvedValue(webFail("[chatgpt-web:challenge] blocked", 1));
    const [chatgpt] = await queryAllEngines(base, ["chatgpt"]);
    expect(chatgpt?.shadowChatgptWeb).toMatchObject({
      outcome: "failed",
      error: "[chatgpt-web:challenge] blocked",
      comparison: null,
      creditsUsed: 1,
    });
    expect(log.info).toHaveBeenCalledWith(
      "engine.chatgpt_web.shadow",
      expect.objectContaining({ outcome: "failed", failure: "challenge" })
    );
  });

  it("does not run when chatgpt is not in the batch", async () => {
    await queryAllEngines(base, ["claude"]);
    expect(mocks.web).not.toHaveBeenCalled();
  });

  it("adds the shadow's Firecrawl cost as its own line in the audit cost", async () => {
    mocks.web.mockResolvedValue(webOk());
    const responses = await queryAllEngines(base, ["chatgpt"]);
    const withoutShadow = auditCost(
      responses.map(({ shadowChatgptWeb: _s, ...r }) => r)
    );
    const cost = auditCost(responses);
    expect(cost.shadowKrw).toBeGreaterThan(0);
    expect(cost.totalKrw).toBeCloseTo(
      withoutShadow.totalKrw + (cost.shadowKrw ?? 0)
    );
    // Shadow is not a measured engine.
    expect(cost.measuredEngines).toBe(withoutShadow.measuredEngines);
    expect(withoutShadow.shadowKrw).toBeUndefined();
  });

  it("is ignored when web is already the primary source", () => {
    vi.stubEnv("CHATGPT_SOURCE", "web");
    expect(isChatgptWebShadowEnabled()).toBe(false);
  });
});

describe("switch (CHATGPT_SOURCE=web)", () => {
  const deps = () => ({
    api: mocks.api,
    apiSearch: mocks.apiSearch,
    web: mocks.web,
  });
  beforeEach(() => {
    vi.stubEnv("CHATGPT_SOURCE", "web");
  });

  it("uses the web answer as the chatgpt engine answer", async () => {
    mocks.web.mockResolvedValue(webOk({ brandMentioned: true }));
    const res = await createChatgptRoutedAdapter(deps())({
      ...base,
      engineId: "chatgpt",
    });
    expect(res.engineId).toBe("chatgpt");
    expect(res.rawResponse).toBe("web answer");
    expect(res.usage).toMatchObject({
      source: "web",
      chatgptEngineSet: CHATGPT_WEB_ENGINE_SET,
      costModel: "credit",
      creditsUsed: 1,
    });
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.apiSearch).not.toHaveBeenCalled();
    expect(chatgptEngineSetKey()).toBe(CHATGPT_WEB_ENGINE_SET);
  });

  it("falls back to API + web search on failure and marks usage.source=api_fallback", async () => {
    mocks.web.mockResolvedValue(webFail("[chatgpt-web:challenge] x", 1));
    mocks.apiSearch.mockResolvedValue(
      resp("chatgpt", {
        usage: {
          inputTokens: 1000,
          outputTokens: 200,
          costModel: "token",
          webSearchRequests: 1,
        },
      })
    );
    const res = await createChatgptRoutedAdapter(deps())({
      ...base,
      engineId: "chatgpt",
    });
    expect(mocks.apiSearch).toHaveBeenCalledTimes(1);
    expect(mocks.api).not.toHaveBeenCalled();
    expect(res.usage).toMatchObject({
      source: "api_fallback",
      chatgptEngineSet: CHATGPT_WEB_ENGINE_SET,
      webSearchRequests: 1,
      priorAttemptCreditsUsed: 1,
    });
    expect(log.warn).toHaveBeenCalledWith(
      "engine.chatgpt_web.primary",
      expect.objectContaining({
        outcome: "api_fallback",
        webFailure: "challenge",
      })
    );
  });

  it("falls back when web collection is not configured (stub)", async () => {
    mocks.web.mockResolvedValue(
      resp("chatgpt-web", { isStub: true, errorMessage: null })
    );
    mocks.apiSearch.mockResolvedValue(resp("chatgpt"));
    const res = await createChatgptRoutedAdapter(deps())({
      ...base,
      engineId: "chatgpt",
    });
    expect(res.usage?.source).toBe("api_fallback");
    expect(res.usage?.priorAttemptCreditsUsed).toBeUndefined();
  });

  it("gives the web attempt a primary budget below the 60s engine cap", async () => {
    vi.stubEnv("CHATGPT_WEB_PRIMARY_TIMEOUT_MS", "");
    mocks.web.mockResolvedValue(webOk());
    await createChatgptRoutedAdapter(deps())({ ...base, engineId: "chatgpt" });
    expect(mocks.web.mock.calls[0]?.[1]).toEqual({ timeoutMs: 30_000 });
  });
});

describe("citationOverlap", () => {
  it("is null when neither side has sources (not 0%)", () => {
    expect(citationOverlap({ citedSources: [] }, { citedSources: [] })).toBe(
      null
    );
  });
  it("normalises www. and case", () => {
    expect(
      citationOverlap(
        { citedSources: [{ domain: "WWW.A.com" }] },
        { citedSources: [{ domain: "a.com" }] }
      )
    ).toBe(1);
  });
});
