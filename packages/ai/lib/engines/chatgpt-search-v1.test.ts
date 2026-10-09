import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLetsurCircuit, tripLetsurCircuit } from "../letsur-fallback";
import {
  apiSearchShadowAllowlist,
  isApiSearchShadowAllowed,
  isApiSearchShadowEnabled,
  parseGeminiGenerate,
  parseOpenAiResponses,
  runChatgptSearchCandidate,
  runGeminiSearchCandidate,
  startApiSearchShadow,
} from "./api-search-v1";
import type { EngineQuery, EngineResponse } from "./types";

vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const FIXTURE = {
  id: "resp_1",
  created_at: 1,
  output: [
    { type: "web_search_call", id: "ws_1", status: "completed" },
    { type: "web_search_call", id: "ws_2", status: "completed" },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: "라네즈는 추천 브랜드입니다.",
          annotations: [
            { type: "url_citation", url: "https://a.com/x", title: "A" },
            { type: "url_citation", url: "https://b.com/y", title: "B" },
            { type: "file_citation", url: "https://ignored.com" },
          ],
        },
      ],
    },
  ],
  usage: { input_tokens: 1000, output_tokens: 200 },
  estimated_cost: { amount: "0.00283029", currency: "unit" },
  tool_usage: {},
};

describe("parseOpenAiResponses", () => {
  it("reads text, url_citations, search call count, tokens and estimated cost", () => {
    const parsed = parseOpenAiResponses(FIXTURE);
    expect(parsed.text).toBe("라네즈는 추천 브랜드입니다.");
    expect(parsed.sources.map((s) => s.url)).toEqual([
      "https://a.com/x",
      "https://b.com/y",
    ]);
    expect(parsed.webSearchRequests).toBe(2);
    expect(parsed.inputTokens).toBe(1000);
    expect(parsed.outputTokens).toBe(200);
    expect(parsed.estimatedCostUnits).toBeCloseTo(0.002_830_29, 8);
  });

  it("does not fall back to body URLs when there are no citations", () => {
    const parsed = parseOpenAiResponses({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "see https://x.com/page" }],
        },
      ],
    });
    expect(parsed.sources).toEqual([]);
    expect(parsed.webSearchRequests).toBe(0);
  });

  it("returns null (not 0) for the search count when citations exist without call records", () => {
    const parsed = parseOpenAiResponses({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "x",
              annotations: [{ type: "url_citation", url: "https://a.com" }],
            },
          ],
        },
      ],
    });
    expect(parsed.webSearchRequests).toBeNull();
  });

  it("is safe on malformed bodies", () => {
    for (const body of [null, undefined, "x", 3, [], { output: "no" }]) {
      const parsed = parseOpenAiResponses(body);
      expect(parsed.text).toBe("");
      expect(parsed.sources).toEqual([]);
      expect(parsed.webSearchRequests).toBeNull();
      expect(parsed.estimatedCostUnits).toBeNull();
    }
  });

  it("ignores a cost that is not in LETSUR units or not numeric", () => {
    expect(
      parseOpenAiResponses({ estimated_cost: { amount: "1", currency: "usd" } })
        .estimatedCostUnits
    ).toBeNull();
    expect(
      parseOpenAiResponses({
        estimated_cost: { amount: "abc", currency: "unit" },
      }).estimatedCostUnits
    ).toBeNull();
  });
});

describe("parseGeminiGenerate", () => {
  const body = {
    candidates: [
      {
        content: {
          parts: [{ text: "thinking", thought: true }, { text: "답변 본문" }],
        },
        groundingMetadata: {
          webSearchQueries: ["q1", "q2", "q3"],
          groundingChunks: [
            {
              web: {
                uri: "https://vertexaisearch.cloud.google.com/r/1",
                title: "sulwhasoo.com",
              },
            },
          ],
        },
      },
    ],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 50,
      thoughtsTokenCount: 25,
    },
  };

  it("reads answer without thoughts, queries, sources and tokens (candidates + thoughts)", () => {
    const parsed = parseGeminiGenerate(body);
    expect(parsed.text).toBe("답변 본문");
    expect(parsed.webSearchRequests).toBe(3);
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.inputTokens).toBe(100);
    expect(parsed.outputTokens).toBe(75);
  });

  it("returns null search count when grounding metadata is missing and is safe on junk", () => {
    expect(
      parseGeminiGenerate({
        candidates: [{ content: { parts: [{ text: "a" }] } }],
      }).webSearchRequests
    ).toBeNull();
    expect(parseGeminiGenerate(null).text).toBe("");
  });
});

