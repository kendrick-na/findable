import { beforeEach, describe, expect, it, vi } from "vitest";

import { type StabilityLimits, stabilityLimits } from "../stability-flags";
import {
  noteRetryHint,
  resetRetryBudget,
  retryCauseOf,
  runCellGuarded,
} from "./cell-retry";
import { resetEngineBreakers } from "./engine-breaker";
import type { EngineResponse } from "./types";

/**
 * 동시성 429 재현 시험(2026-10-19) — 52곳 측정에서 「429 2건(엔진 불명, 동시 2곳에서)」이 났다.
 * 공급자가 동시 호출 수가 한도(2)를 넘으면 429 를 주는 상황을 가짜로 만들어
 *  ① 429·5xx 가 어느 원인으로 몇 번 재시도됐는지 응답에 기록되고(회복한 칸 포함)
 *  ② 재시도 예산이 바닥나 못 잰 칸은 오류로 남으며(미노출로 세지 않음)
 *  ③ 칸당 최대 재시도·총 예산 안에서만 다시 부르는 것을 확인한다. 실제 호출 없음.
 */
const ok = (engineId = "chatgpt"): EngineResponse => ({
  brandMentioned: false,
  citedSources: [],
  durationMs: 1,
  engineId: engineId as EngineResponse["engineId"],
  errorMessage: null,
  isStub: false,
  mentionListSize: null,
  mentionPosition: null,
  rawResponse: "answer",
  sentiment: null,
  shareOfVoice: null,
});
const fail429 = (): EngineResponse =>
  noteRetryHint(
    { ...ok(), errorMessage: "HTTP 429 rate limit", rawResponse: "" },
    { rateLimited: true, retryable: true, retryAfterMs: 0 }
  );

const limits = (over: Partial<StabilityLimits> = {}): StabilityLimits => ({
  ...stabilityLimits({}),
  cellMaxRetries: 2,
  retryDelaysMs: [0],
  retryTotalShare: 10,
  ...over,
});

beforeEach(() => {
  resetEngineBreakers();
  resetRetryBudget();
});

/** 동시 호출이 `max` 를 넘으면 429 를 주는 공급자. */
function provider(max: number) {
  let inFlight = 0;
  let peak = 0;
  let rejected = 0;
  const call = async (): Promise<EngineResponse> => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    const over = inFlight > max;
    await Promise.resolve();
    await Promise.resolve();
    inFlight -= 1;
    if (over) {
      rejected += 1;
      return fail429();
    }
    return ok();
  };
  return { call, stats: () => ({ peak, rejected }) };
}

describe("동시 호출 한도 초과 429", () => {
  it("8칸을 한꺼번에 보내면 429 가 나고, 재시도로 회복한 칸은 원인 rate_limit 이 기록된다", async () => {
    const p = provider(2);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        runCellGuarded(p.call, {
          breaker: false,
          engineId: "chatgpt",
          limits: limits(),
          retry: true,
          sleep: () => Promise.resolve(),
        })
      )
    );
    expect(p.stats().rejected).toBeGreaterThan(0);
    const recovered = results.filter(
      (r) => !r.errorMessage && (r.retryAttempts ?? 1) > 1
    );
    expect(recovered.length).toBeGreaterThan(0);
    for (const r of recovered) {
      expect(r.retryCauses?.every((c) => c === "rate_limit")).toBe(true);
    }
    // 못 잰 칸이 있다면 반드시 오류로 남는다(답이 빈 채 정상으로 둔갑하지 않는다)
    for (const r of results.filter((x) => !x.rawResponse)) {
      expect(r.errorMessage).toBeTruthy();
    }
  });

  it("칸당 재시도 한도(2)를 넘기지 않는다 — 총 시도 ≤ 3", async () => {
    const calls = vi.fn(() => Promise.resolve(fail429()));
    const out = await runCellGuarded(calls, {
      breaker: false,
      engineId: "chatgpt",
      limits: limits(),
      retry: true,
      sleep: () => Promise.resolve(),
    });
    expect(calls).toHaveBeenCalledTimes(3);
    expect(out.errorMessage).toContain("429");
    expect(out.retryAttempts).toBe(3);
    expect(out.retryCauses).toEqual(["rate_limit", "rate_limit"]);
  });

  it("총 재시도 예산(호출의 20%)이 바닥나면 더 재시도하지 않고 오류로 남긴다", async () => {
    const lim = limits({ retryTotalShare: 0.2 });
    const calls = vi.fn(() => Promise.resolve(fail429()));
    const outs = await Promise.all(
      Array.from({ length: 10 }, () =>
        runCellGuarded(calls, {
          breaker: false,
          engineId: "chatgpt",
          limits: lim,
          retry: true,
          sleep: () => Promise.resolve(),
        })
      )
    );
    expect(outs.every((o) => Boolean(o.errorMessage))).toBe(true);
    // 10칸 × (1 + 재시도) 호출 — 재시도 총합은 max(1, floor(10×0.2)) = 2 를 넘지 않는다
    expect(calls.mock.calls.length).toBeLessThanOrEqual(10 + 2);
  });
});

describe("재시도 원인 분류", () => {
  it("429 / 5xx·과부하 / 빈 응답 / 네트워크", () => {
    expect(retryCauseOf({ rateLimited: true, retryable: true }, "x")).toBe(
      "rate_limit"
    );
    expect(retryCauseOf(undefined, "HTTP 429 too many requests")).toBe(
      "rate_limit"
    );
    expect(retryCauseOf(undefined, "HTTP 503 service unavailable")).toBe(
      "server_error"
    );
    expect(retryCauseOf(undefined, "Anthropic overloaded")).toBe(
      "server_error"
    );
    expect(retryCauseOf(undefined, "returned an empty answer")).toBe("empty");
    expect(retryCauseOf(undefined, "ECONNRESET")).toBe("network");
  });
});
