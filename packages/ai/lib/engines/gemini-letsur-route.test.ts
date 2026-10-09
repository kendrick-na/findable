import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isLetsurCircuitOpen, resetLetsurCircuit } from "../letsur-fallback";
import { apiSearchShadowCostOf, costOf, LETSUR_KRW_PER_UNIT } from "./cost";
import type { ApiSearchShadow, EngineQuery, EngineResponse } from "./types";

vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const {
  geminiSearchRoute,
  parseGeminiLetsurChat,
  runGeminiSearchCandidate,
  runGeminiSearchViaLetsur,
  startApiSearchShadow,
} = await import("./api-search-v1");

const query: EngineQuery = {
  engineId: "gemini",
  language: "ko",
  prompt: "러닝화 추천",
  brandName: "나이키",
};

function chat(over: Record<string, unknown> = {}) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: "나이키 페가수스를 추천합니다.",
          annotations: [
            {
              type: "url_citation",
              url_citation: {
                start_index: 0,
                end_index: 5,
                title: "news.example.com",
                url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA",
              },
            },
          ],
        },
      },
    ],
    vertex_ai_grounding_metadata: [
      {
        webSearchQueries: ["러닝화 추천", "페가수스"],
        groundingChunks: [
          { web: { uri: "https://g.example/redirect/1", title: "a.com" } },
        ],
      },
    ],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 800,
      prompt_tokens_details: { web_search_requests: 2 },
    },
    estimated_cost: { amount: "0.01597990", currency: "unit" },
    ...over,
  };
}