const query = (over: Partial<EngineQuery> = {}): EngineQuery => ({
  brandName: "라네즈",
  brandVariants: ["라네즈", "Laneige"],
  engineId: "chatgpt",
  language: "ko",
  prompt: "수분크림 추천",
  ...over,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("runChatgptSearchCandidate", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("LETSUR_API_KEY", "test-key-value");
    resetLetsurCircuit();
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetLetsurCircuit();
  });

  it("omits instructions when FINDABLE_CHATGPT_SEARCH_INSTRUCTIONS=off and overrides when set", async () => {
    fetchMock.mockResolvedValue(jsonResponse(FIXTURE));
    vi.stubEnv("FINDABLE_CHATGPT_SEARCH_INSTRUCTIONS", "off");
    await runChatgptSearchCandidate(query());
    const [, offInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(offInit.body))).not.toHaveProperty("instructions");
    vi.stubEnv("FINDABLE_CHATGPT_SEARCH_INSTRUCTIONS", "짧게 답해");
    await runChatgptSearchCandidate(query());
    const [, setInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(setInit.body)).instructions).toBe("짧게 답해");
  });

  it("posts the responses body with web_search + KR location and maps the result", async () => {
    fetchMock.mockResolvedValue(jsonResponse(FIXTURE));
    const res = await runChatgptSearchCandidate(query());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://gw.letsur.ai/v1/responses");
    expect(JSON.parse(String(init.body))).toEqual({
      model: "gpt-6-luna",
      input: "수분크림 추천",
      instructions: expect.stringContaining("3~5개"),
      tools: [
        {
          type: "web_search",
          user_location: { type: "approximate", country: "KR" },
        },
      ],
    });
    expect(res.errorMessage).toBeNull();
    expect(res.brandMentioned).toBe(true);
    expect(res.citedSources.map((c) => c.url)).toEqual([
      "https://a.com/x",
      "https://b.com/y",
    ]);
    expect(res.usage).toMatchObject({
      modelId: "gpt-6-luna",
      webSearchRequests: 2,
      providerCostUsd: expect.closeTo(0.002_830_29, 8),
      providerCostKrw: expect.closeTo(0.002_830_29 * 1525, 6),
    });
  });

  it("uses US location for English prompts and the model env override", async () => {
    vi.stubEnv("FINDABLE_LETSUR_MODEL_CHATGPT_SEARCH", "gpt-6-test");
    fetchMock.mockResolvedValue(jsonResponse(FIXTURE));
    await runChatgptSearchCandidate(query({ language: "en" }));
    const body = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body)
    );
    expect(body.model).toBe("gpt-6-test");
    expect(body.tools[0].user_location.country).toBe("US");
  });

  it("reports an empty answer as an error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output: [] }));
    const res = await runChatgptSearchCandidate(query());
    expect(res.errorMessage).toBe("[api-search:empty_answer]");
  });

  it("reports HTTP errors without leaking the body, and trips the circuit on credit exhaustion", async () => {
    fetchMock.mockResolvedValue(new Response("secret body", { status: 402 }));
    const res = await runChatgptSearchCandidate(query());
    expect(res.errorMessage).toBe("[api-search:http_402]");
    expect(res.errorMessage).not.toContain("secret");
    fetchMock.mockClear();
    const again = await runChatgptSearchCandidate(query());
    expect(again.errorMessage).toBe("[api-search:circuit_open]");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call fetch when the circuit is already open", async () => {
    tripLetsurCircuit("credit", "test");
    const res = await runChatgptSearchCandidate(query());
    expect(res.errorMessage).toBe("[api-search:circuit_open]");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns not_configured without a key", async () => {
    vi.stubEnv("LETSUR_API_KEY", "");
    const res = await runChatgptSearchCandidate(query());
    expect(res.errorMessage).toBe("[api-search:not_configured]");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("times out on a hanging request", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason)
          );
        })
    );
    const res = await runChatgptSearchCandidate(query(), { timeoutMs: 20 });
    expect(res.errorMessage).toBe("[api-search:timeout]");
  });
});

