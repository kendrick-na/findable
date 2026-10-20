// biome-ignore-all lint/suspicious/useAwait: 모의 DB 는 async 시그니처만 맞춘다
/**
 * U5 2단계 — T1 동시 폭주(U2 입장 관리·대기 줄 일꾼).
 *
 * 진짜 코드: decideAdmission(시작 판정) · runAuditQueueTick(일꾼) · cron 라우트 · isStaleAuditJob(30분 규칙).
 * 모의: DB(메모리, 상태가 실제로 바뀜, DB 연결 풀 1~2개짜리 FakePool 을 거친다) · runAuditJob(선점→가짜 시간만큼 실행→완료).
 * 시계는 가짜(1분마다 cron 이 한 번 돈다 = 운영의 1분 간격 cron). 운영 호출·DB 0.
 *
 * 사람: 고객 A 20건 · B 1 · C 1 + 내부 조직 2 + 무료 3 이 같은 순간에 시작.
 * 「시작」은 각 요청이 판정→선점까지 직렬로 끝나는 것으로 본다(요청 간격 0.2초). 진짜 동시 판정 경합은
 * stability-t1-admission-race.bug.test.ts(기본 skip)에 재현법을 둔다.
 *
 * @vitest-environment node
 */
import {
  ConcurrencyProbe,
  FakePool,
} from "@repo/audit/test-harness/concurrency-probe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Job {
  attemptStartedAt: Date | null;
  brandId: string | null;
  createdAt: Date;
  domain: string;
  email: string;
  errorMessage?: string;
  id: string;
  language: "ko";
  /** 슬롯 예약 표식(`admit:…`) 또는 러너 토큰 — queued job 의 예약 표시. */
  leaseToken?: string | null;
  leaseUntil: Date | null;
  organizationId: string | null;
  owner: string;
  status: "queued" | "processing" | "failed" | "completed";
}

const m = vi.hoisted(() => ({
  jobs: [] as unknown[],
  plans: {} as Record<string, string>,
  pool: null as unknown,
  durations: {} as Record<string, number>,
  probe: null as unknown,
  getCurrentPlan: vi.fn(),
  claimed: [] as string[],
}));
const jobs = () => m.jobs as Job[];
const pool = () => m.pool as FakePool;
const probe = () => m.probe as ConcurrencyProbe;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
// 모든 DB 호출은 연결 1개를 빌려 20ms 걸린다. 풀이 작으면 줄을 서고, 10초 넘게 못 빌리면 연결 대기 오류(timeouts).
const db = <T>(fn: () => T): Promise<T> =>
  pool().use(async () => {
    await sleep(20);
    return fn();
  });

const RESERVED = "admit:";
const RESERVATION_TTL = 90_000;
const isReserved = (j: Job) =>
  j.status === "queued" && Boolean(j.leaseToken?.startsWith(RESERVED));
// 대기 줄 조회는 예약 건을 뺀다(notReservedWhere).
const isWaiting = (j: Job) =>
  j.status === "queued" &&
  j.leaseUntil === null &&
  j.organizationId !== null &&
  j.brandId !== null &&
  !isReserved(j);

interface UpdateArgs {
  data: Record<string, unknown>;
  where: Record<string, unknown> & {
    attemptStartedAt?: { lt: Date };
    createdAt?: { lt: Date };
    id?: string;
    leaseToken?: { startsWith: string };
    status?: string;
  };
}

