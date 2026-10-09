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
vi.mock("./ui-vendor-v1", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ui-vendor-v1")>();
  return { ...actual, startUiVendorShadow: mocks.shadow };
});

const { queryAllEngines } = await import("./index");

const handleFor = (candidate: string) => ({
  finish: (main: EngineResponse | undefined) =>
    Promise.resolve({
      candidate,
      outcome: "ok" as const,
      text: "vendor",
      citations: [],
      brandMentioned: false,
      durationMs: 5,
      error: null,
      recordBilled: true,
      vendorModel: null,
      webSearchTriggered: true,
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

describe("ui-vendor shadow routing in queryAllEngines", () => {
  beforeEach(() => {
    mocks.shadow.mockReset();
    mocks.shadow.mockImplementation((_b: unknown, candidate: string) =>
      handleFor(candidate)
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  it("flag off -> no shadow call (no fetch), rows untouched", async () => {
    vi.stubEnv("UI_VENDOR_SHADOW_BRANDS", "laneige.com");
    const rows = await queryAllEngines(base, engines);
    expect(mocks.shadow).not.toHaveBeenCalled();
    expect(rows.every((r) => r.shadowUiVendor === undefined)).toBe(true);
  });

  it("flag on but empty allowlist -> nobody runs", async () => {
    vi.stubEnv("UI_VENDOR_SHADOW", "true");
    const rows = await queryAllEngines(base, engines);
    expect(mocks.shadow).not.toHaveBeenCalled();
    expect(rows.every((r) => r.shadowUiVendor === undefined)).toBe(true);
  });

  it("domain not on the list / no brandDomain -> no shadow", async () => {
    vi.stubEnv("UI_VENDOR_SHADOW", "true");
    vi.stubEnv("UI_VENDOR_SHADOW_BRANDS", "other.com");
    await queryAllEngines(base, engines);
    await queryAllEngines({ language: "ko", prompt: "p" }, engines);
    expect(mocks.shadow).not.toHaveBeenCalled();
  });

  it("allowed -> attached to chatgpt and gemini only; main row unchanged", async () => {
    vi.stubEnv("UI_VENDOR_SHADOW", "true");
    vi.stubEnv("UI_VENDOR_SHADOW_BRANDS", "www.laneige.com");
    const rows = await queryAllEngines(base, engines);
    const byId = Object.fromEntries(rows.map((r) => [r.engineId, r]));
    expect(byId.chatgpt.shadowUiVendor?.candidate).toBe("chatgpt-ui-vendor-v1");
    expect(byId.gemini.shadowUiVendor?.candidate).toBe("gemini-ui-vendor-v1");
    expect(byId.claude.shadowUiVendor).toBeUndefined();
    const { shadowUiVendor: _omit, ...chatgptMain } = byId.chatgpt;
    expect(chatgptMain).toEqual(resp("chatgpt"));
  });

  it("late-cell re-ask and unrequested engines -> no shadow", async () => {
    vi.stubEnv("UI_VENDOR_SHADOW", "true");
    vi.stubEnv("UI_VENDOR_SHADOW_BRANDS", "laneige.com");
    await queryAllEngines(base, engines, undefined, { timeoutMs: 1000 });
    await queryAllEngines(base, ["claude"]);
    expect(mocks.shadow).not.toHaveBeenCalled();
  });

  it("a crashing shadow never breaks the main result", async () => {
    vi.stubEnv("UI_VENDOR_SHADOW", "true");
    vi.stubEnv("UI_VENDOR_SHADOW_BRANDS", "laneige.com");
    mocks.shadow.mockImplementation(() => {
      throw new Error("boom");
    });
    const rows = await queryAllEngines(base, engines);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.shadowUiVendor === undefined)).toBe(true);
  });
});
