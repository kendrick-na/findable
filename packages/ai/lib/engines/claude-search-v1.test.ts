import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLetsurCircuit } from "../letsur-fallback";
import { apiSearchShadowCostOf, auditCost, LETSUR_KRW_PER_UNIT } from "./cost";
import type { EngineQuery, EngineResponse } from "./types";

vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const {
  claudeSearchMaxTokens,
  claudeSearchModel,
  parseClaudeSearchMessages,
  runClaudeSearchCandidate,
  startApiSearchShadow,
} = await import("./api-search-v1");
const { claudeSearchRequestBody } = await import("./global-adapters");

const query: EngineQuery = {
  engineId: "claude",
  language: "ko",
  prompt: "러닝화 추천",
  brandName: "나이키",
};

function messages(over: Record<string, unknown> = {}) {
  return {
    stop_reason: "end_turn",
    content: [
      { type: "server_tool_use", name: "web_search", input: {} },
      {
        type: "web_search_tool_result",
        content: [{ url: "https://cand.example.com", title: "후보" }],
      },
      {
        type: "text",
        text: "나이키 페가수스를 추천합니다.",
        citations: [{ url: "https://news.example.com/a", title: "News" }],
      },
    ],
    usage: {
      input_tokens: 10_000,
      output_tokens: 1000,
      server_tool_use: { web_search_requests: 1 },
    },
    ...over,
  };
}

describe("parseClaudeSearchMessages", () => {
  it("normal answer: text, citations only from text blocks, usage, not truncated", () => {
    const p = parseClaudeSearchMessages(messages());
    expect(p.text).toBe("나이키 페가수스를 추천합니다.");
    expect(p.sources.map((s) => s.url)).toEqual(["https://news.example.com/a"]);
    expect(p.stopReason).toBe("end_turn");
    expect(p.truncated).toBe(false);
    expect(p.inputTokens).toBe(10_000);
    expect(p.outputTokens).toBe(1000);
    expect(p.webSearchRequests).toBe(1);
    expect(p.estimatedCostUnits).toBeNull();
  });

  it("max_tokens stop_reason sets truncated true even with non-empty text", () => {
    const p = parseClaudeSearchMessages(
      messages({ stop_reason: "max_tokens" })
    );
    expect(p.truncated).toBe(true);
    expect(p.text.length).toBeGreaterThan(0);
  });

  it("no web search: zero server_tool_use blocks counts 0 when usage lacks it", () => {
    const p = parseClaudeSearchMessages({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "검색 없이 답" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(p.webSearchRequests).toBe(0);
    expect(p.sources).toEqual([]);
  });

  it("counts server_tool_use blocks when usage count is absent", () => {
    const p = parseClaudeSearchMessages(
      messages({ usage: { input_tokens: 1, output_tokens: 1 } })
    );
    expect(p.webSearchRequests).toBe(1);
  });

  it("unparsable body -> nulls, never throws", () => {
    for (const body of [null, undefined, "x", 3, [], { content: "no" }]) {
      const p = parseClaudeSearchMessages(body);
      expect(p.text).toBe("");
      expect(p.truncated).toBeNull();
      expect(p.webSearchRequests).toBeNull();
      expect(p.inputTokens).toBeNull();
    }
  });

  it("reads provider estimated_cost (unit) when present", () => {
    const p = parseClaudeSearchMessages(
      messages({ estimated_cost: { amount: "0.04", currency: "unit" } })
    );
    expect(p.estimatedCostUnits).toBe(0.04);
  });
});

describe("env helpers and request body", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("model defaults to claude-sonnet-5-5 and is overridable", () => {
    expect(claudeSearchModel()).toBe("claude-sonnet-5-5");
    vi.stubEnv("FINDABLE_CLAUDE_MODEL_SEARCH", "claude-x");
    expect(claudeSearchModel()).toBe("claude-x");
  });

  it("max_tokens default 4096, clamped 1024-8192, junk -> default", () => {
    expect(claudeSearchMaxTokens()).toBe(4096);
    vi.stubEnv("FINDABLE_CLAUDE_SEARCH_MAX_TOKENS", "100");
    expect(claudeSearchMaxTokens()).toBe(1024);
    vi.stubEnv("FINDABLE_CLAUDE_SEARCH_MAX_TOKENS", "99999");
    expect(claudeSearchMaxTokens()).toBe(8192);
    vi.stubEnv("FINDABLE_CLAUDE_SEARCH_MAX_TOKENS", "abc");
    expect(claudeSearchMaxTokens()).toBe(4096);
  });

  it("production request body is unchanged (max_tokens 1024, max_uses 3)", () => {
    const body = JSON.parse(
      claudeSearchRequestBody("claude-sonnet-4-6", query)
    );
    expect(body.max_tokens).toBe(1024);
    expect(body.tools[0]).toMatchObject({
      type: "web_search_20250305",
      max_uses: 3,
    });
  });

  it("candidate request body uses the overrides", () => {
    const body = JSON.parse(
      claudeSearchRequestBody("claude-sonnet-5-5", query, {
        maxTokens: 4096,
        maxUses: 3,
      })
    );
    expect(body).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 4096,
    });
  });
});