// ── 가짜 DB 동작(풀을 빌리는 쪽과 트랜잭션 안(이미 연결을 쥔 쪽)이 같이 쓴다) ──
const updateManyImpl = ({ where, data }: UpdateArgs) => {
  // ① 슬롯 예약 표식 찍기: where { id, status: "queued" }, data.leaseToken = "admit:…"
  if (
    where.id &&
    where.status === "queued" &&
    typeof data.leaseToken === "string"
  ) {
    const job = jobs().find((j) => j.id === where.id && j.status === "queued");
    if (job) {
      Object.assign(job, data);
    }
    return { count: job ? 1 : 0 };
  }
  // ② 시작하지 못한 예약 되돌리기
  if (where.leaseToken?.startsWith && where.attemptStartedAt) {
    const before = where.attemptStartedAt.lt;
    const hit = jobs().filter(
      (j) => isReserved(j) && (j.attemptStartedAt ?? new Date(0)) < before
    );
    for (const j of hit) {
      Object.assign(j, data);
    }
    return { count: hit.length };
  }
  // ③ 기존: 대기 만료·heartbeat
  const hit = jobs().filter(
    (j) =>
      isWaiting(j) &&
      (!where.id || j.id === where.id) &&
      (!where.createdAt || j.createdAt < where.createdAt.lt)
  );
  for (const j of hit) {
    Object.assign(j, data);
  }
  return { count: hit.length };
};
const findManyImpl = ({ where }: { where: { leaseUntil: unknown } }) => {
  const waiting = where.leaseUntil === null;
  return jobs()
    .filter((j) =>
      waiting
        ? isWaiting(j)
        : j.status === "queued" &&
          j.leaseUntil !== null &&
          j.organizationId !== null &&
          !isReserved(j)
    )
    .sort((a, b) =>
      waiting
        ? a.createdAt.getTime() - b.createdAt.getTime()
        : (a.attemptStartedAt ?? a.createdAt).getTime() -
          (b.attemptStartedAt ?? b.createdAt).getTime()
    );
};
// 점유 = 실행 중 + 유효한 예약(loadRunningCounts 와 같은 정의).
const groupByImpl = () => {
  const by = new Map<string, number>();
  const now = Date.now();
  const occupied = jobs().filter(
    (j) =>
      j.status === "processing" ||
      (isReserved(j) &&
        (j.attemptStartedAt?.getTime() ?? 0) > now - RESERVATION_TTL)
  );
  for (const j of occupied) {
    by.set(j.email, (by.get(j.email) ?? 0) + 1);
  }
  return [...by].map(([email, n]) => ({ email, _count: { _all: n } }));
};
// 어드바이저리 잠금 대역: 트랜잭션을 한 줄로 세운다(진짜는 Postgres 잠금 — audit-queue-reservation-postgres.test.ts 가 증명).
let txTail: Promise<unknown> = Promise.resolve();
const inTx = <T>(fn: () => T): Promise<T> => sleep(5).then(fn); // 이미 연결을 쥐고 있으므로 풀을 또 빌리지 않는다

vi.mock("@repo/database", () => ({
  database: {
    organization: {
      findMany: () =>
        db(() => Object.entries(m.plans).map(([id, plan]) => ({ id, plan }))),
    },
    brand: {
      findUnique: () =>
        db(() => ({
          name: "브랜드",
          entityVariants: [],
          industry: "beauty",
          marketScope: "korea",
        })),
    },
    auditJob: {
      updateMany: (args: UpdateArgs) => db(() => updateManyImpl(args)),
      findMany: (args: { where: { leaseUntil: unknown } }) =>
        db(() => findManyImpl(args)),
      groupBy: () => db(() => groupByImpl()),
    },
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const run = txTail.then(() =>
        pool().use(async () =>
          fn({
            $executeRaw: async () => 0,
            auditJob: {
              updateMany: (args: UpdateArgs) =>
                inTx(() => updateManyImpl(args)),
              groupBy: () => inTx(() => groupByImpl()),
            },
          })
        )
      );
      txTail = run.catch(() => undefined);
      return run as Promise<T>;
    },
  },
}));

