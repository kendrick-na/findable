import { APICallError, gateway } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLetsurCircuit } from "../letsur-fallback";
import {
  chatgptApiSearchAdapter,
  countChatgptWebSearchCalls,
} from "./global-adapters";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, gateway: vi.fn() };
});
vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const state = vi.hoisted(() => ({
  letsur: undefined as unknown,
  letsurTools: [] as unknown[],
}));
const webSearchTool = (owner: string) => ({
  type: "provider",
  id: "openai.web_search",
  name: "web_search",
  args: {},
  owner,
});
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() =>
    Object.assign(() => state.letsur, {
      embedding: () => ({}),
      tools: { webSearch: () => webSearchTool("letsur") },
    })
  ),
  openai: { tools: { webSearch: () => webSearchTool("gateway") } },
}));

function searchResult(text: string) {
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: "ws_1",
        toolName: "web_search",
        input: "{}",
        providerExecuted: true,
      },
      {
        type: "tool-result" as const,
        toolCallId: "ws_1",
        toolName: "web_search",
        result: { status: "completed" },
      },
      { type: "text" as const, text },
      {
        type: "source" as const,
        sourceType: "url" as const,
        id: "s1",
        url: "https://news.example.com/a",
        title: "News",
      },
    ],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: {
      inputTokens: {
        total: 5000,
        noCache: 5000,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: 300, text: 300, reasoning: undefined },
    },
    warnings: [],
  };
}

const query = {
  engineId: "chatgpt" as const,
  language: "ko" as const,
  prompt: "러닝화 추천",
  brandName: "나이키",
};

let letsurModel: MockLanguageModelV3;
let gatewayModel: MockLanguageModelV3;

beforeEach(() => {
  resetLetsurCircuit();
  vi.stubEnv("LETSUR_API_KEY", "test-letsur");
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway");
  vi.stubEnv("VERCEL_OIDC_TOKEN", "");
  vi.stubEnv("VERCEL", "");
  gatewayModel = new MockLanguageModelV3({
    doGenerate: () => Promise.resolve(searchResult("게이트웨이 답: 나이키")),
  });
  vi.mocked(gateway).mockImplementation(
    () => gatewayModel as unknown as ReturnType<typeof gateway>
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("chatgptApiSearchAdapter (API + web_search fallback)", () => {
  it("calls Letsur with the OpenAI web_search tool and keeps url_citation sources", async () => {
    letsurModel = new MockLanguageModelV3({
      doGenerate: () => Promise.resolve(searchResult("나이키 페가수스 추천")),
    });
    state.letsur = letsurModel;
    const res = await chatgptApiSearchAdapter(query);
    const tools = letsurModel.doGenerateCalls[0]?.tools ?? [];
    expect(tools.map((t) => (t as { id?: string }).id)).toEqual([
      "openai.web_search",
    ]);
    expect(res.errorMessage).toBeNull();
    expect(res.brandMentioned).toBe(true);
    expect(res.citedSources).toEqual([
      expect.objectContaining({ url: "https://news.example.com/a" }),
    ]);
    expect(res.usage).toMatchObject({
      costModel: "token",
      inputTokens: 5000,
      outputTokens: 300,
      webSearchRequests: 1,
    });
    expect(res.usage?.provider).toBeUndefined();
    expect(gatewayModel.doGenerateCalls).toHaveLength(0);
  });

  it("goes to AI Gateway (openai/gpt-5.4 + web_search) when Letsur fails for any reason", async () => {
    letsurModel = new MockLanguageModelV3({
      doGenerate: () =>
        Promise.reject(
          new APICallError({
            message: "tool not supported",
            url: "https://gw.letsur.ai/v1/responses",
            requestBodyValues: {},
            statusCode: 400,
            responseBody: '{"error":"unsupported tool"}',
          })
        ),
    });
    state.letsur = letsurModel;
    const res = await chatgptApiSearchAdapter(query);
    expect(vi.mocked(gateway)).toHaveBeenCalledWith("openai/gpt-5.4");
    expect(res.rawResponse).toContain("게이트웨이");
    expect(res.usage).toMatchObject({
      provider: "gateway",
      modelId: "openai/gpt-5.4",
      fallback: "gateway",
      webSearchRequests: 1,
    });
  });

  it("returns an error row (never throws) when every route fails", async () => {
    letsurModel = new MockLanguageModelV3({
      doGenerate: () => Promise.reject(new Error("letsur down")),
    });
    state.letsur = letsurModel;
    gatewayModel = new MockLanguageModelV3({
      doGenerate: () => Promise.reject(new Error("gateway down")),
    });
    const res = await chatgptApiSearchAdapter(query);
    expect(res.errorMessage).toBe("gateway down");
    expect(res.brandMentioned).toBe(false);
  });
});

describe("countChatgptWebSearchCalls", () => {
  it("counts provider-executed web_search tool calls", () => {
    expect(
      countChatgptWebSearchCalls(
        [
          { type: "tool-call", toolName: "web_search" },
          { type: "tool-call", toolName: "web_search" },
          { type: "text" },
        ],
        3
      )
    ).toBe(2);
  });
  it("returns null (not 0) when sources exist but no call was recorded", () => {
    expect(countChatgptWebSearchCalls([{ type: "text" }], 2)).toBeNull();
  });
  it("returns 0 when the model answered without searching", () => {
    expect(countChatgptWebSearchCalls([{ type: "text" }], 0)).toBe(0);
  });
});