describe("runGeminiSearchCandidate", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GOOGLE_API_KEY", "test-google-key");
    // grounding flag must not matter — the candidate is always grounded.
    vi.stubEnv("FINDABLE_ENGINE_GROUNDING", "");
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("always attaches google_search and uses the dedicated model env (not FINDABLE_GEMINI_MODEL)", async () => {
    vi.stubEnv("FINDABLE_GEMINI_MODEL", "gemini-2.5-flash");
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: "라네즈 추천" }] },
            groundingMetadata: {
              webSearchQueries: ["a", "b"],
              groundingChunks: [],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      })
    );
    const res = await runGeminiSearchCandidate(query({ engineId: "gemini" }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-3.5-flash-lite:generateContent");
    expect(JSON.parse(String(init.body)).tools).toEqual([
      { google_search: {} },
    ]);
    expect(res.usage).toMatchObject({
      modelId: "gemini-3.5-flash-lite",
      webSearchRequests: 2,
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it("maps HTTP errors", async () => {
    fetchMock.mockResolvedValue(new Response("x", { status: 429 }));
    const res = await runGeminiSearchCandidate(query({ engineId: "gemini" }));
    expect(res.errorMessage).toBe("[api-search:http_429]");
  });
});

describe("allowlist", () => {
  it("is off unless API_SEARCH_SHADOW is true/1", () => {
    expect(isApiSearchShadowEnabled({})).toBe(false);
    expect(isApiSearchShadowEnabled({ API_SEARCH_SHADOW: "false" })).toBe(
      false
    );
    expect(isApiSearchShadowEnabled({ API_SEARCH_SHADOW: "true" })).toBe(true);
    expect(isApiSearchShadowEnabled({ API_SEARCH_SHADOW: "1" })).toBe(true);
  });

  it("an empty list allows nobody; domains match regardless of www/scheme/case", () => {
    expect(isApiSearchShadowAllowed("a.com", {})).toBe(false);
    expect(
      isApiSearchShadowAllowed("a.com", { API_SEARCH_SHADOW_BRANDS: " , " })
    ).toBe(false);
    const env = {
      API_SEARCH_SHADOW_BRANDS: "https://www.Laneige.com/kr, brand-id-1  b.com",
    };
    expect(apiSearchShadowAllowlist(env)).toHaveLength(3);
    expect(isApiSearchShadowAllowed("laneige.com", env)).toBe(true);
    expect(isApiSearchShadowAllowed("WWW.b.com", env)).toBe(true);
    expect(isApiSearchShadowAllowed("c.com", env)).toBe(false);
    expect(isApiSearchShadowAllowed(undefined, env)).toBe(false);
  });
});

describe("startApiSearchShadow", () => {
  const main: EngineResponse = {
    brandMentioned: true,
    citedSources: [{ url: "https://a.com/x", domain: "a.com" }],
    durationMs: 1,
    engineId: "chatgpt",
    errorMessage: null,
    isStub: false,
    mentionListSize: null,
    mentionPosition: 1,
    rawResponse: "x",
    sentiment: null,
    shareOfVoice: null,
  };
  const base = { language: "ko" as const, prompt: "p" };
  afterEach(() => vi.unstubAllEnvs());

  it("attaches ok result with comparison and usage", async () => {
    const run = vi.fn().mockResolvedValue({
      ...main,
      brandMentioned: false,
      citedSources: [
        { url: "https://a.com/y", domain: "a.com" },
        { url: "https://b.com", domain: "b.com" },
      ],
      usage: {
        costModel: "token",
        inputTokens: 1,
        outputTokens: 2,
        modelId: "gpt-6-luna",
      },
    });
    vi.stubEnv("API_SEARCH_SHADOW_GRACE_MS", "50");
    const shadow = await startApiSearchShadow(
      base,
      "chatgpt-search-v1",
      run
    ).finish(main);
    expect(shadow.outcome).toBe("ok");
    expect(shadow.model).toBe("gpt-6-luna");
    expect(shadow.comparison).toEqual({
      mentionAgreement: false,
      citationOverlap: 0.5,
    });
    expect(shadow.usage?.modelId).toBe("gpt-6-luna");
  });

  it("is skipped (no usage) when the main batch finishes first", async () => {
    let seen: AbortSignal | undefined;
    const run = vi.fn(
      (q: EngineQuery) =>
        new Promise<EngineResponse>((resolve) => {
          seen = q.signal;
          q.signal?.addEventListener("abort", () =>
            resolve({ ...main, errorMessage: "[api-search:aborted]" })
          );
        })
    );
    const shadow = await startApiSearchShadow(
      base,
      "gemini-search-v1",
      run
    ).finish(main);
    expect(shadow.outcome).toBe("skipped_budget");
    expect(shadow.usage).toBeUndefined();
    expect(seen?.aborted).toBe(true);
  });

  it("never throws when the runner crashes", async () => {
    const run = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubEnv("API_SEARCH_SHADOW_GRACE_MS", "50");
    const shadow = await startApiSearchShadow(
      base,
      "chatgpt-search-v1",
      run
    ).finish(main);
    expect(shadow.outcome).toBe("failed");
    expect(shadow.comparison).toBeNull();
  });

  it("marks a failed run as failed with its error and no comparison", async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ ...main, errorMessage: "[api-search:http_500]" });
    vi.stubEnv("API_SEARCH_SHADOW_GRACE_MS", "50");
    const shadow = await startApiSearchShadow(
      base,
      "chatgpt-search-v1",
      run
    ).finish(main);
    expect(shadow).toMatchObject({
      outcome: "failed",
      error: "[api-search:http_500]",
      comparison: null,
    });
  });
});
