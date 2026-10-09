import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLetsurCircuit, tripLetsurCircuit } from "../letsur-fallback";
import type { EngineQuery, EngineResponse } from "./types";

vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const legacy = vi.hoisted(() => ({ calls: [] as string[] }));
const mocks = vi.hoisted(() => ({ shadow: vi.fn() }));

const legacyRow = (engineId: EngineQuery["engineId"]): EngineResponse => {
  legacy.calls.push(engineId);
  return {
    brandMentioned: false,
    citedSources: [],
    durationMs: 1,
    engineId,
    errorMessage: null,
    isStub: false,
    mentionListSize: null,
    mentionPosition: null,
    rawResponse: "legacy answer",
    sentiment: null,
    shareOfVoice: null,
  };
};

vi.mock("./global-adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./global-adapters")>();
  return {
    ...actual,
    chatgptAdapter: (q: EngineQuery) => Promise.resolve(legacyRow(q.engineId)),
    chatgptApiSearchAdapter: (q: EngineQuery) =>
      Promise.resolve(legacyRow(q.engineId)),
    claudeAdapter: (q: EngineQuery) => Promise.resolve(legacyRow(q.engineId)),
    geminiAdapter: (q: EngineQuery) => Promise.resolve(legacyRow(q.engineId)),
    perplexityAdapter: (q: EngineQuery) =>
      Promise.resolve(legacyRow(q.engineId)),
  };
});
vi.mock("./api-search-v1", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api-search-v1")>();
  return { ...actual, startApiSearchShadow: mocks.shadow };
});

const { queryAllEngines, queryEngine } = await import("./index");
const { aggregateAudit, auditCost, costOf, LETSUR_KRW_PER_UNIT } = await import(
  "./index"
);
const { chatgptEngineSetKey, isChatgptWebShadowEnabled } = await import(
  "./chatgpt-source"
);

const base = {
  language: "ko" as const,
  prompt: "러닝화 추천",
  brandName: "나이키",
  brandDomain: "nike.com",
};

const OPENAI_BODY = {
  output: [
    { type: "web_search_call" },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: "나이키 페가수스가 대표적입니다.",
          annotations: [
            {
              type: "url_citation",
              url: "https://news.example.com/a",
              title: "뉴스",
            },
          ],
        },
      ],
    },
  ],
  usage: { input_tokens: 800, output_tokens: 600 },
  estimated_cost: { amount: "0.004", currency: "unit" },
};

const GEMINI_BODY = {
  candidates: [
    {
      content: { parts: [{ text: "나이키와 아디다스를 추천해요." }] },
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://shop.example.com/x", title: "쇼핑" } },
        ],
        webSearchQueries: ["러닝화", "러닝화 추천"],
      },
    },
  ],
  usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 },
};

const CLAUDE_BODY = {
  stop_reason: "end_turn",
  content: [
    { type: "server_tool_use", name: "web_search", input: {} },
    {
      type: "text",
      text: "나이키 페가수스를 추천합니다.",
      citations: [{ url: "https://blog.example.com/b", title: "블로그" }],
    },
  ],
  usage: {
    input_tokens: 10_000,
    output_tokens: 1000,
    server_tool_use: { web_search_requests: 1 },
  },
};

function bodyFor(url: string): unknown {
  if (url.includes("/responses")) {
    return OPENAI_BODY;
  }
  if (url.includes("generativelanguage")) {
    return GEMINI_BODY;
  }
  return CLAUDE_BODY;
}

function fakeFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) =>
    Promise.resolve(new Response(JSON.stringify(bodyFor(url)), { status: 200 }))
  );
}

