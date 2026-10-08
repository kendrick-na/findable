/**
 * 🔴 원가모델 v2 (2026-10-07) — 엔진 원가 **과소 기록** 수정의 회귀 방지.
 *
 * ① claude 웹검색료($10/1,000회)가 빠져 있었다
 * ② gpt-5.4 output 단가가 $10 로 잘못 들어가 있었다(공식 $15)
 * ③ naver-briefing 이 Browserbase 분당 단가로 잡혔다(실제는 Firecrawl 크레딧)
 * ④ 결과 객체에 원가 규칙 버전이 없어 전/후를 가를 수 없었다
 */

import { describe, expect, it } from "vitest";
import {
  auditCost,
  COST_MODEL_VERSION,
  costOf,
  FIRECRAWL_CREDITS_PER_SCRAPE,
  FIRECRAWL_USD_PER_CREDIT,
  USD_TO_KRW,
} from "./cost";
import {
  parseAnthropicUsage,
  parsePerplexityAgentResponse,
} from "./global-adapters";
import type { EngineResponse, EngineUsage } from "./types";

function response(
  over: Partial<EngineResponse> & { usage?: EngineUsage } = {}
): EngineResponse {
  return {
    engineId: "claude",
    rawResponse: "…",
    brandMentioned: false,
    mentionPosition: null,
    mentionListSize: null,
    sentiment: null,
    citedSources: [],
    shareOfVoice: null,
    errorMessage: null,
    durationMs: 1000,
    isStub: false,
    ...over,
  };
}

const krw = (usd: number) => usd * USD_TO_KRW;

describe("claude 웹검색료", () => {
  const tokens = { inputTokens: 1_000_000, outputTokens: 0 };

  it("✅ 검색 횟수가 있으면 $10/1,000회를 더한다", () => {
    const cost = costOf(
      response({
        usage: { ...tokens, costModel: "token", webSearchRequests: 3 },
      })
    );
    // input 1M × $3 + 3회 × $0.01
    expect(cost.krw).toBeCloseTo(krw(3 + 0.03), 6);
    expect(cost.basis).toBe("token");
    expect(cost.note).toBe("웹검색 3회");
  });

  it("🔴 횟수를 못 받으면 0으로 더하되 「미수집」을 남긴다(추정치 금지)", () => {
    const cost = costOf(
      response({
        usage: { ...tokens, costModel: "token", webSearchRequests: null },
      })
    );
    expect(cost.krw).toBeCloseTo(krw(3), 6);
    expect(cost.note).toContain("검색 횟수 미수집");
  });

  it("✅ 검색 도구를 안 붙인 호출(undefined)은 검색료·주석 없음", () => {
    const cost = costOf(response({ usage: { ...tokens, costModel: "token" } }));
    expect(cost.krw).toBeCloseTo(krw(3), 6);
    expect(cost.note).toBeUndefined();
  });

  it("✅ 응답의 usage.server_tool_use.web_search_requests 를 읽는다", () => {
    expect(
      parseAnthropicUsage({
        usage: {
          input_tokens: 6039,
          output_tokens: 931,
          server_tool_use: { web_search_requests: 2 },
        },
      })
    ).toEqual({ inputTokens: 6039, outputTokens: 931, webSearchRequests: 2 });
    expect(
      parseAnthropicUsage({ usage: { input_tokens: 1, output_tokens: 2 } })
        .webSearchRequests
    ).toBeNull();
    expect(parseAnthropicUsage(null)).toEqual({
      inputTokens: null,
      outputTokens: null,
      webSearchRequests: null,
    });
  });
});

describe("gpt-5.4 공식 단가", () => {
  it("✅ input $2.50 · output $15.00 / 1M", () => {
    const input = costOf(
      response({
        engineId: "chatgpt",
        usage: { costModel: "token", inputTokens: 1_000_000, outputTokens: 0 },
      })
    );
    const output = costOf(
      response({
        engineId: "chatgpt",
        usage: { costModel: "token", inputTokens: 0, outputTokens: 1_000_000 },
      })
    );
    expect(input.krw).toBeCloseTo(krw(2.5), 6);
    expect(output.krw).toBeCloseTo(krw(15), 6);
  });
});