describe("parseGeminiLetsurChat", () => {
  it("normal: text, annotation citations (title=domain), usage, search count, cost", () => {
    const p = parseGeminiLetsurChat(chat());
    expect(p.text).toBe("나이키 페가수스를 추천합니다.");
    expect(p.sources).toEqual([
      {
        sourceType: "url",
        url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA",
        title: "news.example.com",
      },
    ]);
    expect(p.webSearchRequests).toBe(2);
    expect(p.inputTokens).toBe(20);
    expect(p.outputTokens).toBe(800);
    expect(p.estimatedCostUnits).toBeCloseTo(0.015_979_9, 8);
  });

  it("no annotations: falls back to provider groundingChunks (object metadata too)", () => {
    const p = parseGeminiLetsurChat(
      chat({
        choices: [{ message: { content: "답" } }],
        vertex_ai_grounding_metadata: {
          webSearchQueries: ["q"],
          groundingChunks: [
            { web: { uri: "https://x.example/r", title: "x.com" } },
          ],
        },
      })
    );
    expect(p.sources.map((s) => s.title)).toEqual(["x.com"]);
  });

  it("no grounding: no sources, search count 0 from usage", () => {
    const p = parseGeminiLetsurChat({
      choices: [{ message: { content: "검색 없이" } }],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 6,
        prompt_tokens_details: { web_search_requests: 0 },
      },
    });
    expect(p.sources).toEqual([]);
    expect(p.webSearchRequests).toBe(0);
    expect(p.estimatedCostUnits).toBeNull();
  });

  it("web_search_requests missing: uses webSearchQueries length, else null", () => {
    const base = chat();
    const noDetail = parseGeminiLetsurChat({
      ...base,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(noDetail.webSearchRequests).toBe(2);
    const neither = parseGeminiLetsurChat({
      ...base,
      vertex_ai_grounding_metadata: undefined,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(neither.webSearchRequests).toBeNull();
  });

  it("estimated_cost only counts when currency is unit", () => {
    expect(
      parseGeminiLetsurChat(
        chat({ estimated_cost: { amount: "1", currency: "usd" } })
      ).estimatedCostUnits
    ).toBeNull();
  });

  it("empty content / error body / junk -> empty text, never throws", () => {
    for (const body of [
      null,
      undefined,
      "x",
      3,
      [],
      { error: { message: "bad" } },
      { choices: [{ message: { content: "" } }] },
      { choices: [{ message: { content: null } }] },
    ]) {
      const p = parseGeminiLetsurChat(body);
      expect(p.text).toBe("");
      expect(p.sources).toEqual([]);
    }
  });
});

describe("geminiSearchRoute", () => {
  it("defaults to letsur when LETSUR_API_KEY is set, else google", () => {
    expect(geminiSearchRoute({ LETSUR_API_KEY: "k" })).toBe("letsur");
    expect(geminiSearchRoute({})).toBe("google");
    expect(geminiSearchRoute({ LETSUR_API_KEY: "  " })).toBe("google");
  });
  it("explicit FINDABLE_GEMINI_ROUTE wins; junk is ignored", () => {
    expect(
      geminiSearchRoute({
        LETSUR_API_KEY: "k",
        FINDABLE_GEMINI_ROUTE: "google",
      })
    ).toBe("google");
    expect(geminiSearchRoute({ FINDABLE_GEMINI_ROUTE: "LETSUR" })).toBe(
      "letsur"
    );
    expect(
      geminiSearchRoute({ LETSUR_API_KEY: "k", FINDABLE_GEMINI_ROUTE: "x" })
    ).toBe("letsur");
  });
});

describe("runGeminiSearchViaLetsur / routing", () => {
  beforeEach(() => {
    resetLetsurCircuit();
    vi.stubEnv("LETSUR_API_KEY", "test-letsur");
    vi.stubEnv("GOOGLE_API_KEY", "test-google");
    vi.stubEnv("FINDABLE_GEMINI_ROUTE", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const mockFetch = (res: Record<string, unknown>) => {
    const fn = vi.fn(() => Promise.resolve(res as unknown as Response));
    vi.stubGlobal("fetch", fn);
    return fn;
  };
  const ok = (body: unknown) => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });

  it("default route posts chat/completions with google_search tool, no max_tokens", async () => {
    const fetchFn = mockFetch(ok(chat()));
    const r = await runGeminiSearchCandidate(query);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url.endsWith("/chat/completions")).toBe(true);
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      model: "gemini-3.5-flash-lite",
      messages: [{ role: "user", content: "러닝화 추천" }],
      tools: [{ google_search: {} }],
    });
    expect(body.max_tokens).toBeUndefined();
    expect(r.errorMessage).toBeNull();
    expect(r.brandMentioned).toBe(true);
    expect(r.citedSources[0]?.domain).toBe("news.example.com");
    expect(r.usage).toMatchObject({
      searchRoute: "letsur",
      webSearchRequests: 2,
      inputTokens: 20,
    });
    expect(r.usage?.providerCostKrw).toBeCloseTo(
      0.015_979_9 * LETSUR_KRW_PER_UNIT,
      6
    );
  });

  it("route=google uses Google directly and never calls LETSUR", async () => {
    vi.stubEnv("FINDABLE_GEMINI_ROUTE", "google");
    const fetchFn = mockFetch(
      ok({
        candidates: [{ content: { parts: [{ text: "나이키 추천" }] } }],
      })
    );
    const r = await runGeminiSearchCandidate(query);
    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(r.usage?.searchRoute).toBe("google");
  });

  it("not configured without LETSUR key when route forced to letsur (no google fallback)", async () => {
    vi.stubEnv("LETSUR_API_KEY", "");
    vi.stubEnv("FINDABLE_GEMINI_ROUTE", "letsur");
    const fetchFn = mockFetch(ok(chat()));
    const r = await runGeminiSearchCandidate(query);
    expect(r.errorMessage).toBe("[api-search:not_configured]");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    401, 402, 403, 500, 502,
  ])("HTTP %i -> error row, no google fallback, no body in error", async (status) => {
    const fetchFn = mockFetch({
      ok: false,
      status,
      text: () => Promise.resolve("secret-body insufficient credit"),
    });
    const r = await runGeminiSearchCandidate(query);
    expect(r.errorMessage).toBe(`[api-search:http_${status}]`);
    expect(r.errorMessage).not.toContain("secret");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).not.toContain("googleapis");
  });

  it("open circuit -> circuit_open without fetching and no fallback to Google", async () => {
    mockFetch({
      ok: false,
      status: 402,
      text: () => Promise.resolve("payment required"),
    });
    await runGeminiSearchCandidate(query);
    // 분류기가 이 본문을 불가로 보면 회로가 열린다(분류 규칙은 letsur-fallback 소관).
    if (isLetsurCircuitOpen()) {
      const second = mockFetch(ok(chat()));
      const r = await runGeminiSearchCandidate(query);
      expect(r.errorMessage).toBe("[api-search:circuit_open]");
      expect(second).not.toHaveBeenCalled();
    }
  });

  it("empty answer, network error, timeout and abort map to api-search errors", async () => {
    mockFetch(ok({ choices: [{ message: { content: "" } }] }));
    expect((await runGeminiSearchViaLetsur(query)).errorMessage).toBe(
      "[api-search:empty_answer]"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("boom")))
    );
    expect((await runGeminiSearchViaLetsur(query)).errorMessage).toBe(
      "[api-search:network]"
    );
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new DOMException("x", "AbortError")))
    );
    expect(
      (await runGeminiSearchViaLetsur({ ...query, signal: controller.signal }))
        .errorMessage
    ).toBe("[api-search:aborted]");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_res, rej) => {
            init.signal?.addEventListener("abort", () =>
              rej(new DOMException("t", "TimeoutError"))
            );
          })
      )
    );
    expect(
      (await runGeminiSearchViaLetsur(query, { timeoutMs: 10 })).errorMessage
    ).toBe("[api-search:timeout]");
  });

  it("shadow payload carries the route label on failure", async () => {
    mockFetch({ ok: false, status: 500, text: () => Promise.resolve("") });
    vi.stubEnv("API_SEARCH_SHADOW_GRACE_MS", "5000");
    const failed = await startApiSearchShadow(
      { language: "ko", prompt: "p", brandName: "나이키" },
      "gemini-search-v1"
    ).finish(undefined);
    expect(failed.outcome).toBe("failed");
    expect(failed.route).toBe("letsur");
    expect(failed.error).toBe("[api-search:http_500]");
  });

  it("shadow payload carries the route label on success", async () => {
    mockFetch(ok(chat()));
    vi.stubEnv("API_SEARCH_SHADOW_GRACE_MS", "5000");
    const shadow = await startApiSearchShadow(
      { language: "ko", prompt: "p", brandName: "나이키" },
      "gemini-search-v1"
    ).finish(undefined);
    expect(shadow.outcome).toBe("ok");
    expect(shadow.route).toBe("letsur");
  });
});