// 러너 대역: 원자적 선점(queued→processing) → 가짜 시간 실행 → 완료. 선점에 진 쪽은 즉시 끝난다(claim_skipped).
vi.mock("@repo/audit/runner", () => ({
  runAuditJob: async (input: { jobId: string }) => {
    await db(() => undefined);
    const job = jobs().find((j) => j.id === input.jobId);
    if (!job || job.status !== "queued") {
      return;
    }
    job.status = "processing"; // 확인과 변경 사이에 await 가 없다 = 원자적
    job.leaseToken = `run:${job.id}`; // 선점이 예약 표식을 덮는다(예약 → 실행 중으로 이어짐)
    job.attemptStartedAt = new Date();
    job.leaseUntil = new Date(Date.now() + 6 * 60_000);
    m.claimed.push(job.id);
    const exit = probe().enter(job.owner, job.id);
    await sleep(m.durations[job.owner] ?? 3 * 60_000);
    job.status = "completed";
    job.leaseUntil = null;
    exit();
  },
}));
// 이어가기 대역: 실제 continueAuditJob 도 결국 러너의 선점(claim)을 거쳐 남은 질문을 실행한다.
vi.mock("@repo/audit/audit-continuation", () => ({
  continueAuditJob: async (id: string) => {
    const { runAuditJob: run } = await import("@repo/audit/runner");
    await run({ jobId: id } as never);
    return { ran: true };
  },
}));
vi.mock("@repo/audit/brand-setup", () => ({
  loadSetupReadinessRecord: async () => undefined,
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/i18n", () => ({
  getAppDictionary: async () => ({
    brandErrors: { measureStartFailed: "MSF" },
  }),
}));
vi.mock("@repo/auth/plan-server", () => ({
  getCurrentPlan: (...args: unknown[]) => m.getCurrentPlan(...args),
}));

import { isStaleAuditJob } from "@repo/audit/stale-job";
import { SALES_INTERNAL_ORG_ID } from "@repo/database/internal-orgs";
import { GET } from "../app/api/cron/audit-queue/route";
import { admitJob } from "../lib/audit-queue/slot-reservation";
import { startGate } from "../lib/audit-queue/start-gate";
import { runAuditQueueTick } from "../lib/audit-queue/worker";

const { runAuditJob } = await import("@repo/audit/runner");

const T0 = new Date("2026-10-18T09:00:00+09:00");
const MIN = 60_000;
let seq = 0;

const addJob = (owner: string, org: string | null, ageMs: number): Job => {
  seq += 1;
  const job: Job = {
    id: `${owner}#${seq}`,
    owner,
    email: org ? `org:${org}` : `free${seq}@x.com`,
    organizationId: org,
    brandId: org ? `b-${owner}-${seq}` : null,
    domain: `${owner}${seq}.com`,
    language: "ko",
    status: "queued",
    leaseUntil: null,
    attemptStartedAt: null,
    createdAt: new Date(T0.getTime() - ageMs),
  };
  jobs().push(job);
  return job;
};

/** 가짜 시계를 조금씩 밀며 promise 가 끝나길 기다린다(DB 대기 20ms 짜리 타이머가 돌아야 끝난다). */
const settle = async <T>(promise: Promise<T>): Promise<T> => {
  let done = false;
  promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    }
  );
  for (let i = 0; i < 5000 && !done; i++) {
    await vi.advanceTimersByTimeAsync(10);
  }
  return await promise;
};

/** 시작 요청 1건: 판정 → (start 면) 바로 선점·실행. 대기면 queued 로 남긴다. 요청 간격 0.2초. */
const startRequest = async (job: Job) => {
  if (job.organizationId) {
    const decision = await settle(
      admitJob({
        jobId: job.id,
        orgId: job.organizationId,
        plan: m.plans[job.organizationId],
      })
    );
    if (decision === "start") {
      runAuditJob({ jobId: job.id, domain: job.domain, language: "ko" }).catch(
        () => undefined
      );
    }
  } else {
    runAuditJob({ jobId: job.id, domain: job.domain, language: "ko" }).catch(
      () => undefined
    ); // 무료 진단: 입장 관리 대상 아님(항상 바로 시작)
  }
  await vi.advanceTimersByTimeAsync(200);
};

const startAll = async () => {
  const order: [string, string | null, number][] = [
    ...[1, 2, 3].map((): [string, string | null, number] => ["free", null, 0]),
    ...[1, 2].map((): [string, string | null, number] => [
      "internal",
      SALES_INTERNAL_ORG_ID,
      0,
    ]),
    ...Array.from({ length: 20 }, (): [string, string | null, number] => [
      "A",
      "A",
      0,
    ]),
    ["B", "B", 0],
    ["C", "C", 0],
  ];
  const created = order.map(([owner, org], index) => {
    const job = addJob(owner, org, 0);
    job.createdAt = new Date(T0.getTime() + index * 1000); // A 가 B·C 보다 먼저 줄을 섰다
    return job;
  });
  for (const job of created) {
    await startRequest(job);
  }
  return created;
};