describe("runClaudeSearchCandidate", () => {
  beforeEach(() => {
    resetLetsurCircuit();
    vi.stubEnv("LETSUR_API_KEY", "test-letsur");
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

  it("not configured without LETSUR_API_KEY", async () => {
    vi.stubEnv("LETSUR_API_KEY", "");
    const r = await runClaudeSearchCandidate(query);
    expect(r.errorMessage).toBe("[api-search:not_configured]");
  });

  it("success: native /messages call with candidate model/max_tokens and stop_reason in usage", async () => {
    const fetchFn = mockFetch({
      ok: true,
      status: 200,
      json: () => Promise.resolve(messages()),
    });
    const r = await runClaudeSearchCandidate(query);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url.endsWith("/messages")).toBe(true);
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(4096);
    expect(body.tools[0].max_uses).toBe(3);
    expect(r.errorMessage).toBeNull();
    expect(r.brandMentioned).toBe(true);
    expect(r.usage).toMatchObject({
      modelId: "claude-sonnet-5-5",
      inputTokens: 10_000,
      webSearchRequests: 1,
      stopReason: "end_turn",
    });
  });

  it("empty answer -> failure", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content: [], usage: {} }),
    });
    const r = await runClaudeSearchCandidate(query);
    expect(r.errorMessage).toBe("[api-search:empty_answer]");
  });

  it("http error -> failure with status only, no body", async () => {
    mockFetch({
      ok: false,
      status: 500,
      text: () => Promise.resolve("secret"),
    });
    const r = await runClaudeSearchCandidate(query);
    expect(r.errorMessage).toBe("[api-search:http_500]");
  });

  it("network error -> failure", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("down")));
    const r = await runClaudeSearchCandidate(query);
    expect(r.errorMessage).toBe("[api-search:network]");
  });
});

describe("startApiSearchShadow claude-search-v1", () => {
  afterEach(() => vi.unstubAllEnvs());

  const okRow = (stopReason: string | null): EngineResponse => ({
    engineId: "claude",
    rawResponse: "답",
    brandMentioned: true,
    mentionPosition: 1,
    mentionListSize: null,
    sentiment: null,
    citedSources: [],
    shareOfVoice: null,
    errorMessage: null,
    durationMs: 10,
    isStub: false,
    usage: {
      costModel: "token",
      modelId: "claude-sonnet-5-5",
      inputTokens: 1000,
      outputTokens: 100,
      webSearchRequests: 1,
      stopReason,
    },
  });

  it("records truncated=true when stop_reason is max_tokens", async () => {
    const handle = startApiSearchShadow(
      { language: "ko", prompt: "p" },
      "claude-search-v1",
      () => Promise.resolve(okRow("max_tokens"))
    );
    const shadow = await handle.finish(okRow(null));
    expect(shadow).toMatchObject({
      candidate: "claude-search-v1",
      outcome: "ok",
      stopReason: "max_tokens",
      truncated: true,
    });
  });

  it("truncated=false for end_turn, null when stop_reason missing", async () => {
    const a = await startApiSearchShadow(
      { language: "ko", prompt: "p" },
      "claude-search-v1",
      () => Promise.resolve(okRow("end_turn"))
    ).finish(okRow(null));
    expect(a.truncated).toBe(false);
    const b = await startApiSearchShadow(
      { language: "ko", prompt: "p" },
      "claude-search-v1",
      () => Promise.resolve(okRow(null))
    ).finish(okRow(null));
    expect(b.truncated).toBeNull();
  });

  it("failed candidate has no truncated/usage", async () => {
    const failed: EngineResponse = {
      ...okRow(null),
      errorMessage: "[api-search:http_500]",
    };
    const shadow = await startApiSearchShadow(
      { language: "ko", prompt: "p" },
      "claude-search-v1",
      () => Promise.resolve(failed)
    ).finish(okRow(null));
    expect(shadow.outcome).toBe("failed");
    expect(shadow.truncated).toBeUndefined();
    expect(shadow.usage).toBeUndefined();
  });

  it("late candidate (grace 0, never settles) -> skipped_budget, aborted", async () => {
    let aborted = false;
    const handle = startApiSearchShadow(
      { language: "ko", prompt: "p" },
      "claude-search-v1",
      (q) =>
        new Promise((resolve) => {
          q.signal?.addEventListener("abort", () => {
            aborted = true;
            resolve(okRow(null));
          });
        })
    );
    const shadow = await handle.finish(okRow(null));
    expect(shadow.outcome).toBe("skipped_budget");
    expect(shadow.model).toBe("claude-sonnet-5-5");
    expect(aborted).toBe(true);
  });
});