describe("FINDABLE_ENGINE_SET=api-search-v1 main routing", () => {
  beforeEach(() => {
    legacy.calls.length = 0;
    mocks.shadow.mockReset();
    resetLetsurCircuit();
    vi.stubEnv("LETSUR_API_KEY", "test-letsur");
    vi.stubEnv("GOOGLE_API_KEY_SEARCH", "test-google");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("flag unset -> legacy adapters run, fetch is never touched, no engineSet marker", async () => {
    const fetchMock = fakeFetch();
    vi.stubGlobal("fetch", fetchMock);
    const rows = await queryAllEngines(base, ["chatgpt", "gemini", "claude"]);
    expect(legacy.calls.sort()).toEqual(["chatgpt", "claude", "gemini"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rows.every((r) => r.usage === undefined)).toBe(true);
  });

  it("another flag value -> still legacy", async () => {
    vi.stubEnv("FINDABLE_ENGINE_SET", "something-else");
    const fetchMock = fakeFetch();
    vi.stubGlobal("fetch", fetchMock);
    await queryEngine({ ...base, engineId: "chatgpt" });
    expect(legacy.calls).toEqual(["chatgpt"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flag on -> chatgpt/gemini/claude call the candidate paths and return scored rows with citations, usage and marker", async () => {
    vi.stubEnv("FINDABLE_ENGINE_SET", "api-search-v1");
    const fetchMock = fakeFetch();
    vi.stubGlobal("fetch", fetchMock);
    const rows = await queryAllEngines(base, ["chatgpt", "gemini", "claude"]);
    expect(legacy.calls).toEqual([]);
    const byId = Object.fromEntries(rows.map((r) => [r.engineId, r]));
    for (const id of ["chatgpt", "gemini", "claude"]) {
      expect(byId[id].errorMessage).toBeNull();
      expect(byId[id].usage?.engineSet).toBe("api-search-v1");
      expect(byId[id].usage?.costModel).toBe("token");
      expect(byId[id].citedSources.length).toBe(1);
    }
    expect(byId.chatgpt.usage?.modelId).toBe("gpt-6-luna");
    expect(byId.gemini.usage?.modelId).toBe("gemini-3.5-flash-lite");
    expect(byId.claude.usage?.modelId).toBe("claude-sonnet-5-5");
    expect(byId.chatgpt.brandMentioned).toBe(true);
    expect(byId.gemini.brandMentioned).toBe(true);
  });

  it("flag on -> the shadow candidates never start (no duplicate cost)", async () => {
    vi.stubEnv("FINDABLE_ENGINE_SET", "api-search-v1");
    vi.stubEnv("API_SEARCH_SHADOW", "true");
    vi.stubEnv("API_SEARCH_SHADOW_BRANDS", "nike.com");
    vi.stubGlobal("fetch", fakeFetch());
    const rows = await queryAllEngines(base, ["chatgpt", "gemini", "claude"]);
    expect(mocks.shadow).not.toHaveBeenCalled();
    expect(rows.every((r) => r.shadowApiSearch === undefined)).toBe(true);
  });

  it("flag on -> perplexity/naver are untouched (legacy path)", async () => {
    vi.stubEnv("FINDABLE_ENGINE_SET", "api-search-v1");
    vi.stubGlobal("fetch", fakeFetch());
    const [row] = await queryAllEngines(base, ["perplexity"]);
    expect(legacy.calls).toEqual(["perplexity"]);
    expect(row?.usage).toBeUndefined();
  });

  it("flag on + provider failure -> error row with marker, no silent fallback to the old model", async () => {
    vi.stubEnv("FINDABLE_ENGINE_SET", "api-search-v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 500 })))
    );
    const row = await queryEngine({ ...base, engineId: "gemini" });
    expect(row.errorMessage).toBe("[api-search:http_500]");
    expect(row.usage?.engineSet).toBe("api-search-v1");
    expect(legacy.calls).toEqual([]);
    expect(costOf(row).krw).toBe(0);
  });

  it("flag on + missing key -> not_configured error row (no stub, no legacy)", async () => {
    vi.stubEnv("FINDABLE_ENGINE_SET", "api-search-v1");
    vi.stubEnv("LETSUR_API_KEY", "");
    vi.stubGlobal("fetch", fakeFetch());
    const row = await queryEngine({ ...base, engineId: "chatgpt" });
    expect(row.errorMessage).toBe("[api-search:not_configured]");
    expect(legacy.calls).toEqual([]);
  });

  it("flag on + LETSUR circuit open -> circuit_open error row, fetch not called", async () => {
    vi.stubEnv("FINDABLE_ENGINE_SET", "api-search-v1");
    const fetchMock = fakeFetch();
    vi.stubGlobal("fetch", fetchMock);
    tripLetsurCircuit("quota", "test");
    const row = await queryEngine({ ...base, engineId: "claude" });
    expect(row.errorMessage).toBe("[api-search:circuit_open]");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("chatgptEngineSetKey() stays undefined and the web shadow stays off while the set is active", () => {
    vi.stubEnv("CHATGPT_SOURCE", "web");
    vi.stubEnv("CHATGPT_WEB_SHADOW", "true");
    expect(chatgptEngineSetKey()).toBe("chatgpt-web-v1");
    vi.stubEnv("FINDABLE_ENGINE_SET", "api-search-v1");
    expect(chatgptEngineSetKey()).toBeUndefined();
    vi.stubEnv("CHATGPT_SOURCE", "api");
    expect(isChatgptWebShadowEnabled()).toBe(false);
  });
});

describe("api-search-v1 main rows — cost", () => {
  beforeEach(() => {
    resetLetsurCircuit();
    vi.stubEnv("LETSUR_API_KEY", "test-letsur");
    vi.stubEnv("GOOGLE_API_KEY_SEARCH", "test-google");
    vi.stubEnv("FINDABLE_ENGINE_SET", "api-search-v1");
    vi.stubGlobal("fetch", fakeFetch());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("chatgpt: provider-reported units x 1,525 KRW (not the 1,380 list rate)", async () => {
    const row = await queryEngine({ ...base, engineId: "chatgpt" });
    expect(row.usage?.providerCostKrw).toBeCloseTo(0.004 * LETSUR_KRW_PER_UNIT);
    const cost = costOf(row);
    expect(cost.basis).toBe("token");
    expect(cost.krw).toBeCloseTo(6.1, 5);
  });

  it("gemini: tokens (flash-lite $0.30/$2.50) + $0.014 per grounded query, no free quota assumed", async () => {
    const row = await queryEngine({ ...base, engineId: "gemini" });
    const cost = costOf(row);
    expect(cost.basis).toBe("token");
    const usd = (1000 / 1e6) * 0.3 + (500 / 1e6) * 2.5 + 2 * 0.014;
    expect(cost.krw).toBeCloseTo(usd * 1380, 5);
    expect(cost.krw).toBeGreaterThan(0);
  });

  it("claude: no estimated_cost -> candidate token table x 1,525 (never the sonnet-4.6 rate)", async () => {
    const row = await queryEngine({ ...base, engineId: "claude" });
    const cost = costOf(row);
    expect(cost.basis).toBe("token");
    const usd = (10_000 / 1e6) * 2 + (1000 / 1e6) * 10;
    expect(cost.krw).toBeCloseTo(usd * LETSUR_KRW_PER_UNIT, 5);
  });

  it("unknown stays unknown: tokens missing -> basis unknown, 0 KRW", () => {
    const row: EngineResponse = {
      ...legacyRow("gemini"),
      usage: {
        costModel: "token",
        engineSet: "api-search-v1",
        inputTokens: null,
        outputTokens: null,
        modelId: "gemini-3.5-flash-lite",
      },
    };
    expect(costOf(row)).toMatchObject({ basis: "unknown", krw: 0 });
  });

  it("an unregistered model is unknown, not borrowed from the old engine price", () => {
    const row: EngineResponse = {
      ...legacyRow("claude"),
      usage: {
        costModel: "token",
        engineSet: "api-search-v1",
        inputTokens: 1000,
        outputTokens: 1000,
        modelId: "claude-future-x",
      },
    };
    expect(costOf(row)).toMatchObject({ basis: "unknown", krw: 0 });
  });

  it("rows without the marker keep the old price table (gemini free tier stays free)", () => {
    const row: EngineResponse = {
      ...legacyRow("gemini"),
      usage: { costModel: "free", inputTokens: 1, outputTokens: 1 },
    };
    expect(costOf(row)).toMatchObject({ basis: "free", krw: 0 });
  });
});

describe("aggregate / verdict path accepts candidate-style main rows", () => {
  beforeEach(() => {
    resetLetsurCircuit();
    vi.stubEnv("LETSUR_API_KEY", "test-letsur");
    vi.stubEnv("GOOGLE_API_KEY_SEARCH", "test-google");
    vi.stubEnv("FINDABLE_ENGINE_SET", "api-search-v1");
    vi.stubGlobal("fetch", fakeFetch());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("aggregateAudit and auditCost work on the new rows (citations counted, cost summed)", async () => {
    const rows = await queryAllEngines(base, ["chatgpt", "gemini", "claude"]);
    const metrics = aggregateAudit(rows, "nike.com");
    // 3 candidate rows, 1 third-party citation each (none on nike.com) -> all unattributed.
    expect(metrics.unattributedCitationCount).toBe(3);
    const cost = auditCost(rows);
    expect(cost.measuredEngines).toBe(3);
    expect(cost.totalKrw).toBeGreaterThan(0);
    expect(cost.apiSearchShadow).toBeUndefined();
  });
});
