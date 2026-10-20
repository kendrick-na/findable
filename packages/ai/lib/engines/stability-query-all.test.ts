import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineQuery, EngineResponse } from "./types";

const answer = (
  engineId: EngineQuery["engineId"],
  text = "Acme answer"
): EngineResponse => ({
  brandMentioned: true,
  citedSources: [],
  durationMs: 10,
  engineId,
  errorMessage: null,
  isStub: false,
  mentionListSize: null,
  mentionPosition: 1,
  rawResponse: text,
  sentiment: null,
  shareOfVoice: null,
});
const failed = (
  engineId: EngineQuery["engineId"],
  message: string
): EngineResponse => ({
  ...answer(engineId, ""),
  brandMentioned: false,
  errorMessage: message,
  mentionPosition: null,
});

const behavior = new Map<
  string,
  (n: number, q: EngineQuery) => Promise<EngineResponse>
>();
const counts = new Map<string, number>();
const run = (query: EngineQuery) => {
  const n = (counts.get(query.engineId) ?? 0) + 1;
  counts.set(query.engineId, n);
  const fn = behavior.get(query.engineId);
  return fn ? fn(n, query) : Promise.resolve(answer(query.engineId));
};

vi.mock("./global-adapters", () => ({
  claudeAdapter: run,
  geminiAdapter: run,
  perplexityAdapter: run,
}));
vi.mock("./korean-adapters", () => ({
  daumAdapter: run,
  hyperclovaAdapter: run,
  naverAdapter: run,
}));

const { queryAllEngines } = await import("./index");
const { resetEngineBreakers } = await import("./engine-breaker");
const { resetRetryBudget } = await import("./cell-retry");

const base = { brandName: "Acme", language: "en" as const, prompt: "p" };
const ENGINES = ["claude", "gemini", "daum"] as const;

beforeEach(() => {
  behavior.clear();
  counts.clear();
  resetEngineBreakers();
  resetRetryBudget();
  vi.stubEnv("STABILITY_RETRY_DELAYS_MS", "0");
  vi.stubEnv("STABILITY_RETRY_TOTAL_SHARE", "10");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("queryAllEngines — 플래그 꺼짐 동일성", () => {
  it("꺼짐: 실패·빈 응답 모두 한 번만 부르고 결과 JSON 이 모의 응답 그대로", async () => {
    const empty = answer("claude", "  ");
    behavior.set("claude", () => Promise.resolve(empty));
    behavior.set("gemini", () => Promise.resolve(failed("gemini", "HTTP 503")));
    const res = await queryAllEngines(base, ENGINES);
    expect(counts.get("gemini")).toBe(1);
    expect(JSON.stringify(res)).toBe(
      JSON.stringify([empty, failed("gemini", "HTTP 503"), answer("daum")])
    );
    expect("retryAttempts" in res[1]).toBe(false);
  });

  it("꺼짐: 연속 실패해도 격리하지 않는다", async () => {
    behavior.set("claude", () => Promise.resolve(failed("claude", "HTTP 500")));
    for (let i = 0; i < 6; i++) {
      await queryAllEngines(base, ["claude"]);
    }
    expect(counts.get("claude")).toBe(6);
  });
});

describe("queryAllEngines — 칸 재시도 켜짐", () => {
  beforeEach(() => {
    vi.stubEnv("STABILITY_CELL_RETRY_ENABLED", "1");
  });

  it("5xx → 성공", async () => {
    behavior.set("gemini", (n) =>
      Promise.resolve(n === 1 ? failed("gemini", "HTTP 503") : answer("gemini"))
    );
    const res = await queryAllEngines(base, ENGINES);
    expect(counts.get("gemini")).toBe(2);
    expect(res[1].errorMessage).toBeNull();
    expect(res[1].retryAttempts).toBe(2);
  });

  it("연속 실패는 1+cellMaxRetries 번 뒤 오류 칸(측정값 없음)", async () => {
    vi.stubEnv("STABILITY_CELL_MAX_RETRIES", "2");
    behavior.set("gemini", () =>
      Promise.resolve(failed("gemini", "fetch failed"))
    );
    const res = await queryAllEngines(base, ["gemini"]);
    expect(counts.get("gemini")).toBe(3);
    expect(res[0].errorMessage).toBe("fetch failed");
    expect(res[0].brandMentioned).toBe(false);
  });

  it("검색 엔진(daum)은 칸 재시도 대상이 아니다(어댑터 쪽 1회 재시도)", async () => {
    behavior.set("daum", () => Promise.resolve(failed("daum", "HTTP 503")));
    await queryAllEngines(base, ["daum"]);
    expect(counts.get("daum")).toBe(1);
  });

  it("타임아웃은 재시도하지 않고 기존처럼 오류 칸", async () => {
    vi.useFakeTimers();
    behavior.set(
      "claude",
      (_n, q) =>
        new Promise<EngineResponse>((_, reject) => {
          q.signal?.addEventListener("abort", () => reject(q.signal?.reason));
        })
    );
    const pending = queryAllEngines(base, ["claude"]);
    await vi.advanceTimersByTimeAsync(61_000);
    const res = await pending;
    vi.useRealTimers();
    expect(counts.get("claude")).toBe(1);
    expect(res[0].errorMessage).toBe("Engine claude timed out after 60000ms");
  });

  it("바깥 abort 면 재시도 없이 오류 칸", async () => {
    const controller = new AbortController();
    behavior.set("claude", () => {
      controller.abort(new DOMException("deadline", "AbortError"));
      return Promise.reject(new DOMException("deadline", "AbortError"));
    });
    const res = await queryAllEngines({ ...base, signal: controller.signal }, [
      "claude",
    ]);
    expect(counts.get("claude")).toBe(1);
    expect(res[0].errorMessage).toBe("deadline");
  });

  it("늦은 칸 다시 묻기(options.timeoutMs)에는 재시도를 겹치지 않는다", async () => {
    behavior.set("claude", () => Promise.resolve(failed("claude", "HTTP 503")));
    await queryAllEngines(base, ["claude"], undefined, { timeoutMs: 200_000 });
    expect(counts.get("claude")).toBe(1);
  });
});

describe("queryAllEngines — 서킷브레이커 켜짐", () => {
  it("임계 연속 실패 뒤 격리되어 어댑터를 부르지 않고, 다른 엔진은 정상", async () => {
    vi.stubEnv("STABILITY_ENGINE_BREAKER_ENABLED", "1");
    vi.stubEnv("STABILITY_BREAKER_FAIL_THRESHOLD", "3");
    behavior.set("claude", () => Promise.resolve(failed("claude", "HTTP 500")));
    for (let i = 0; i < 3; i++) {
      await queryAllEngines(base, ["claude", "gemini"]);
    }
    const res = await queryAllEngines(base, ["claude", "gemini"]);
    expect(counts.get("claude")).toBe(3);
    expect(counts.get("gemini")).toBe(4);
    expect(res[0].errorMessage).toBe(
      "Engine claude paused: consecutive failures"
    );
    expect(res[0].brandMentioned).toBe(false);
    expect(res[1].errorMessage).toBeNull();
  });
});
