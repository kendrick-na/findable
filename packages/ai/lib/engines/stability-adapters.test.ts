import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: (...args: unknown[]) => generateText(...args),
  };
});

const { claudeAdapter } = await import("./global-adapters");
const { daumAdapter, naverAdapter } = await import("./korean-adapters");
const { resetEngineBreakers } = await import("./engine-breaker");
const { resetRetryBudget } = await import("./cell-retry");

const query = {
  brandName: "Acme",
  engineId: "claude" as const,
  language: "en" as const,
  prompt: "best widgets",
};

const okResult = (text: string) => ({
  providerMetadata: undefined,
  response: { body: undefined },
  sources: [],
  text,
  usage: { inputTokens: 10, outputTokens: 5 },
});

beforeEach(() => {
  generateText.mockReset();
  resetEngineBreakers();
  resetRetryBudget();
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway");
  vi.stubEnv("LETSUR_API_KEY", "");
  vi.stubEnv("FINDABLE_CLAUDE_WEB_SEARCH", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Gateway 어댑터 — 빈 응답 오류화", () => {
  it("꺼짐: 공백뿐인 응답도 예전처럼 정상 응답(errorMessage null)", async () => {
    generateText.mockResolvedValue(okResult("   \n "));
    const res = await claudeAdapter(query);
    expect(res.errorMessage).toBeNull();
    expect(res.brandMentioned).toBe(false);
  });

  it("켜짐: 오류 응답이 되고 측정값을 만들지 않으며 usage 는 남는다", async () => {
    vi.stubEnv("STABILITY_EMPTY_AS_ERROR_ENABLED", "1");
    generateText.mockResolvedValue(okResult("   \n "));
    const res = await claudeAdapter(query);
    expect(res.errorMessage).toBe("Engine claude returned an empty answer");
    expect(res.rawResponse).toBe("");
    expect(res.mentionPosition).toBeNull();
    expect(res.shareOfVoice).toBeNull();
    expect(res.usage?.inputTokens).toBe(10);
  });

  it("켜짐이어도 내용이 있으면 정상 응답", async () => {
    vi.stubEnv("STABILITY_EMPTY_AS_ERROR_ENABLED", "1");
    generateText.mockResolvedValue(okResult("Acme is great"));
    const res = await claudeAdapter(query);
    expect(res.errorMessage).toBeNull();
    expect(res.brandMentioned).toBe(true);
  });
});

describe("Gateway 어댑터 — SDK 재시도 한 층만", () => {
  it("꺼짐: maxRetries 옵션을 아예 넘기지 않는다(기존 호출 모양)", async () => {
    generateText.mockResolvedValue(okResult("Acme"));
    await claudeAdapter(query);
    expect("maxRetries" in generateText.mock.calls[0][0]).toBe(false);
  });

  it("켜짐: maxRetries 0 을 넘긴다", async () => {
    vi.stubEnv("STABILITY_CELL_RETRY_ENABLED", "1");
    generateText.mockResolvedValue(okResult("Acme"));
    await claudeAdapter(query);
    expect(generateText.mock.calls[0][0].maxRetries).toBe(0);
  });
});

describe("Gateway 어댑터 — 실패 응답 모양", () => {
  const err = Object.assign(new Error("Too Many Requests"), {
    responseHeaders: { "retry-after": "3" },
    statusCode: 429,
  });

  it("꺼짐·켜짐 모두 같은 오류 응답 JSON(힌트는 응답 밖 WeakMap)", async () => {
    generateText.mockRejectedValue(err);
    const off = await claudeAdapter(query);
    vi.stubEnv("STABILITY_CELL_RETRY_ENABLED", "1");
    const on = await claudeAdapter(query);
    expect(JSON.stringify({ ...on, durationMs: 0 })).toBe(
      JSON.stringify({ ...off, durationMs: 0 })
    );
    expect(off.errorMessage).toBe("Too Many Requests");
  });
});

describe("검색 API(다음·네이버) 요청 실패 1회 재시도", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  it("다음: 꺼짐이면 실패 요청을 다시 보내지 않는다", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "k");
    const fetchMock = vi.fn(() => Promise.resolve(json({}, 500)));
    vi.stubGlobal("fetch", fetchMock);
    const res = await daumAdapter({
      ...query,
      engineId: "daum",
      brandName: "",
    });
    expect(res.errorMessage).toBe("Daum/Kakao 검색 결과 없음");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("다음: 켜짐이면 500 이 난 요청만 1초 뒤 1번 더, 성공하면 정상 응답", async () => {
    vi.useFakeTimers();
    vi.stubEnv("KAKAO_REST_API_KEY", "k");
    vi.stubEnv("STABILITY_CELL_RETRY_ENABLED", "1");
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls += 1;
      return Promise.resolve(
        calls <= 3 && calls === 1
          ? json({}, 500)
          : json({
              documents: [
                { contents: "c", title: "Acme t", url: "https://a.com" },
              ],
            })
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const pending = daumAdapter({ ...query, engineId: "daum", brandName: "" });
    await vi.advanceTimersByTimeAsync(1100);
    const res = await pending;
    vi.useRealTimers();
    expect(res.errorMessage).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4); // web·blog·cafe + 실패한 1개 재시도
  });

  it("다음: 정상 응답 0건은 재시도하지 않고 기존대로 미노출 행", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "k");
    vi.stubEnv("STABILITY_CELL_RETRY_ENABLED", "1");
    const fetchMock = vi.fn(() => Promise.resolve(json({ documents: [] })));
    vi.stubGlobal("fetch", fetchMock);
    const res = await daumAdapter({
      ...query,
      engineId: "daum",
      brandName: "",
    });
    expect(res.errorMessage).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("네이버: 켜짐이면 401 같은 재시도 불가 실패는 다시 보내지 않는다", async () => {
    vi.stubEnv("NAVER_CLIENT_ID", "i");
    vi.stubEnv("NAVER_CLIENT_SECRET", "s");
    vi.stubEnv("STABILITY_CELL_RETRY_ENABLED", "1");
    const fetchMock = vi.fn(() => Promise.resolve(json({}, 401)));
    vi.stubGlobal("fetch", fetchMock);
    const res = await naverAdapter({ ...query, engineId: "naver" });
    expect(res.errorMessage).toContain("요청 실패");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("네이버: 켜짐이면 네트워크 오류를 1번 다시 시도하고 abort 는 즉시 던진다", async () => {
    vi.stubEnv("NAVER_CLIENT_ID", "i");
    vi.stubEnv("NAVER_CLIENT_SECRET", "s");
    vi.stubEnv("STABILITY_CELL_RETRY_ENABLED", "1");
    const controller = new AbortController();
    const abort = new DOMException("deadline", "AbortError");
    const fetchMock = vi.fn(() => {
      controller.abort(abort);
      return Promise.reject(abort);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      naverAdapter({ ...query, engineId: "naver", signal: controller.signal })
    ).rejects.toThrow("deadline");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
