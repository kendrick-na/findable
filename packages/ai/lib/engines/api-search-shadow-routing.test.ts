import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineQuery, EngineResponse } from "./types";

vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const resp = (engineId: EngineQuery["engineId"]): EngineResponse => ({
  brandMentioned: true,
  citedSources: [],
  durationMs: 10,
  engineId,
  errorMessage: null,
  isStub: false,
  mentionListSize: null,
  mentionPosition: 1,
  rawResponse: "answer",
  sentiment: null,
  shareOfVoice: null,
});

const mocks = vi.hoisted(() => ({ shadow: vi.fn() }));

vi.mock("./global-adapters", () => ({
  chatgptAdapter: (q: EngineQuery) => Promise.resolve(resp(q.engineId)),
  chatgptApiSearchAdapter: (q: EngineQuery) =>
    Promise.resolve(resp(q.engineId)),
  claudeAdapter: (q: EngineQuery) => Promise.resolve(resp(q.engineId)),
  geminiAdapter: (q: EngineQuery) => Promise.resolve(resp(q.engineId)),
  perplexityAdapter: (q: EngineQuery) => Promise.resolve(resp(q.engineId)),
}));
vi.mock("./api-search-v1", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api-search-v1")>();
  return { ...actual, startApiSearchShadow: mocks.shadow };
});

const { queryAllEngines } = await import("./index");

const handleFor = (candidate: string) => ({
  finish: (main: EngineResponse | undefined) =>
    Promise.resolve({
      candidate,
      model: "m",
      outcome: "ok" as const,
      text: "shadow",
      citations: [],
      brandMentioned: false,
      durationMs: 5,
      error: null,
      comparison: main
        ? { mentionAgreement: false, citationOverlap: null }
        : null,
    }),
});

const base = {
  language: "ko" as const,
  prompt: "p",
  brandName: "라네즈",
  brandDomain: "laneige.com",
};
const engines = ["chatgpt", "claude", "gemini"] as const;

describe("api-search shadow routing in queryAllEngines", () => {
  beforeEach(() => {
    mocks.shadow.mockReset();
    mocks.shadow.mockImplementation((_b: unknown, candidate: string) =>
      handleFor(candidate)
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  it("flag off -> no shadow call, rows untouched", async () => {
    vi.stubEnv("API_SEARCH_SHADOW_BRANDS", "laneige.com");
    const rows = await queryAllEngines(base, engines);
    expect(mocks.shadow).not.toHaveBeenCalled();
    expect(rows.every((r) => r.shadowApiSearch === undefined)).toBe(true);
  });

  it("flag on but empty allowlist -> nobody runs", async () => {
    vi.stubEnv("API_SEARCH_SHADOW", "true");
    const rows = await queryAllEngines(base, engines);
    expect(mocks.shadow).not.toHaveBeenCalled();
    expect(rows.every((r) => r.shadowApiSearch === undefined)).toBe(true);
  });

  it("domain not on the list -> no shadow", async () => {
    vi.stubEnv("API_SEARCH_SHADOW", "true");
    vi.stubEnv("API_SEARCH_SHADOW_BRANDS", "other.com");
    await queryAllEngines(base, engines);
    expect(mocks.shadow).not.toHaveBeenCalled();
  });

  it("allowed domain -> attached to chatgpt, gemini and claude rows; main fields unchanged", async () => {
    vi.stubEnv("API_SEARCH_SHADOW", "true");
    vi.stubEnv("API_SEARCH_SHADOW_BRANDS", "www.laneige.com");
    const rows = await queryAllEngines(base, engines);
    const byId = Object.fromEntries(rows.map((r) => [r.engineId, r]));
    expect(byId.chatgpt.shadowApiSearch?.candidate).toBe("chatgpt-search-v1");
    expect(byId.gemini.shadowApiSearch?.candidate).toBe("gemini-search-v1");
    expect(byId.claude.shadowApiSearch?.candidate).toBe("claude-search-v1");
    const { shadowApiSearch: _omit, ...chatgptMain } = byId.chatgpt;
    expect(chatgptMain).toEqual(resp("chatgpt"));
  });

  it("only starts candidates for engines actually requested", async () => {
    vi.stubEnv("API_SEARCH_SHADOW", "true");
    vi.stubEnv("API_SEARCH_SHADOW_BRANDS", "laneige.com");
    await queryAllEngines(base, ["perplexity"]);
    expect(mocks.shadow).not.toHaveBeenCalled();
    await queryAllEngines(base, ["claude"]);
    expect(mocks.shadow).toHaveBeenCalledTimes(1);
    expect(mocks.shadow.mock.calls[0]?.[1]).toBe("claude-search-v1");
  });

  it("skips the shadow on a late-cell re-ask (options.timeoutMs)", async () => {
    vi.stubEnv("API_SEARCH_SHADOW", "true");
    vi.stubEnv("API_SEARCH_SHADOW_BRANDS", "laneige.com");
    await queryAllEngines(base, engines, undefined, { timeoutMs: 1000 });
    expect(mocks.shadow).not.toHaveBeenCalled();
  });

  it("a crashing shadow never breaks the main result", async () => {
    vi.stubEnv("API_SEARCH_SHADOW", "true");
    vi.stubEnv("API_SEARCH_SHADOW_BRANDS", "laneige.com");
    mocks.shadow.mockImplementation(() => {
      throw new Error("boom");
    });
    const rows = await queryAllEngines(base, engines);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.shadowApiSearch === undefined)).toBe(true);
  });

  it("no brandDomain -> nobody runs", async () => {
    vi.stubEnv("API_SEARCH_SHADOW", "true");
    vi.stubEnv("API_SEARCH_SHADOW_BRANDS", "laneige.com");
    await queryAllEngines({ language: "ko", prompt: "p" }, engines);
    expect(mocks.shadow).not.toHaveBeenCalled();
  });
});
