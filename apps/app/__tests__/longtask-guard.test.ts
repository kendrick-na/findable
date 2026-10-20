/** @vitest-environment node */

// Long-task guard: shared time budget + latency-injected test harness.
// Origin (2026-10-20): the sales discovery ingest wrote ~180 companies one by
// one inside a 120 s server action against a far-away database and was killed
// with no partial result. Tests with a zero-latency fake store always passed.

import { withLatency } from "@repo/observability/testing/latency";
import {
  createTimeBudget,
  runWithinBudget,
} from "@repo/observability/time-budget";
import { describe, expect, it } from "vitest";

function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

describe("createTimeBudget", () => {
  it("reserves a safety margin and reports remaining time", () => {
    const clock = fakeClock(1000);
    const budget = createTimeBudget(90_000, {
      reserveMs: 10_000,
      now: clock.now,
    });
    expect(budget.deadline).toBe(81_000);
    expect(budget.remainingMs()).toBe(80_000);
    expect(budget.expired()).toBe(false);
  });

  it("expires once the clock passes the deadline", async () => {
    const clock = fakeClock();
    const budget = createTimeBudget(100, { now: clock.now });
    await clock.sleep(100);
    expect(budget.expired()).toBe(true);
    expect(budget.remainingMs()).toBe(0);
  });

  it("rejects a reserve that leaves no time", () => {
    expect(() => createTimeBudget(100, { reserveMs: 100 })).toThrow();
  });
});

describe("runWithinBudget", () => {
  it("stops before the deadline and returns where to resume", async () => {
    const clock = fakeClock();
    const budget = createTimeBudget(1000, { now: clock.now });
    const out = await runWithinBudget(
      Array.from({ length: 10 }, (_, i) => i),
      budget,
      async (n) => {
        await clock.sleep(300);
        return n * 2;
      },
      { perItemEstimateMs: 300 }
    );
    // 3 items fit (900 ms); a 4th would cross 1000 ms.
    expect(out).toEqual({
      results: [0, 2, 4],
      processed: 3,
      nextIndex: 3,
      stoppedBy: "budget",
    });
  });

  it("resumes from startIndex and completes", async () => {
    const clock = fakeClock();
    const budget = createTimeBudget(10_000, { now: clock.now });
    const out = await runWithinBudget(
      ["a", "b", "c", "d"],
      budget,
      async (s, i) => {
        await clock.sleep(10);
        return `${i}:${s}`;
      },
      { startIndex: 2 }
    );
    expect(out).toEqual({
      results: ["2:c", "3:d"],
      processed: 2,
      nextIndex: null,
      stoppedBy: "complete",
    });
  });

  it("learns the per-item cost when no estimate is given", async () => {
    const clock = fakeClock();
    const budget = createTimeBudget(1000, { now: clock.now });
    const out = await runWithinBudget(
      Array.from({ length: 10 }, (_, i) => i),
      budget,
      async () => {
        await clock.sleep(400);
      }
    );
    // First item runs blind (400 ms), second fits (800 ms), third would exceed.
    expect(out.processed).toBe(2);
    expect(out.stoppedBy).toBe("budget");
  });

  it("propagates worker errors instead of hiding them", async () => {
    const budget = createTimeBudget(1000);
    await expect(
      runWithinBudget([1], budget, () => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
  });
});

describe("withLatency", () => {
  it("adds latency to every async method and counts calls", async () => {
    const clock = fakeClock();
    const store = {
      find: (id: string) => Promise.resolve({ id }),
      save: (_row: unknown) => Promise.resolve("ok"),
      label: "store",
    };
    const slow = withLatency(store, 200, { sleep: clock.sleep });
    expect(await slow.proxy.find("a")).toEqual({ id: "a" });
    await slow.proxy.save({});
    await slow.proxy.save({});
    expect(clock.now()).toBe(600);
    expect(slow.calls()).toBe(3);
    expect(slow.callsByMethod()).toEqual({ find: 1, save: 2 });
    expect(slow.proxy.label).toBe("store");
  });

  it("catches an N+1 write loop that would blow a 120 s limit", async () => {
    const clock = fakeClock();
    const db = {
      resolve: () => Promise.resolve(null),
      upsert: () => Promise.resolve(),
      fact: () => Promise.resolve(),
    };
    const slow = withLatency(db, 200, { sleep: clock.sleep });
    for (let i = 0; i < 180; i++) {
      await slow.proxy.resolve();
      await slow.proxy.upsert();
      for (let f = 0; f < 4; f++) {
        await slow.proxy.fact();
      }
    }
    // 180 × 6 round trips × 200 ms = 216 s → over 60% of 120 s.
    expect(clock.now()).toBe(216_000);
    expect(clock.now()).toBeGreaterThan(120_000 * 0.6);
    expect(slow.calls() / 180).toBe(6);
  });
});
