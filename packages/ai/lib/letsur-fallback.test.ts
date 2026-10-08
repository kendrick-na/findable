import { log } from "@repo/observability/log";
import { APICallError, gateway, generateText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { suggestCompetitors } from "./competitor-suggest";
import { costOf } from "./engines/cost";
import { chatgptAdapter, claudeAdapter } from "./engines/global-adapters";
import {
  classifyLetsurUnavailable,
  isLetsurCircuitOpen,
  isLetsurUnavailable,
  resetLetsurCircuit,
  withLetsurFallback,
} from "./letsur-fallback";
import { verdictModel } from "./mention-verdict";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, gateway: vi.fn() };
});

vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// Letsur(OpenAI 호환) provider 를 가짜 모델로 바꾼다. `models.ts` 가 `.embedding` 도 부른다.
const letsurState = vi.hoisted(() => ({
  model: undefined as unknown,
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() =>
    Object.assign(() => letsurState.model, { embedding: () => ({}) })
  ),
}));
let letsurModel: MockLanguageModelV3;
function setLetsur(model: MockLanguageModelV3): void {
  letsurModel = model;
  letsurState.model = model;
}

const SECRET_BODY = '{"error":{"message":"insufficient credit for user 0000"}}';

function apiError(statusCode: number, responseBody = ""): APICallError {
  return new APICallError({
    message: `HTTP ${statusCode}`,
    url: "https://gw.letsur.ai/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody,
  });
}

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: {
      inputTokens: {
        total: 1000,
        noCache: 1000,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: 200, text: 200, reasoning: undefined },
    },
    warnings: [],
  };
}

function failingModel(error: unknown): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: () => Promise.reject(error),
  });
}

let gatewayModel: MockLanguageModelV3;

function fallbackLogs() {
  return vi
    .mocked(log.warn)
    .mock.calls.filter(([event]) => event === "ai.letsur.fallback")
    .map(([, payload]) => payload);
}

