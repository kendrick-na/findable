import { describe, expect, it } from "vitest";
import {
  apiSearchShadowCostOf,
  auditCost,
  COST_MODEL_VERSION,
  costOf,
  GEMINI_SEARCH_USD_PER_QUERY,
  LETSUR_KRW_PER_UNIT,
  USD_TO_KRW,
} from "./cost";
import type { ApiSearchShadow, EngineResponse, EngineUsage } from "./types";

const main = (
  engineId: EngineResponse["engineId"],
  shadow?: ApiSearchShadow,
  usage?: EngineUsage
): EngineResponse => ({
  brandMentioned: true,
  citedSources: [],
  durationMs: 1000,
  engineId,
  errorMessage: null,
  isStub: false,
  mentionListSize: null,
  mentionPosition: null,
  rawResponse: "a",
  sentiment: null,
  shareOfVoice: null,
  ...(usage ? { usage } : {}),
  ...(shadow ? { shadowApiSearch: shadow } : {}),
});

const shadowOf = (
  candidate: ApiSearchShadow["candidate"],
  model: string,
  usage: EngineUsage | undefined,
  outcome: ApiSearchShadow["outcome"] = "ok"
): ApiSearchShadow => ({
  candidate,
  model,
  outcome,
  text: "t",
  citations: [],
  brandMentioned: true,
  durationMs: 10,
  error: null,
  comparison: null,
  ...(usage ? { usage } : {}),
});

const mainUsage: EngineUsage = {
  costModel: "token",
  inputTokens: 1_000_000,
  outputTokens: 0,
};

describe("api-search-v1 shadow cost", () => {
  it("the cost model version is unchanged (input-only additions)", () => {
    expect(COST_MODEL_VERSION).toBe(2);
  });

  it("ChatGPT candidate prefers the provider-reported cost in KRW (1 unit = 1,525 KRW, not 1,380)", () => {
    const res = main(
      "chatgpt",
      shadowOf("chatgpt-search-v1", "gpt-6-luna", {
        costModel: "token",
        inputTokens: 10,
        outputTokens: 10,
        modelId: "gpt-6-luna",
        providerCostUsd: 0.002_830_29,
        providerCostKrw: 0.002_830_29 * LETSUR_KRW_PER_UNIT,
      })
    );
    const cost = apiSearchShadowCostOf(res);
    expect(LETSUR_KRW_PER_UNIT).toBe(1525);
    expect(USD_TO_KRW).toBe(1380);
    expect(cost?.krw).toBeCloseTo(0.002_830_29 * 1525, 6);
    expect(cost?.krw).not.toBeCloseTo(0.002_830_29 * 1380, 6);
    expect(cost?.basis).toBe("token");
  });

  it("falls back to providerCostUsd x USD_TO_KRW when only USD is present", () => {
    const res = main(
      "chatgpt",
      shadowOf("chatgpt-search-v1", "gpt-6-luna", {
        costModel: "token",
        inputTokens: null,
        outputTokens: null,
        providerCostUsd: 0.01,
      })
    );
    expect(apiSearchShadowCostOf(res)?.krw).toBeCloseTo(0.01 * USD_TO_KRW);
  });

  it("an unknown model stays unknown (never borrows gpt-5.4 or gemini-2.5 prices)", () => {
    const chatgpt = apiSearchShadowCostOf(
      main(
        "chatgpt",
        shadowOf("chatgpt-search-v1", "gpt-6-luna", {
          costModel: "token",
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          modelId: "gpt-6-luna",
          providerCostUsd: null,
          providerCostKrw: null,
        })
      )
    );
    expect(chatgpt).toMatchObject({ basis: "unknown", krw: 0 });
    const gemini = apiSearchShadowCostOf(
      main(
        "gemini",
        shadowOf("gemini-search-v1", "gemini-9-unknown", {
          costModel: "token",
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          modelId: "gemini-9-unknown",
          webSearchRequests: 3,
        })
      )
    );
    expect(gemini).toMatchObject({ basis: "unknown", krw: 0 });
  });

  it("Gemini grounded cost = tokens (LETSUR catalog) + per-query search fee", () => {
    const res = main(
      "gemini",
      shadowOf("gemini-search-v1", "gemini-3.5-flash-lite", {
        costModel: "token",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        modelId: "gemini-3.5-flash-lite",
        webSearchRequests: 3,
      })
    );
    const usd = 0.3 + 2.5 + 3 * GEMINI_SEARCH_USD_PER_QUERY;
    expect(GEMINI_SEARCH_USD_PER_QUERY).toBeCloseTo(0.014);
    expect(apiSearchShadowCostOf(res)?.krw).toBeCloseTo(usd * USD_TO_KRW);
  });

  it("unmeasured search count adds no search fee but says so", () => {
    const cost = apiSearchShadowCostOf(
      main(
        "gemini",
        shadowOf("gemini-search-v1", "gemini-3.5-flash-lite", {
          costModel: "token",
          inputTokens: 1_000_000,
          outputTokens: 0,
          modelId: "gemini-3.5-flash-lite",
          webSearchRequests: null,
        })
      )
    );
    expect(cost?.krw).toBeCloseTo(0.3 * USD_TO_KRW);
    expect(cost?.note).toContain("미수집");
  });

  it("failed or skipped shadows produce no cost item", () => {
    expect(
      apiSearchShadowCostOf(
        main(
          "chatgpt",
          shadowOf("chatgpt-search-v1", "m", undefined, "skipped_budget")
        )
      )
    ).toBeNull();
    expect(
      apiSearchShadowCostOf(
        main("chatgpt", shadowOf("chatgpt-search-v1", "m", undefined, "failed"))
      )
    ).toBeNull();
    expect(apiSearchShadowCostOf(main("chatgpt"))).toBeNull();
  });

  it("is reported in shadowKrw/apiSearchShadowKrw but NOT in totalKrw or perEngine", () => {
    const plain = [main("chatgpt", undefined, mainUsage)];
    const withShadow = [
      main(
        "chatgpt",
        shadowOf("chatgpt-search-v1", "gpt-6-luna", {
          costModel: "token",
          inputTokens: 1,
          outputTokens: 1,
          providerCostKrw: 100,
        }),
        mainUsage
      ),
    ];
    const base = auditCost(plain);
    const cost = auditCost(withShadow);
    expect(cost.totalKrw).toBeCloseTo(base.totalKrw);
    expect(cost.perEngine).toHaveLength(1);
    expect(cost.shadowKrw).toBeCloseTo(100);
    expect(cost.apiSearchShadowKrw).toBeCloseTo(100);
    expect(cost.apiSearchShadow).toHaveLength(1);
    // main row cost itself is untouched by the shadow.
    expect(costOf(withShadow[0]).krw).toBeCloseTo(costOf(plain[0]).krw);
  });

  it("no shadow -> no new fields (byte-for-byte unchanged shape)", () => {
    const cost = auditCost([main("chatgpt", undefined, mainUsage)]);
    expect("shadowKrw" in cost).toBe(false);
    expect("apiSearchShadowKrw" in cost).toBe(false);
    expect("apiSearchShadow" in cost).toBe(false);
  });

  it("main tokenCost honors providerCostKrw over providerCostUsd (input-only addition)", () => {
    const cost = costOf(
      main("chatgpt", undefined, {
        costModel: "token",
        inputTokens: 1,
        outputTokens: 1,
        providerCostUsd: 1,
        providerCostKrw: 7,
      })
    );
    expect(cost.krw).toBe(7);
  });
});
