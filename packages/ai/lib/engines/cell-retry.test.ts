import { beforeEach, describe, expect, it, vi } from "vitest";

import { type StabilityLimits, stabilityLimits } from "../stability-flags";
import {
  classifyRetryable,
  mergeUsage,
  noteRetryHint,
  resetRetryBudget,
  retryBudgetSnapshot,
  retryDelayMs,
  runCellGuarded,
} from "./cell-retry";
import { resetEngineBreakers } from "./engine-breaker";
import type { EngineResponse, EngineUsage } from "./types";

const base = (over: Partial<EngineResponse> = {}): EngineResponse => ({
  brandMentioned: false,
  citedSources: [],
  durationMs: 1,
  engineId: "claude",
  errorMessage: null,
  isStub: false,
  mentionListSize: null,
  mentionPosition: null,
  rawResponse: "answer",
  sentiment: null,
  shareOfVoice: null,
  ...over,
});
const failure = (message: string, over: Partial<EngineResponse> = {}) =>
  base({ errorMessage: message, rawResponse: "", ...over });

const limits = (over: Partial<StabilityLimits> = {}): StabilityLimits => ({
  ...stabilityLimits({}),
  cellMaxRetries: 2,
  retryDelaysMs: [2000, 8000],
  retryTotalShare: 10,
  ...over,
});

const sleepSpy = () =>
  vi.fn((_ms: number, _signal?: AbortSignal) => Promise.resolve());

beforeEach(() => {
  resetEngineBreakers();
  resetRetryBudget();
});