interface Observed {
  maxGlobalProcessing: number;
  queuedStale: string[];
  tickErrors: unknown[];
}

/** 1분마다 일꾼 cron 이 한 번 돈다(안 기다린다 — 함수 1개는 작업 1건이 끝날 때까지 산다). 전부 끝나면 멈춘다. */
const drain = async (all: Job[], maxMinutes = 300): Promise<Observed> => {
  const observed: Observed = {
    maxGlobalProcessing: 0,
    queuedStale: [],
    tickErrors: [],
  };
  for (let minute = 0; minute < maxMinutes; minute++) {
    runAuditQueueTick(Date.now(), new Date()).catch((error) =>
      observed.tickErrors.push(error)
    );
    await vi.advanceTimersByTimeAsync(MIN);
    const processing = jobs().filter((j) => j.status === "processing").length;
    observed.maxGlobalProcessing = Math.max(
      observed.maxGlobalProcessing,
      processing
    );
    for (const j of all) {
      if (
        j.status === "queued" &&
        isStaleAuditJob(
          {
            createdAt: j.createdAt,
            attemptStartedAt: j.attemptStartedAt,
            leaseUntil: j.leaseUntil,
            status: j.status,
          },
          Date.now()
        )
      ) {
        observed.queuedStale.push(j.id);
      }
    }
    if (all.every((j) => j.status === "completed" || j.status === "failed")) {
      break;
    }
  }
  return observed;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  m.jobs.length = 0;
  m.plans = {};
  m.claimed.length = 0;
  m.durations = {
    A: 3 * MIN,
    B: 3 * MIN,
    C: 3 * MIN,
    internal: 2 * MIN,
    free: 2 * MIN,
  };
  m.probe = new ConcurrencyProbe();
  m.getCurrentPlan.mockReset().mockResolvedValue("growth");
  seq = 0;
  vi.stubEnv("STABILITY_ADMISSION_ENABLED", "1");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe.each([
  { plan: "growth", orgCap: 2, poolSize: 1 },
  { plan: "growth", orgCap: 2, poolSize: 2 },
  { plan: "starter", orgCap: 1, poolSize: 1 },
  { plan: "starter", orgCap: 1, poolSize: 2 },
])("T1 고객 3곳 폭주 — A 플랜 $plan(고객별 상한 $orgCap) · DB 연결 풀 $poolSize", ({
  plan,
  orgCap,
  poolSize,
}) => {
  beforeEach(() => {
    m.pool = new FakePool(poolSize);
    m.plans = { A: plan, B: "growth", C: "growth" };
  });

  it("동시 실행 ≤ 상한, A 독점 불가, B·C 가 A 의 20건에 밀리지 않고, 대기가 30분 규칙에 안 걸리며, 연결 대기 오류 0", async () => {
    const all = await startAll();
    const startedAtT0Seconds = Date.now();
    const observed = await drain(all);

    // 전부 끝났다 — 실패 0(대기 120분 상한·30분 규칙 어느 쪽에도 안 걸림).
    expect(all.map((j) => j.status)).toEqual(all.map(() => "completed"));
    expect(observed.tickErrors).toEqual([]);

    // 1) 전체 동시 실행 ≤ 8 (내부·무료 포함).
    expect(probe().maxConcurrent).toBeLessThanOrEqual(8);
    expect(observed.maxGlobalProcessing).toBeLessThanOrEqual(8);
    expect(probe().maxConcurrent).toBeGreaterThanOrEqual(6); // 상한이 실제로 거의 차는 폭주였다

    // 2) 고객별 상한 — A 한 곳이 자리를 독점하지 않는다.
    expect(probe().maxConcurrentFor("A")).toBeLessThanOrEqual(orgCap);
    expect(probe().maxConcurrentFor("A")).toBe(orgCap);
    expect(probe().maxConcurrentFor("B")).toBe(1);
    expect(probe().maxConcurrentFor("C")).toBe(1);

    // 3) B·C 의 첫 시작이 A 의 잔여 작업(20×3분 ÷ 상한)에 비례하지 않는다.
    const t0 = T0.getTime();
    const waitB = probe().waitMs("B", t0) ?? Number.POSITIVE_INFINITY;
    const waitC = probe().waitMs("C", t0) ?? Number.POSITIVE_INFINITY;
    expect(waitB).toBeLessThanOrEqual(5 * MIN);
    expect(waitC).toBeLessThanOrEqual(5 * MIN);
    const lastA = Math.max(
      ...probe()
        .events.filter((e) => e.kind === "enter" && e.owner === "A")
        .map((e) => e.at)
    );
    expect(t0 + waitC).toBeLessThan(lastA);
    expect(lastA - t0).toBeGreaterThan(20 * MIN); // A 는 실제로 오래 걸렸다(그래서 위 비교가 의미 있다)

    // 4) 대기 job 이 30분 규칙으로 stale 이 된 적이 없다 — 일꾼의 heartbeat(attemptStartedAt 갱신).
    expect(observed.queuedStale).toEqual([]);
    // A 의 마지막 시작은 대기 30분보다 늦다 → heartbeat 없이는 실패했어야 하는 상황이었다.
    expect(lastA - t0).toBeGreaterThan(30 * MIN);

    // 5) DB 연결 대기 오류 0, 풀 크기를 넘겨 빌린 적 없음.
    expect(pool().timeouts).toBe(0);
    expect(pool().maxInUse).toBeLessThanOrEqual(poolSize);
    expect(startedAtT0Seconds).toBeGreaterThan(0);
  });
});

describe("T1 공정성·선점·꺼짐", () => {
  beforeEach(() => {
    m.pool = new FakePool(2);
  });

  it("전역 자리가 하나 나면 오래 기다린 고객이 먼저(상한이 찬 고객은 건너뜀)", async () => {
    m.plans = { A: "starter", C: "growth" };
    // 7개가 이미 실행 중 + A 1개(스타터 상한 1 도달) → 전역 8 중 7. 자리 1개.
    for (let i = 0; i < 6; i++) {
      jobs().push({
        id: `run${i}`,
        owner: "X",
        email: `org:X${i}`,
        organizationId: `X${i}`,
        brandId: null,
        domain: "x.com",
        language: "ko",
        status: "processing",
        leaseUntil: new Date(Date.now() + 5 * MIN),
        attemptStartedAt: new Date(),
        createdAt: new Date(T0.getTime() - 5 * MIN),
      });
    }
    jobs().push({
      id: "A-running",
      owner: "A",
      email: "org:A",
      organizationId: "A",
      brandId: null,
      domain: "a.com",
      language: "ko",
      status: "processing",
      leaseUntil: new Date(Date.now() + 5 * MIN),
      attemptStartedAt: new Date(),
      createdAt: new Date(T0.getTime() - 5 * MIN),
    });
    const aOld = addJob("A", "A", 120 * 1000 * 60 - 1000); // 가장 오래 기다림(120분 직전)
    const cNew = addJob("C", "C", 1 * MIN);
    // 일꾼 1회 = 작업 1건이 끝날 때까지 사는 함수 → 기다리지 않고 시계를 민다.
    const tick = runAuditQueueTick(Date.now(), new Date());
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(await tick).toMatchObject({ picked: true, jobId: cNew.id });
    expect(m.claimed).toEqual([cNew.id]);
    expect(aOld.status).toBe("queued");
  });

  it("같은 대기 job 을 두 일꾼이 동시에 집어도 한쪽만 실행된다(선점 경합)", async () => {
    m.plans = { A: "growth" };
    const only = addJob("A", "A", 1 * MIN);
    const ticks = Promise.all([
      runAuditQueueTick(1, new Date()),
      runAuditQueueTick(2, new Date()),
    ]);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    await ticks;
    expect(m.claimed).toEqual([only.id]);
    expect(probe().maxConcurrent).toBe(1);
  });

  it("같은 순간 도착한 A 20건·여러 고객의 시작 판정: start 가 고객별·전체 상한을 넘지 않는다(예약이 서로를 보게 한다)", async () => {
    m.plans = {
      A: "growth",
      B: "growth",
      C: "growth",
      D: "growth",
      E: "growth",
    };
    const aJobs = Array.from({ length: 20 }, () => addJob("A", "A", 0));
    const others = ["B", "C", "D", "E"].flatMap((org) =>
      Array.from({ length: 6 }, () => addJob(org, org, 0))
    );
    const all = [...aJobs, ...others];
    const decisions = await settle(
      Promise.all(
        all.map((job) =>
          admitJob({
            jobId: job.id,
            orgId: job.organizationId as string,
            plan: m.plans[job.organizationId as string],
          })
        )
      )
    );
    const started = all.filter((_, index) => decisions[index] === "start");
    const perOrg = (org: string) =>
      started.filter((job) => job.organizationId === org).length;
    expect(perOrg("A")).toBeLessThanOrEqual(2); // 그로스 고객별 상한
    expect(started.length).toBeLessThanOrEqual(8); // 전체 상한
    expect(started.length).toBe(8); // 살아 있다: 자리가 있는 만큼은 시작한다
    expect(pool().timeouts).toBe(0);
  });

  it("일꾼 플래그 꺼짐: cron 은 skipped 이고 대기 job 은 시작되지 않는다", async () => {
    vi.stubEnv("STABILITY_ADMISSION_ENABLED", "");
    vi.stubEnv("CRON_SECRET", "s3cret");
    const waiting = addJob("A", "A", 1 * MIN);
    for (let i = 0; i < 5; i++) {
      const res = await GET(
        new Request("http://x/api/cron/audit-queue", {
          headers: { authorization: "Bearer s3cret" },
        }) as never
      );
      expect(await res.json()).toEqual({ skipped: true });
      await vi.advanceTimersByTimeAsync(MIN);
    }
    expect(m.claimed).toEqual([]);
    expect(waiting.status).toBe("queued");
  });

  it("N1 이어가기 대기 5건: 무료 5건이 자리를 차지한 상태에서도 오래 기다린 순서로 상한 안에서 전부 처리된다", async () => {
    m.plans = {
      P1: "growth",
      P2: "growth",
      P3: "growth",
      P4: "growth",
      P5: "growth",
    };
    m.durations = { ...m.durations, P: 3 * MIN, free: 10 * MIN };
    const pending: Job[] = [1, 2, 3, 4, 5].map((n) => {
      const job = addJob("P", `P${n}`, 0);
      job.leaseUntil = new Date(T0.getTime() + 2 * 60 * MIN); // 이어가기 대기 = queued + leaseUntil
      job.attemptStartedAt = new Date(T0.getTime() - (60 - n) * MIN); // P1 이 가장 오래 기다림
      job.createdAt = new Date(T0.getTime() - 90 * MIN);
      return job;
    });
    const frees = [1, 2, 3, 4, 5].map(() => addJob("free", null, 0));
    for (const free of frees) {
      runAuditJob({
        jobId: free.id,
        domain: free.domain,
        language: "ko",
      }).catch(() => undefined);
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(jobs().filter((j) => j.status === "processing")).toHaveLength(5);

    const observed = await drain([...pending, ...frees]);

    expect(observed.tickErrors).toEqual([]);
    expect(pending.map((j) => j.status)).toEqual(
      pending.map(() => "completed")
    );
    expect(m.claimed.filter((id) => id.startsWith("P#"))).toEqual(
      pending.map((j) => j.id) // 오래 기다린 순서
    );
    expect(probe().maxConcurrent).toBeLessThanOrEqual(8);
    expect(observed.maxGlobalProcessing).toBeLessThanOrEqual(8);
    expect(pool().timeouts).toBe(0);
  });

  it("시작 관문 꺼짐: DB·플랜 조회 없이 예전처럼 바로 시작", async () => {
    vi.stubEnv("STABILITY_ADMISSION_ENABLED", "");
    vi.stubEnv("STABILITY_ORG_DAILY_CAP_ENABLED", "");
    m.getCurrentPlan.mockRejectedValue(new Error("플랜 조회가 불리면 안 된다"));
    expect(await startGate("A")).toEqual({
      admissionOn: false,
      overCap: false,
    });
    expect(m.getCurrentPlan).not.toHaveBeenCalled();
  });
});