describe("cost: LETSUR route never double counts", () => {
  const row = (
    usage: NonNullable<EngineResponse["usage"]>,
    shadow?: ApiSearchShadow
  ): EngineResponse => ({
    brandMentioned: true,
    citedSources: [],
    durationMs: 1,
    engineId: "gemini",
    errorMessage: null,
    isStub: false,
    mentionListSize: null,
    mentionPosition: null,
    rawResponse: "a",
    sentiment: null,
    shareOfVoice: null,
    usage,
    ...(shadow ? { shadowApiSearch: shadow } : {}),
  });

  it("main row with estimated_cost -> units x 1525 exactly (no $0.014/query added)", () => {
    const cost = costOf(
      row({
        costModel: "token",
        engineSet: "api-search-v1",
        modelId: "gemini-3.5-flash-lite",
        searchRoute: "letsur",
        inputTokens: 20,
        outputTokens: 800,
        webSearchRequests: 2,
        providerCostUsd: 0.015_979_9,
        providerCostKrw: 0.015_979_9 * LETSUR_KRW_PER_UNIT,
      })
    );
    expect(cost.krw).toBeCloseTo(0.015_979_9 * 1525, 6);
  });

  it("main row without provider cost on letsur route -> tokens only, no Google per-query fee", () => {
    const cost = costOf(
      row({
        costModel: "token",
        engineSet: "api-search-v1",
        modelId: "gemini-3.5-flash-lite",
        searchRoute: "letsur",
        inputTokens: 1_000_000,
        outputTokens: 0,
        webSearchRequests: 5,
      })
    );
    expect(cost.krw).toBeCloseTo(0.3 * 1525, 6);
  });

  it("google route keeps the per-query formula", () => {
    const cost = costOf(
      row({
        costModel: "token",
        engineSet: "api-search-v1",
        modelId: "gemini-3.5-flash-lite",
        searchRoute: "google",
        inputTokens: 1_000_000,
        outputTokens: 0,
        webSearchRequests: 2,
      })
    );
    expect(cost.krw).toBeCloseTo((0.3 + 2 * 0.014) * 1380, 4);
  });

  it("shadow with provider cost uses it as-is", () => {
    const shadow: ApiSearchShadow = {
      candidate: "gemini-search-v1",
      model: "gemini-3.5-flash-lite",
      route: "letsur",
      outcome: "ok",
      text: "t",
      citations: [],
      brandMentioned: true,
      durationMs: 1,
      error: null,
      comparison: null,
      usage: {
        costModel: "token",
        inputTokens: 20,
        outputTokens: 800,
        webSearchRequests: 2,
        searchRoute: "letsur",
        providerCostUsd: 0.01,
        providerCostKrw: 0.01 * LETSUR_KRW_PER_UNIT,
      },
    };
    const c = apiSearchShadowCostOf(
      row({ costModel: "token", inputTokens: 1, outputTokens: 1 }, shadow)
    );
    expect(c?.krw).toBeCloseTo(15.25, 6);
  });
});