describe("runCellGuarded — 재시도", () => {
  it("429(Retry-After 있음)→성공: 2번 호출, retryAttempts 기록", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(
        noteRetryHint(failure("rate limit 429"), {
          rateLimited: true,
          retryable: true,
          retryAfterMs: 1000,
        })
      )
      .mockResolvedValueOnce(base());
    const sleep = sleepSpy();
    const res = await runCellGuarded(call, {
      breaker: false,
      engineId: "claude",
      limits: limits(),
      retry: true,
      sleep,
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(res.errorMessage).toBeNull();
    expect(res.retryAttempts).toBe(2);
    expect(sleep.mock.calls[0]?.[0]).toBe(1000);
  });

  it("5xx→성공(메시지 분류, 힌트 없음)", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(failure("Perplexity Agent API 503: down"))
      .mockResolvedValueOnce(base());
    const res = await runCellGuarded(call, {
      breaker: false,
      engineId: "claude",
      limits: limits(),
      retry: true,
      sleep: sleepSpy(),
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(res.errorMessage).toBeNull();
  });

  it("연속 실패는 정확히 1+N번 호출 후 오류 칸으로 남고 측정값을 만들지 않는다", async () => {
    const call = vi.fn().mockResolvedValue(failure("fetch failed"));
    const res = await runCellGuarded(call, {
      breaker: false,
      engineId: "claude",
      limits: limits({ cellMaxRetries: 2 }),
      retry: true,
      sleep: sleepSpy(),
    });
    expect(call).toHaveBeenCalledTimes(3);
    expect(res.errorMessage).toBe("fetch failed");
    expect(res.brandMentioned).toBe(false);
    expect(res.mentionQuality).toBeUndefined();
    expect(res.rawResponse).toBe("");
    expect(res.retryAttempts).toBe(3);
  });

  it("cellMaxRetries=1 이면 총 2번", async () => {
    const call = vi.fn().mockResolvedValue(failure("fetch failed"));
    await runCellGuarded(call, {
      breaker: false,
      engineId: "claude",
      limits: limits({ cellMaxRetries: 1 }),
      retry: true,
      sleep: sleepSpy(),
    });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("재시도 불가 오류(401·일반 오류)는 재시도하지 않는다", async () => {
    const call = vi.fn().mockResolvedValue(failure("HTTP 401 unauthorized"));
    await runCellGuarded(call, {
      breaker: false,
      engineId: "claude",
      limits: limits(),
      retry: true,
      sleep: sleepSpy(),
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("Retry-After 없는 429 는 기본으로 재시도하지 않고, 설정이 켜지면 한다", async () => {
    const make = () =>
      vi
        .fn()
        .mockResolvedValueOnce(failure("429 too many requests"))
        .mockResolvedValueOnce(base());
    const off = make();
    await runCellGuarded(off, {
      breaker: false,
      engineId: "claude",
      limits: limits({ retryOn429WithoutRetryAfter: false }),
      retry: true,
      sleep: sleepSpy(),
    });
    expect(off).toHaveBeenCalledTimes(1);
    resetRetryBudget();
    const on = make();
    await runCellGuarded(on, {
      breaker: false,
      engineId: "claude",
      limits: limits({ retryOn429WithoutRetryAfter: true }),
      retry: true,
      sleep: sleepSpy(),
    });
    expect(on).toHaveBeenCalledTimes(2);
  });

  it("타임아웃 응답/예외는 재시도하지 않는다", async () => {
    const callResp = vi
      .fn()
      .mockResolvedValue(failure("Engine claude timed out after 60000ms"));
    await runCellGuarded(callResp, {
      breaker: false,
      engineId: "claude",
      limits: limits(),
      retry: true,
      sleep: sleepSpy(),
    });
    expect(callResp).toHaveBeenCalledTimes(1);
    const callThrow = vi
      .fn()
      .mockRejectedValue(new Error("Engine claude timed out after 60000ms"));
    await expect(
      runCellGuarded(callThrow, {
        breaker: false,
        engineId: "claude",
        limits: limits(),
        retry: true,
        sleep: sleepSpy(),
      })
    ).rejects.toThrow("timed out");
    expect(callThrow).toHaveBeenCalledTimes(1);
  });

  it("던져진 네트워크 오류는 재시도하고, 소진되면 그대로 던진다", async () => {
    const call = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(
      runCellGuarded(call, {
        breaker: false,
        engineId: "claude",
        limits: limits({ cellMaxRetries: 2 }),
        retry: true,
        sleep: sleepSpy(),
      })
    ).rejects.toThrow("ECONNRESET");
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("대기 중 바깥 abort 가 오면 즉시 중단(더 부르지 않음)", async () => {
    const controller = new AbortController();
    const call = vi.fn().mockResolvedValue(failure("HTTP 503", {}));
    const promise = runCellGuarded(call, {
      breaker: false,
      engineId: "claude",
      limits: limits({ retryDelaysMs: [60_000] }),
      retry: true,
      signal: controller.signal,
    });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(new DOMException("deadline", "AbortError"));
    await expect(promise).rejects.toThrow("deadline");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("호출 도중 abort 면 재시도하지 않는다", async () => {
    const controller = new AbortController();
    const call = vi.fn(() => {
      controller.abort(new DOMException("deadline", "AbortError"));
      return Promise.resolve(failure("HTTP 503"));
    });
    const res = await runCellGuarded(call, {
      breaker: false,
      engineId: "claude",
      limits: limits(),
      retry: true,
      signal: controller.signal,
      sleep: sleepSpy(),
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(res.errorMessage).toBe("HTTP 503");
  });

  it("총 재시도 예산: 호출 수×비율을 넘기면 재시도하지 않되, 최소 1회는 보장", async () => {
    const lim = limits({ retryTotalShare: 0.2, cellMaxRetries: 1 });
    const run = () =>
      runCellGuarded(vi.fn().mockResolvedValue(failure("fetch failed")), {
        breaker: false,
        engineId: "claude",
        limits: lim,
        retry: true,
        sleep: sleepSpy(),
      });
    // 첫 호출: calls=1 → floor(0.2)=0 → max(1,0)=1 → 최소 보장으로 재시도 1회
    await run();
    expect(retryBudgetSnapshot()).toEqual({ calls: 1, retries: 1 });
    // 2~4번째: 한도 1 → 재시도 없음
    await run();
    await run();
    await run();
    expect(retryBudgetSnapshot()).toEqual({ calls: 4, retries: 1 });
    // 10번째 호출: floor(10×0.2)=2 → 두 번째 재시도 허용
    for (let i = 0; i < 6; i++) {
      await run();
    }
    expect(retryBudgetSnapshot()).toEqual({ calls: 10, retries: 2 });
  });

  it("비용: 시도 간 usage 합산, 마지막 표식 유지", async () => {
    const usage = (i: number, o: number, usd?: number): EngineUsage => ({
      costModel: "token",
      inputTokens: i,
      outputTokens: o,
      ...(usd === undefined ? {} : { providerCostUsd: usd }),
    });
    const call = vi
      .fn()
      .mockResolvedValueOnce(
        noteRetryHint(
          failure("Engine claude returned an empty answer", {
            usage: usage(100, 0, 0.01),
          }),
          { retryable: true }
        )
      )
      .mockResolvedValueOnce(base({ usage: usage(120, 50, 0.02) }));
    const res = await runCellGuarded(call, {
      breaker: false,
      engineId: "claude",
      limits: limits(),
      retry: true,
      sleep: sleepSpy(),
    });
    expect(res.usage?.inputTokens).toBe(220);
    expect(res.usage?.outputTokens).toBe(50);
    expect(res.usage?.providerCostUsd).toBeCloseTo(0.03);
    expect(res.retryAttempts).toBe(2);
  });

  it("재시도가 없으면 응답 객체를 그대로 돌려준다(필드 추가 없음)", async () => {
    const ok = base();
    const res = await runCellGuarded(vi.fn().mockResolvedValue(ok), {
      breaker: true,
      engineId: "claude",
      limits: limits(),
      retry: true,
      sleep: sleepSpy(),
    });
    expect(res).toBe(ok);
    expect("retryAttempts" in res).toBe(false);
  });
});

describe("retryDelayMs / mergeUsage / classifyRetryable", () => {
  it("지터는 ±20% 범위", () => {
    const lim = limits({ retryDelaysMs: [2000] });
    expect(retryDelayMs(0, undefined, lim, () => 0)).toBe(1600);
    expect(retryDelayMs(0, undefined, lim, () => 0.5)).toBe(2000);
    expect(retryDelayMs(0, undefined, lim, () => 1)).toBe(2400);
    // 목록이 모자라면 마지막 값
    expect(retryDelayMs(5, undefined, lim, () => 0.5)).toBe(2000);
  });

  it("Retry-After 는 따르되 상한 이하, 지터 없음", () => {
    const lim = limits({ retryAfterCapMs: 15_000 });
    expect(
      retryDelayMs(0, { retryable: true, retryAfterMs: 3000 }, lim, () => 0)
    ).toBe(3000);
    expect(
      retryDelayMs(0, { retryable: true, retryAfterMs: 120_000 }, lim, () => 0)
    ).toBe(15_000);
  });

  it("합산: 이전 시도가 없으면 그대로, 숫자가 없으면 null 유지", () => {
    const u: EngineUsage = {
      costModel: "token",
      inputTokens: null,
      outputTokens: null,
    };
    expect(mergeUsage([], u)).toBe(u);
    expect(mergeUsage([u], u)?.inputTokens).toBeNull();
    expect(mergeUsage([{ ...u, inputTokens: 5 }], undefined)?.inputTokens).toBe(
      5
    );
  });

  it("SDK 오류에서 상태·Retry-After 를 읽는다", () => {
    expect(
      classifyRetryable({
        statusCode: 429,
        responseHeaders: { "retry-after": "7" },
      })
    ).toEqual({ rateLimited: true, retryable: true, retryAfterMs: 7000 });
    expect(classifyRetryable({ statusCode: 503 }).retryable).toBe(true);
    expect(classifyRetryable({ statusCode: 400 }).retryable).toBe(false);
    expect(classifyRetryable(new Error("fetch failed")).retryable).toBe(true);
    expect(classifyRetryable(new Error("invalid schema")).retryable).toBe(
      false
    );
  });
});

describe("runCellGuarded — 서킷브레이커", () => {
  const opts = (engineId: "claude" | "gemini", now: () => number) => ({
    breaker: true,
    engineId,
    limits: limits({ breakerCooldownMs: 1000, breakerFailThreshold: 3 }),
    now,
    retry: false,
  });

  it("연속 최종 실패가 임계에 닿으면 격리, 쿨다운 뒤 반열림 시험, 성공하면 닫힘, 다른 엔진은 무영향", async () => {
    let t = 0;
    const now = () => t;
    const bad = vi.fn().mockResolvedValue(failure("HTTP 500"));
    for (let i = 0; i < 3; i++) {
      await runCellGuarded(bad, opts("claude", now));
    }
    expect(bad).toHaveBeenCalledTimes(3);
    // 격리: 호출하지 않고 고정 문구로 던진다
    await expect(runCellGuarded(bad, opts("claude", now))).rejects.toThrow(
      "Engine claude paused: consecutive failures"
    );
    expect(bad).toHaveBeenCalledTimes(3);
    // 다른 엔진은 영향 없음
    const good = vi.fn().mockResolvedValue(base({ engineId: "gemini" }));
    await runCellGuarded(good, opts("gemini", now));
    expect(good).toHaveBeenCalledTimes(1);
    // 쿨다운 뒤 시험 1회만 통과(동시 두 번째는 격리)
    t = 1500;
    let release: (r: EngineResponse) => void = () => undefined;
    const probe = vi.fn(
      () =>
        new Promise<EngineResponse>((resolve) => {
          release = resolve;
        })
    );
    const probing = runCellGuarded(probe, opts("claude", now));
    await expect(runCellGuarded(bad, opts("claude", now))).rejects.toThrow(
      "paused"
    );
    release(base());
    await probing;
    // 성공 → 닫힘
    const after = vi.fn().mockResolvedValue(base());
    await runCellGuarded(after, opts("claude", now));
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("반열림 시험이 실패하면 다시 격리", async () => {
    let t = 0;
    const now = () => t;
    const bad = vi.fn().mockResolvedValue(failure("HTTP 500"));
    for (let i = 0; i < 3; i++) {
      await runCellGuarded(bad, opts("claude", now));
    }
    t = 2000;
    await runCellGuarded(bad, opts("claude", now)); // 시험(실패)
    expect(bad).toHaveBeenCalledTimes(4);
    await expect(runCellGuarded(bad, opts("claude", now))).rejects.toThrow(
      "paused"
    );
  });

  it("성공이 끼면 연속 횟수가 0 으로 돌아가고, 타임아웃은 세지 않는다", async () => {
    const now = () => 0;
    const bad = vi.fn().mockResolvedValue(failure("HTTP 500"));
    const slow = vi
      .fn()
      .mockResolvedValue(failure("Engine claude timed out after 60000ms"));
    const good = vi.fn().mockResolvedValue(base());
    await runCellGuarded(bad, opts("claude", now));
    await runCellGuarded(bad, opts("claude", now));
    await runCellGuarded(good, opts("claude", now));
    await runCellGuarded(bad, opts("claude", now));
    await runCellGuarded(bad, opts("claude", now));
    for (let i = 0; i < 5; i++) {
      await runCellGuarded(slow, opts("claude", now));
    }
    await runCellGuarded(bad, opts("claude", now)); // 3번째 연속 → 이제 격리
    await expect(runCellGuarded(bad, opts("claude", now))).rejects.toThrow(
      "paused"
    );
  });
});
