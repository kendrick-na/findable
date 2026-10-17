// U5 — 동시 실행 계측기 + 가짜 DB 연결 풀(T1용).
//
// T1 은 「동시에 몇 개가 도는가 / 누가 먼저 시작하는가 / 연결 대기에서 오류가 나는가」를 본다.
// 실제 풀·입장 관리(U2)가 없어도 계측 틀은 먼저 시험해 둘 수 있게 독립시켰다.
// 시간은 Date.now / setTimeout 을 쓰므로 가짜 시계(fake-clock.ts) 위에서 정확히 재현된다.

export interface ProbeEvent {
  at: number;
  kind: "enter" | "exit";
  /** 고객 등 묶음 키(예: "A"). */
  owner: string;
  /** 작업 식별자(예: "A#3"). */
  task: string;
}

/** 동시 실행 수 기록. enter() 가 돌려준 함수를 끝날 때 호출한다. */
export class ConcurrencyProbe {
  readonly events: ProbeEvent[] = [];
  private active = 0;
  private peak = 0;
  private readonly activeByOwner = new Map<string, number>();
  private readonly peakByOwner = new Map<string, number>();

  enter(owner: string, task: string): () => void {
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    const ownerNow = (this.activeByOwner.get(owner) ?? 0) + 1;
    this.activeByOwner.set(owner, ownerNow);
    this.peakByOwner.set(
      owner,
      Math.max(this.peakByOwner.get(owner) ?? 0, ownerNow)
    );
    this.events.push({ at: Date.now(), kind: "enter", owner, task });
    let exited = false;
    return () => {
      if (exited) {
        return;
      }
      exited = true;
      this.active -= 1;
      this.activeByOwner.set(owner, (this.activeByOwner.get(owner) ?? 1) - 1);
      this.events.push({ at: Date.now(), kind: "exit", owner, task });
    };
  }

  get current(): number {
    return this.active;
  }

  /** 전체 동시 실행 최대치. */
  get maxConcurrent(): number {
    return this.peak;
  }

  /** 고객별 동시 실행 최대치. */
  maxConcurrentFor(owner: string): number {
    return this.peakByOwner.get(owner) ?? 0;
  }

  /** 시작(enter) 시각. 작업 식별자 → ms. */
  startedAt(task: string): number | undefined {
    return this.events.find((e) => e.kind === "enter" && e.task === task)?.at;
  }

  /** 시작 순서(작업 식별자). */
  get startOrder(): string[] {
    return this.events.filter((e) => e.kind === "enter").map((e) => e.task);
  }

  /** 고객별 첫 시작 시각 − 기준 시각(대기 시간). 한 번도 시작 못 했으면 undefined. */
  waitMs(owner: string, sinceMs: number): number | undefined {
    const first = this.events.find(
      (e) => e.kind === "enter" && e.owner === owner
    );
    return first ? first.at - sinceMs : undefined;
  }
}

export class PoolWaitTimeoutError extends Error {
  constructor(waitedMs: number) {
    super(`DB connection wait timeout after ${waitedMs}ms`);
    this.name = "PoolWaitTimeoutError";
  }
}

/**
 * 크기 제한이 있는 가짜 DB 연결 풀. 꽉 차면 줄을 선다(FIFO).
 * waitTimeoutMs 안에 못 받으면 PoolWaitTimeoutError — 운영의 「연결 대기 오류」를 흉내 낸다.
 * timeouts 가 0 이어야 T1 합격이다.
 */
export class FakePool {
  readonly size: number;
  readonly waitTimeoutMs: number;
  timeouts = 0;
  maxWaiters = 0;
  maxInUse = 0;
  private inUse = 0;
  private readonly waiters: Array<{ grant: () => void }> = [];

  constructor(size: number, waitTimeoutMs = 10_000) {
    this.size = size;
    this.waitTimeoutMs = waitTimeoutMs;
  }

  get busy(): number {
    return this.inUse;
  }

  get waiting(): number {
    return this.waiters.length;
  }

  /** 연결 1개를 빌린다. 돌려준 release 를 반드시 부른다. */
  acquire(): Promise<() => void> {
    if (this.inUse < this.size) {
      return Promise.resolve(this.take());
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        grant: () => {
          clearTimeout(timer);
          resolve(this.take());
        },
      };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        this.timeouts += 1;
        reject(new PoolWaitTimeoutError(this.waitTimeoutMs));
      }, this.waitTimeoutMs);
      this.waiters.push(waiter);
      this.maxWaiters = Math.max(this.maxWaiters, this.waiters.length);
    });
  }

  /** 연결을 빌려 fn 을 실행하고 반드시 돌려준다. */
  async use<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private take(): () => void {
    this.inUse += 1;
    this.maxInUse = Math.max(this.maxInUse, this.inUse);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.inUse -= 1;
      this.waiters.shift()?.grant();
    };
  }
}