describe("claude-search-v1 shadow cost", () => {
  const row = (
    usage: NonNullable<EngineResponse["usage"]> | undefined,
    model = "claude-sonnet-5-5"
  ): EngineResponse => ({
    engineId: "claude",
    rawResponse: "a",
    brandMentioned: true,
    mentionPosition: null,
    mentionListSize: null,
    sentiment: null,
    citedSources: [],
    shareOfVoice: null,
    errorMessage: null,
    durationMs: 1,
    isStub: false,
    usage: { costModel: "token", inputTokens: 1, outputTokens: 1 },
    shadowApiSearch: {
      candidate: "claude-search-v1",
      model,
      outcome: "ok",
      text: "t",
      citations: [],
      brandMentioned: true,
      durationMs: 1,
      error: null,
      comparison: null,
      ...(usage ? { usage } : {}),
    },
  });

  it("computes from catalog $2/$10 per 1M x 1525 KRW/unit, no separate search fee", () => {
    const c = apiSearchShadowCostOf(
      row({
        costModel: "token",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        webSearchRequests: 5,
      })
    );
    expect(c?.basis).toBe("token");
    expect(c?.krw).toBeCloseTo(12 * LETSUR_KRW_PER_UNIT, 6);
    expect(c?.note).toContain("[확인필요]");
  });

  it("unit estimate ~0.038/call for a typical c2 call", () => {
    const c = apiSearchShadowCostOf(
      row({
        costModel: "token",
        inputTokens: 14_000,
        outputTokens: 1000,
        webSearchRequests: 1,
      })
    );
    expect((c?.krw ?? 0) / LETSUR_KRW_PER_UNIT).toBeCloseTo(0.038, 3);
  });

  it("provider-reported cost wins over the price table", () => {
    const c = apiSearchShadowCostOf(
      row({
        costModel: "token",
        inputTokens: 1,
        outputTokens: 1,
        providerCostKrw: 50,
      })
    );
    expect(c?.krw).toBe(50);
  });

  it("unknown model stays unknown (0 KRW), tokens missing stays unknown", () => {
    const tokens = {
      costModel: "token" as const,
      inputTokens: 1000,
      outputTokens: 10,
    };
    const unknown = apiSearchShadowCostOf(row(tokens, "claude-future-9"));
    expect(unknown?.basis).toBe("unknown");
    expect(unknown?.krw).toBe(0);
    expect(
      apiSearchShadowCostOf(
        row({ costModel: "token", inputTokens: null, outputTokens: null })
      )?.basis
    ).toBe("unknown");
  });

  it("never enters totalKrw; reported only in apiSearchShadowKrw/shadowKrw", () => {
    const usage = {
      costModel: "token" as const,
      inputTokens: 14_000,
      outputTokens: 1000,
      webSearchRequests: 1,
    };
    const withShadow = auditCost([row(usage)]);
    const without = auditCost([{ ...row(usage), shadowApiSearch: undefined }]);
    expect(withShadow.totalKrw).toBe(without.totalKrw);
    expect(withShadow.apiSearchShadowKrw).toBeGreaterThan(0);
    expect(without.apiSearchShadowKrw).toBeUndefined();
  });
});
