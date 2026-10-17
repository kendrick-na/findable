import { afterEach, describe, expect, it } from "vitest";

import {
  ConcurrencyProbe,
  FakePool,
  PoolWaitTimeoutError,
} from "./concurrency-probe";
import {
  type FakeClock,
  installFakeClock,
  PLANNED_BREAKER_COOLDOWN_MS,
  PLANNED_RETRY_BACKOFF_MS,
} from "./fake-clock";
import { createMemoryJobStore } from "./memory-job-store";

let clock: FakeClock | undefined;
afterEach(() => {
  clock?.restore();
  clock = undefined;
});

describe("fake clock", () => {
  it("재시도 간격 2초+8초와 쿨다운 120초를 실제로 기다리지 않고 지나간다", async () => {
    clock = installFakeClock(1_000_000);
    const fired: number[] = [];
    for (const ms of [2000, 10_000, 120_000]) {
      setTimeout(() => fired.push(ms), ms);
    }
    await clock.advanceThroughRetryBackoff();
    expect(fired).toEqual([2000, 10_000]);
    expect(clock.now()).toBe(1_000_000 + 10_000);
    await clock.advanceThroughCooldown();
    expect(fired).toEqual([2000, 10_000, 120_000]);
    expect(PLANNED_RETRY_BACKOFF_MS).toEqual([2000, 8000]);
    expect(PLANNED_BREAKER_COOLDOWN_MS).toBe(120_000);
  });

  it("settle 은 끝날 때까지 시계를 밀고, 안 끝나면 실패로 드러낸다", async () => {
    clock = installFakeClock();
    const done = new Promise<string>((resolve) =>
      setTimeout(() => resolve("ok"), 45_000)
    );
    await expect(clock.settle(done)).resolves.toBe("ok");
    const never = new Promise<string>(() => undefined);
    await expect(clock.settle(never, { maxMs: 5000 })).rejects.toThrow(
      "무한 대기 의심"
    );
  });
});

describe("concurrency probe", () => {
  it("전체·고객별 동시 실행 최대치와 시작 순서를 기록한다", () => {
    const probe = new ConcurrencyProbe();
    const exitA1 = probe.enter("A", "A#1");
    const exitA2 = probe.enter("A", "A#2");
    const exitB1 = probe.enter("B", "B#1");
    expect(probe.maxConcurrent).toBe(3);
    expect(probe.maxConcurrentFor("A")).toBe(2);
    exitA1();
    exitA1(); // 두 번 불러도 한 번만 센다
    exitA2();
    exitB1();
    expect(probe.current).toBe(0);
    expect(probe.startOrder).toEqual(["A#1", "A#2", "B#1"]);
  });
});

describe("fake pool", () => {
  it("꽉 차면 줄을 서고, 반납되면 먼저 선 순서대로 받는다", async () => {
    clock = installFakeClock();
    const pool = new FakePool(1, 10_000);
    const order: string[] = [];
    const release = await pool.acquire();
    const second = pool.use(() => {
      order.push("second");
      return Promise.resolve();
    });
    const third = pool.use(() => {
      order.push("third");
      return Promise.resolve();
    });
    expect(pool.waiting).toBe(2);
    release();
    await Promise.all([second, third]);
    expect(order).toEqual(["second", "third"]);
    expect(pool.maxWaiters).toBe(2);
    expect(pool.timeouts).toBe(0);
  });

  it("대기 한도를 넘기면 연결 대기 오류가 나고 횟수가 센다", async () => {
    clock = installFakeClock();
    const pool = new FakePool(1, 5000);
    await pool.acquire(); // 반납하지 않는다
    const waiting = pool.acquire();
    const assertion =
      expect(waiting).rejects.toBeInstanceOf(PoolWaitTimeoutError);
    await clock.advance(5000);
    await assertion;
    expect(pool.timeouts).toBe(1);
    expect(pool.waiting).toBe(0);
  });
});

describe("memory job store", () => {
  it("lease 선점 조건(OR·null·gt/lt)을 러너와 같은 문법으로 해석한다", async () => {
    const store = createMemoryJobStore();
    const db = store.databaseModule().database as {
      auditJob: {
        updateMany: (args: {
          data: Record<string, unknown>;
          where: Record<string, unknown>;
        }) => Promise<{ count: number }>;
      };
    };
    store.seed({
      id: "j1",
      status: "running",
      leaseUntil: new Date(Date.now() + 60_000),
    });
    const claim = {
      where: {
        id: "j1",
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: { leaseToken: "x" },
    };
    expect((await db.auditJob.updateMany(claim)).count).toBe(0);
    store.expireLease("j1");
    expect((await db.auditJob.updateMany(claim)).count).toBe(1);
    expect(store.get("j1").leaseToken).toBe("x");
    expect(store.statusTrail("j1")).toEqual([]);
  });
});