beforeEach(() => {
  resetLetsurCircuit();
  vi.mocked(log.warn).mockClear();
  vi.mocked(gateway).mockClear();
  vi.stubEnv("LETSUR_API_KEY", "test-letsur");
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway");
  vi.stubEnv("VERCEL_OIDC_TOKEN", "");
  vi.stubEnv("FINDABLE_CLAUDE_WEB_SEARCH", "");
  gatewayModel = new MockLanguageModelV3({
    doGenerate: () => Promise.resolve(textResult("게이트웨이 답변")),
  });
  vi.mocked(gateway).mockImplementation(
    () => gatewayModel as unknown as ReturnType<typeof gateway>
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("classifyLetsurUnavailable", () => {
  it.each([
    [402, "", "credit"],
    [401, "", "auth"],
    [403, '{"error":"forbidden"}', "auth"],
    [429, '{"error":{"code":"insufficient_quota"}}', "quota"],
    [429, "monthly credit exhausted", "quota"],
    [429, "유닛이 소진되었습니다", "quota"],
    [400, '{"error":"API key expired"}', "credit"],
  ])("%i %s → %s", (status, body, reason) => {
    expect(classifyLetsurUnavailable(status, body)).toBe(reason);
    expect(isLetsurUnavailable(status, body)).toBe(true);
  });

  it.each([
    [429, '{"error":"rate limit, slow down"}'],
    [429, ""],
    [500, "insufficient credit"],
    [502, ""],
    [503, ""],
    [504, ""],
    [400, '{"error":"invalid max_tokens"}'],
    [null, ""],
    [undefined, undefined],
  ])("%s %s → 불가 아님(기존 재시도/오류 경로)", (status, body) => {
    expect(classifyLetsurUnavailable(status, body)).toBeNull();
    expect(isLetsurUnavailable(status, body)).toBe(false);
  });
});

describe("withLetsurFallback", () => {
  it("402 → 같은 호출을 Gateway 로 보내고, 결과에 폴백 표식을 남긴다", async () => {
    const primary = failingModel(apiError(402, SECRET_BODY));
    const model = withLetsurFallback(primary, {
      callSite: "test",
      gatewayModelId: "anthropic/claude-haiku-4.5",
    });
    const out = await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(out.text).toBe("게이트웨이 답변");
    expect(out.providerMetadata?.findable).toEqual({
      fallback: "gateway",
      provider: "gateway",
      modelId: "anthropic/claude-haiku-4.5",
    });
    expect(gateway).toHaveBeenCalledWith("anthropic/claude-haiku-4.5");
    // 같은 논리 호출(프롬프트)이 그대로 넘어갔다.
    expect(gatewayModel.doGenerateCalls[0]?.prompt).toEqual(
      primary.doGenerateCalls[0]?.prompt
    );
    expect(fallbackLogs()).toEqual([
      { callSite: "test", reason: "credit", outcome: "ok" },
    ]);
    // 🔴 로그에 응답 본문·키가 없다.
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain(
      "insufficient credit for user"
    );
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain(
      "test-gateway"
    );
  });

  it("일시적 500 은 폴백하지 않는다 — 원래 오류 그대로(기존 재시도 경로)", async () => {
    const error = apiError(500, "upstream exploded");
    const model = withLetsurFallback(failingModel(error), {
      callSite: "test",
      gatewayModelId: "anthropic/claude-haiku-4.5",
    });
    await expect(
      generateText({ model, prompt: "hi", maxRetries: 0 })
    ).rejects.toBe(error);
    expect(gateway).not.toHaveBeenCalled();
    expect(isLetsurCircuitOpen()).toBe(false);
    expect(fallbackLogs()).toEqual([]);
  });

  it("둘 다 실패하면 원래 Letsur 오류를 던지고 outcome: failed 를 남긴다", async () => {
    const original = apiError(402, SECRET_BODY);
    gatewayModel = failingModel(
      apiError(402, "gateway: positive balance required")
    );
    const model = withLetsurFallback(failingModel(original), {
      callSite: "test",
      engineId: "claude",
      gatewayModelId: "anthropic/claude-sonnet-4.6",
    });
    await expect(
      generateText({ model, prompt: "hi", maxRetries: 0 })
    ).rejects.toBe(original);
    expect(fallbackLogs()).toEqual([
      {
        callSite: "test",
        engineId: "claude",
        reason: "credit",
        outcome: "failed",
      },
    ]);
  });

  it("Gateway 인증이 없으면 폴백을 시도하지 않고 원래 오류 + failed 로그", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL", "");
    const original = apiError(402);
    const model = withLetsurFallback(failingModel(original), {
      callSite: "test",
      gatewayModelId: "anthropic/claude-haiku-4.5",
    });
    await expect(
      generateText({ model, prompt: "hi", maxRetries: 0 })
    ).rejects.toBe(original);
    expect(gateway).not.toHaveBeenCalled();
    expect(fallbackLogs()).toEqual([
      { callSite: "test", reason: "credit", outcome: "failed" },
    ]);
  });

  it("차단기: 불가 확인 후 N분 동안 Letsur 를 건너뛰고, 창이 지나면 다시 Letsur 를 쓴다", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const primary = failingModel(apiError(402));
    const model = withLetsurFallback(primary, {
      callSite: "test",
      gatewayModelId: "anthropic/claude-haiku-4.5",
    });

    await generateText({ model, prompt: "1", maxRetries: 0 });
    expect(primary.doGenerateCalls).toHaveLength(1);
    expect(isLetsurCircuitOpen()).toBe(true);

    now += 9 * 60_000;
    await generateText({ model, prompt: "2", maxRetries: 0 });
    await generateText({ model, prompt: "3", maxRetries: 0 });
    // 창 안에서는 Letsur 를 두드리지 않는다(지연 절약).
    expect(primary.doGenerateCalls).toHaveLength(1);
    expect(gatewayModel.doGenerateCalls).toHaveLength(3);
    // 차단기 로그는 창당 1회.
    const circuitLogs = vi
      .mocked(log.warn)
      .mock.calls.filter(([event]) => event === "ai.letsur.circuit_open");
    expect(circuitLogs).toHaveLength(1);

    now += 2 * 60_000; // 10분 경과
    expect(isLetsurCircuitOpen()).toBe(false);
    await generateText({ model, prompt: "4", maxRetries: 0 });
    expect(primary.doGenerateCalls).toHaveLength(2);
  });
});

describe("호출 지점별 폴백", () => {
  it("엔진(chatgpt): 402 → Gateway 로 답하고 usage 에 provider·모델·fallback 을 남긴다", async () => {
    setLetsur(failingModel(apiError(402, SECRET_BODY)));
    const res = await chatgptAdapter({
      brandName: "인디고차일드",
      engineId: "chatgpt",
      language: "ko",
      prompt: "추천해줘",
    });
    expect(res.errorMessage).toBeNull();
    expect(res.rawResponse).toBe("게이트웨이 답변");
    expect(res.usage).toMatchObject({
      provider: "gateway",
      fallback: "gateway",
      modelId: "openai/gpt-5.4",
      inputTokens: 1000,
      outputTokens: 200,
    });
    expect(res.usage?.searchUnavailable).toBeUndefined();
    expect(fallbackLogs()).toEqual([
      {
        callSite: "engine",
        engineId: "chatgpt",
        reason: "credit",
        outcome: "ok",
      },
    ]);
    // 💰 원가는 실제 Gateway 모델 단가로: (1000×2.5 + 200×15)/1M USD
    const cost = costOf(res);
    expect(cost.basis).toBe("token");
    expect(cost.krw).toBeCloseTo(((1000 * 2.5 + 200 * 15) / 1e6) * 1380, 6);
    expect(cost.note).toContain("Letsur→Gateway 폴백");
  });

  it("엔진: 둘 다 실패하면 원래 Letsur 오류 메시지로 기존 실패 응답", async () => {
    setLetsur(failingModel(apiError(402, SECRET_BODY)));
    gatewayModel = failingModel(apiError(402, "gateway: no credit"));
    const res = await chatgptAdapter({
      brandName: "인디고차일드",
      engineId: "chatgpt",
      language: "ko",
      prompt: "추천해줘",
    });
    expect(res.errorMessage).toBe("HTTP 402");
    expect(res.rawResponse).toBe("");
    expect(fallbackLogs()).toEqual([
      {
        callSite: "engine",
        engineId: "chatgpt",
        reason: "credit",
        outcome: "failed",
      },
    ]);
  });

  it("claude 웹검색: Letsur 402 → Gateway /v1/messages 웹검색으로 같은 호출, 출처 유지", async () => {
    vi.stubEnv("FINDABLE_CLAUDE_WEB_SEARCH", "1");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(SECRET_BODY, { status: 402 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: "인디고차일드를 추천합니다.",
                citations: [{ url: "https://news.example.com/a", title: "A" }],
              },
            ],
            usage: {
              input_tokens: 9000,
              output_tokens: 900,
              server_tool_use: { web_search_requests: 2 },
            },
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);
    const res = await claudeAdapter({
      brandName: "인디고차일드",
      engineId: "claude",
      language: "ko",
      prompt: "추천해줘",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://ai-gateway.vercel.sh/v1/messages"
    );
    const sent = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(sent.model).toBe("anthropic/claude-sonnet-4.6");
    expect(sent.tools[0].type).toBe("web_search_20250305");
    expect(res.citedSources).toHaveLength(1);
    expect(res.usage).toMatchObject({
      provider: "gateway",
      fallback: "gateway",
      modelId: "anthropic/claude-sonnet-4.6",
      webSearchRequests: 2,
    });
    expect(costOf(res).krw).toBeCloseTo(
      ((9000 * 3 + 900 * 15) / 1e6 + 2 * 0.01) * 1380,
      6
    );
    expect(fallbackLogs()).toEqual([
      {
        callSite: "engine.claude.web_search",
        engineId: "claude",
        reason: "credit",
        outcome: "ok",
      },
    ]);
  });

  it("claude 웹검색: Gateway 웹검색도 실패하면 검색 없는 Gateway 채팅으로 답하되 searchUnavailable 표시", async () => {
    vi.stubEnv("FINDABLE_CLAUDE_WEB_SEARCH", "1");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(SECRET_BODY, { status: 402 }))
        .mockResolvedValueOnce(new Response("nope", { status: 500 }))
    );
    setLetsur(failingModel(apiError(402)));
    const res = await claudeAdapter({
      brandName: "인디고차일드",
      engineId: "claude",
      language: "ko",
      prompt: "추천해줘",
    });
    expect(res.errorMessage).toBeNull();
    expect(res.citedSources).toEqual([]);
    expect(res.usage).toMatchObject({
      provider: "gateway",
      fallback: "gateway",
      searchUnavailable: true,
    });
    // 차단기가 열려 있어 Letsur 채팅은 두드리지 않았다.
    expect(letsurModel.doGenerateCalls).toHaveLength(0);
  });

  it("판정기(verdictModel): 402 → Gateway haiku 로 같은 호출", async () => {
    setLetsur(failingModel(apiError(402)));
    const out = await generateText({
      model: await verdictModel(),
      prompt: "판정",
      maxRetries: 0,
    });
    expect(out.text).toBe("게이트웨이 답변");
    expect(gateway).toHaveBeenCalledWith("anthropic/claude-haiku-4.5");
    expect(fallbackLogs()).toEqual([
      { callSite: "mention-verdict", reason: "credit", outcome: "ok" },
    ]);
  });

  it("보조 호출(competitor-suggest): 402 → Gateway 로 구조화 출력까지 성공", async () => {
    setLetsur(failingModel(apiError(402)));
    gatewayModel = new MockLanguageModelV3({
      doGenerate: () =>
        Promise.resolve(
          textResult('{"competitors":["경쟁사A","경쟁사B"],"confident":true}')
        ),
    });
    expect(
      await suggestCompetitors({ brandName: "인디고차일드", domain: "x.kr" })
    ).toEqual(["경쟁사A", "경쟁사B"]);
    expect(fallbackLogs()).toEqual([
      { callSite: "competitor-suggest", reason: "credit", outcome: "ok" },
    ]);
  });
});

describe("cost — Gateway 경로 단가", () => {
  it("등록 안 된 모델은 다른 단가를 빌리지 않고 unknown", () => {
    const cost = costOf({
      engineId: "claude",
      rawResponse: "x",
      brandMentioned: false,
      mentionPosition: null,
      mentionListSize: null,
      sentiment: null,
      citedSources: [],
      shareOfVoice: null,
      errorMessage: null,
      durationMs: 1,
      isStub: false,
      usage: {
        costModel: "token",
        inputTokens: 10,
        outputTokens: 10,
        provider: "gateway",
        fallback: "gateway",
        modelId: "anthropic/claude-opus-9",
      },
    });
    expect(cost.basis).toBe("unknown");
    expect(cost.krw).toBe(0);
    expect(cost.note).toContain("모델 단가 미등록");
  });
});
