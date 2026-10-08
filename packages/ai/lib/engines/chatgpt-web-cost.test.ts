import { describe, expect, it } from "vitest";
import {
  auditCost,
  CHATGPT_WEB_KRW_PER_CALL,
  COST_MODEL_VERSION,
  costOf,
  FIRECRAWL_USD_PER_CREDIT,
  USD_TO_KRW,
} from "./cost";
import type { EngineResponse, EngineUsage } from "./types";

const row = (
  engineId: EngineResponse["engineId"],
  usage?: EngineUsage,
  over: Partial<EngineResponse> = {}
): EngineResponse => ({
  brandMentioned: true,
  citedSources: [],
  durationMs: 20_000,
  engineId,
  errorMessage: null,
  isStub: false,
  mentionListSize: null,
  mentionPosition: null,
  rawResponse: "a",
  sentiment: null,
  shareOfVoice: null,
  ...(usage ? { usage } : {}),
  ...over,
});

const CREDIT_KRW = FIRECRAWL_USD_PER_CREDIT * USD_TO_KRW;
const tokenKrw = (input: number, output: number, searches = 0) =>
  ((input / 1e6) * 2.5 + (output / 1e6) * 15 + searches * 0.01) * USD_TO_KRW;

describe("ChatGPT web collection cost", () => {
  it("per-call estimate = 1 Firecrawl credit at the conservative credit price", () => {
    expect(CHATGPT_WEB_KRW_PER_CALL).toBeCloseTo(CREDIT_KRW);
    // Hobby monthly upper bound: $19/5,000 credits x 1,380 KRW ≈ 5.24 KRW per call.
    expect(CHATGPT_WEB_KRW_PER_CALL).toBeCloseTo(5.244, 2);
  });

  it("a web-sourced chatgpt row is billed in Firecrawl credits, not tokens or minutes", () => {
    const cost = costOf(
      row("chatgpt", {
        inputTokens: null,
        outputTokens: null,
        costModel: "credit",
        creditsUsed: 1,
        source: "web",
      })
    );
    expect(cost).toMatchObject({ basis: "credit" });
    expect(cost.krw).toBeCloseTo(CREDIT_KRW);
  });

  it("api_fallback (Letsur path) = gpt-5.4 tokens + $10/1k web search + the failed web credit", () => {
    const cost = costOf(
      row("chatgpt", {
        inputTokens: 10_000,
        outputTokens: 800,
        costModel: "token",
        webSearchRequests: 2,
        source: "api_fallback",
        priorAttemptCreditsUsed: 1,
      })
    );
    expect(cost.basis).toBe("token");
    expect(cost.krw).toBeCloseTo(tokenKrw(10_000, 800, 2) + CREDIT_KRW);
    expect(cost.note).toContain("Firecrawl 1크레딧");
  });

  it("api_fallback via Gateway uses the gateway gpt-5.4 price incl. web search", () => {
    const cost = costOf(
      row("chatgpt", {
        inputTokens: 10_000,
        outputTokens: 800,
        costModel: "token",
        webSearchRequests: 1,
        provider: "gateway",
        modelId: "openai/gpt-5.4",
        fallback: "gateway",
      })
    );
    expect(cost.krw).toBeCloseTo(tokenKrw(10_000, 800, 1));
  });

  it("a fully failed fallback still records the web credit that was spent", () => {
    const cost = costOf(
      row(
        "chatgpt",
        {
          inputTokens: null,
          outputTokens: null,
          costModel: "token",
          source: "api_fallback",
          priorAttemptCreditsUsed: 1,
        },
        { errorMessage: "both failed" }
      )
    );
    expect(cost.basis).toBe("credit");
    expect(cost.krw).toBeCloseTo(CREDIT_KRW);
  });

  it("flags off: the default API chatgpt row has no search fee and the cost model version is unchanged", () => {
    const cost = costOf(
      row("chatgpt", {
        inputTokens: 10_000,
        outputTokens: 800,
        costModel: "token",
      })
    );
    expect(cost.krw).toBeCloseTo(tokenKrw(10_000, 800));
    expect(auditCost([row("chatgpt")]).shadowKrw).toBeUndefined();
    expect(COST_MODEL_VERSION).toBe(2);
  });

  it("a skipped shadow is costed conservatively at its recorded credit", () => {
    const cost = auditCost([
      row(
        "chatgpt",
        { inputTokens: 0, outputTokens: 0, costModel: "token" },
        {
          shadowChatgptWeb: {
            outcome: "skipped_budget",
            text: "",
            citations: [],
            brandMentioned: null,
            durationMs: 1,
            error: "x",
            creditsUsed: 1,
            comparison: null,
          },
        }
      ),
    ]);
    expect(cost.shadowKrw).toBeCloseTo(CREDIT_KRW);
    expect(cost.perEngine.at(-1)).toMatchObject({
      engineId: "chatgpt-web",
      basis: "credit",
    });
  });
});