describe("perplexity — provider 보고 원가 우선", () => {
  it("✅ usage.cost.total_cost 가 있으면 그 값을 쓴다", () => {
    const parsed = parsePerplexityAgentResponse({
      output_text: "답",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cost: { currency: "USD", total_cost: 0.030_37 },
        tool_calls_details: { search_web: { invocation: 1 } },
      },
    });
    expect(parsed.providerCostUsd).toBe(0.030_37);
    expect(parsed.webSearchRequests).toBe(1);
    const cost = costOf(
      response({
        engineId: "perplexity",
        usage: {
          costModel: "token",
          inputTokens: parsed.inputTokens,
          outputTokens: parsed.outputTokens,
          providerCostUsd: parsed.providerCostUsd,
          webSearchRequests: parsed.webSearchRequests,
        },
      })
    );
    expect(cost.krw).toBeCloseTo(krw(0.030_37), 6);
    expect(cost.note).toBe("provider 보고 원가(USD)");
  });

  it("✅ provider 원가가 없으면 토큰 + 검색 $0.0025/회", () => {
    const cost = costOf(
      response({
        engineId: "perplexity",
        usage: {
          costModel: "token",
          inputTokens: 1_000_000,
          outputTokens: 0,
          providerCostUsd: null,
          webSearchRequests: 2,
        },
      })
    );
    expect(cost.krw).toBeCloseTo(krw(1 + 0.005), 6);
  });
});

describe("naver-briefing — Firecrawl 크레딧 기준", () => {
  const perScrape = krw(
    FIRECRAWL_CREDITS_PER_SCRAPE * FIRECRAWL_USD_PER_CREDIT
  );

  it("✅ 성공 호출 = 1크레딧 × 크레딧 단가 (세션 시간과 무관)", () => {
    const cost = costOf(
      response({
        engineId: "naver-briefing",
        durationMs: 600_000,
        usage: {
          costModel: "credit",
          inputTokens: null,
          outputTokens: null,
          creditsUsed: 1,
        },
      })
    );
    expect(cost.basis).toBe("credit");
    expect(cost.krw).toBeCloseTo(perScrape, 6);
  });

  it("✅ usage 가 없어도 Firecrawl 기준으로 추정한다(Browserbase 아님)", () => {
    const cost = costOf(response({ engineId: "naver-briefing" }));
    expect(cost.basis).toBe("credit");
    expect(cost.krw).toBeCloseTo(perScrape, 6);
  });

  it("🔴 렌더 성공 후 「브리핑 미노출」 실패도 크레딧을 산입한다", () => {
    const cost = costOf(
      response({
        engineId: "naver-briefing",
        errorMessage: "AI 브리핑 미노출",
        usage: {
          costModel: "credit",
          inputTokens: null,
          outputTokens: null,
          creditsUsed: 1,
        },
      })
    );
    expect(cost.krw).toBeCloseTo(perScrape, 6);
  });

  it("✅ HTTP 오류처럼 크레딧이 명시되지 않은 실패·stub 은 0원", () => {
    const usage: EngineUsage = {
      costModel: "credit",
      inputTokens: null,
      outputTokens: null,
    };
    expect(
      costOf(
        response({
          engineId: "naver-briefing",
          errorMessage: "Firecrawl HTTP 500",
          usage,
        })
      ).krw
    ).toBe(0);
    expect(
      costOf(response({ engineId: "naver-briefing", isStub: true, usage })).krw
    ).toBe(0);
  });
});

describe("costModelVersion", () => {
  it("✅ auditCost 결과에 원가 규칙 버전이 실린다", () => {
    const result = auditCost([response()]);
    expect(COST_MODEL_VERSION).toBe(2);
    expect(result.costModelVersion).toBe(COST_MODEL_VERSION);
  });

  it("✅ credit 엔진도 measuredEngines 에 센다", () => {
    const result = auditCost([
      response({ engineId: "naver-briefing" }),
      response({ engineId: "gemini" }),
    ]);
    expect(result.measuredEngines).toBe(1);
  });
});
