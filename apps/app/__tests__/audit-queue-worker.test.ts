// biome-ignore-all lint/suspicious/useAwait: 모의 DB 는 async 시그니처만 맞춘다
/**
 * 안정성 U2 — 대기 줄 일꾼(lib/audit-queue/worker)과 cron 라우트.
 * 메모리 안 가짜 DB(상태를 실제로 바꾼다)로 상한·공정성·heartbeat·만료·선점 경합을 확인한다.
 *
 * @vitest-environment node
 */
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
  /** 슬롯 예약 표식(`admit:…`) 또는 러너 토큰. */
  leaseToken?: string | null;
  leaseUntil: Date | null;
  organizationId: string | null;
  status: "queued" | "processing" | "failed" | "completed";
}

const m = vi.hoisted(() => ({
  jobs: [] as unknown[],
  plans: {} as Record<string, string>,
  runAuditJob: vi.fn(),
  continueAuditJob: vi.fn(),
}));
const jobs = () => m.jobs as Job[];

const isReserved = (j: Job) =>
  j.status === "queued" && Boolean(j.leaseToken?.startsWith("admit:"));
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
const updateManyImpl = ({ where, data }: UpdateArgs) => {
  // 슬롯 예약 표식 찍기
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
  // 시작하지 못한 예약 되돌리기
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
const groupByImpl = () => {
  const by = new Map<string, number>();
  const occupied = jobs().filter(
    (x) =>
      x.status === "processing" ||
      (isReserved(x) &&
        (x.attemptStartedAt?.getTime() ?? 0) > NOW.getTime() - 90_000)
  );
  for (const j of occupied) {
    by.set(j.email, (by.get(j.email) ?? 0) + 1);
  }
  return [...by].map(([email, n]) => ({ email, _count: { _all: n } }));
};

vi.mock("@repo/database", () => ({
  database: {
    organization: {
      findMany: async () =>
        Object.entries(m.plans).map(([id, plan]) => ({ id, plan })),
    },
    brand: {
      findUnique: async () => ({
        name: "브랜드",
        entityVariants: [],
        industry: "beauty",
        marketScope: "korea",
      }),
    },
    auditJob: {
      updateMany: async (args: UpdateArgs) => updateManyImpl(args),
      findMany: async ({ where }: { where: { leaseUntil: unknown } }) => {
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
          .sort(
            (a, b) =>
              (waiting
                ? a.createdAt
                : (a.attemptStartedAt ?? a.createdAt)
              ).getTime() -
              (waiting
                ? b.createdAt
                : (b.attemptStartedAt ?? b.createdAt)
              ).getTime()
          );
      },
      groupBy: async () => groupByImpl(),
    },
    // 슬롯 예약 트랜잭션 대역(진짜 잠금·경합은 audit-queue-reservation-postgres.test.ts 가 증명한다).
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $executeRaw: async () => 0,
        auditJob: {
          groupBy: async () => groupByImpl(),
          updateMany: async (args: UpdateArgs) => updateManyImpl(args),
        },
      }),
  },
}));
vi.mock("@repo/audit/runner", () => ({ runAuditJob: m.runAuditJob }));
vi.mock("@repo/audit/audit-continuation", () => ({
  continueAuditJob: m.continueAuditJob,
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

import { SALES_INTERNAL_ORG_ID } from "@repo/database/internal-orgs";
import { GET } from "../app/api/cron/audit-queue/route";
import { runAuditQueueTick } from "../lib/audit-queue/worker";

const NOW = new Date("2026-10-18T12:00:00Z");
const minAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);
let seq = 0;
const add = (over: Partial<Job> & { org: string }): Job => {
  seq += 1;
  const { org, ...rest } = over;
  const job: Job = {
    id: rest.id ?? `j${seq}`,
    email: `org:${org}`,
    organizationId: org,
    brandId: `b-${org}`,
    domain: `${org}.com`,
    language: "ko",
    status: "queued",
    leaseUntil: null,
    attemptStartedAt: null,
    createdAt: minAgo(1),
    ...rest,
  };
  jobs().push(job);
  return job;
};
const running = (email: string, count = 1) => {
  for (let i = 0; i < count; i += 1) {
    jobs().push({
      id: `run-${email}-${i}-${seq++}`,
      email,
      organizationId: email.startsWith("org:") ? email.slice(4) : null,
      brandId: null,
      domain: "x.com",
      language: "ko",
      status: "processing",
      leaseUntil: new Date(NOW.getTime() + 60_000),
      attemptStartedAt: NOW,
      createdAt: minAgo(2),
    });
  }
};
const ranIds = () =>
  m.runAuditJob.mock.calls.map((c) => (c[0] as { jobId: string }).jobId);

beforeEach(() => {
  m.jobs.length = 0;
  m.plans = {};
  m.runAuditJob.mockReset().mockResolvedValue(undefined);
  m.continueAuditJob.mockReset().mockResolvedValue({ ran: true });
  vi.stubEnv("STABILITY_ADMISSION_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("대기 줄 일꾼", () => {
  it("가장 오래 기다린 고객 순서로 1건만 실행한다(호출당 1건)", async () => {
    add({ org: "B", id: "newer", createdAt: minAgo(5) });
    add({ org: "A", id: "older", createdAt: minAgo(20) });
    const result = await runAuditQueueTick(1, NOW);
    expect(result).toMatchObject({ picked: true, jobId: "older", kind: "new" });
    expect(ranIds()).toEqual(["older"]);
  });

  it("러너 입력은 start-tracking 과 같은 모양이다", async () => {
    add({ org: "A", id: "w" });
    await runAuditQueueTick(7, NOW);
    expect(m.runAuditJob).toHaveBeenCalledWith({
      invocationStartedAtMs: 7,
      jobId: "w",
      domain: "A.com",
      language: "ko",
      brandName: "브랜드",
      brandVariants: [],
      organizationId: "A",
      brandId: "b-A",
      industry: "beauty",
      marketScope: "korea",
      continueWhenTruncated: true,
      setupReadiness: undefined,
    });
  });

  it("고객 우선: 더 오래 기다린 내부 조직 job 보다 고객 job 이 먼저다", async () => {
    add({ org: SALES_INTERNAL_ORG_ID, id: "internal", createdAt: minAgo(60) });
    add({ org: "A", id: "customer", createdAt: minAgo(3) });
    await runAuditQueueTick(1, NOW);
    expect(ranIds()).toEqual(["customer"]);
  });

  it("고객별 상한(스타터 1)이 찬 고객은 건너뛰어 다른 고객이 독점당하지 않는다", async () => {
    m.plans = { A: "starter", B: "growth" };
    running("org:A", 1);
    add({ org: "A", id: "a-old", createdAt: minAgo(90) });
    add({ org: "A", id: "a-old2", createdAt: minAgo(80) });
    add({ org: "B", id: "b-new", createdAt: minAgo(2) });
    await runAuditQueueTick(1, NOW);
    expect(ranIds()).toEqual(["b-new"]);
  });

  it("플랜을 모르면 플랜 구분 없는 상한(2)을 쓴다", async () => {
    running("org:A", 1);
    add({ org: "A", id: "a" });
    await runAuditQueueTick(1, NOW);
    expect(ranIds()).toEqual(["a"]);
  });

  it("전역 상한(8)이 차면 새 측정을 시작하지 않는다 — 내부·무료 실행도 센다", async () => {
    running("org:X", 2);
    running("org:Y", 2);
    running("intake@free.com", 2);
    running(`org:${SALES_INTERNAL_ORG_ID}`, 2);
    add({ org: "A", id: "waiting" });
    const result = await runAuditQueueTick(1, NOW);
    expect(result).toMatchObject({ picked: null, reason: "no_room" });
    expect(m.runAuditJob).not.toHaveBeenCalled();
  });

  it("대기 중에는 heartbeat 로 attemptStartedAt 을 갱신한다", async () => {
    const w = add({ org: "A", id: "w" });
    running("org:A", 2); // 고객별 상한이라 실행은 안 됨
    await runAuditQueueTick(1, NOW);
    expect(m.runAuditJob).not.toHaveBeenCalled();
    expect(w.attemptStartedAt).toEqual(NOW);
  });

  it("queueWaitMaxMinutes(120분)를 넘긴 대기는 기존 문구로 실패 처리한다", async () => {
    const old = add({ org: "A", id: "old", createdAt: minAgo(121) });
    const fresh = add({ org: "B", id: "fresh", createdAt: minAgo(119) });
    const result = await runAuditQueueTick(1, NOW);
    expect(result.expired).toBe(1);
    expect(old.status).toBe("failed");
    expect(old.errorMessage).toContain("QUEUE_START_TIMEOUT");
    expect(fresh.status).toBe("queued");
    expect(ranIds()).toEqual(["fresh"]);
  });

  it("새 대기가 없으면 이어가기 대기를 처리한다(상한 안에서)", async () => {
    add({
      org: "A",
      id: "cont",
      leaseUntil: new Date(NOW.getTime() + 3_600_000),
      attemptStartedAt: minAgo(10),
    });
    const result = await runAuditQueueTick(9, NOW);
    expect(result).toMatchObject({ kind: "continuation", jobId: "cont" });
    expect(m.continueAuditJob).toHaveBeenCalledWith("cont", {
      invocationStartedAtMs: 9,
    });
  });

  it("전역 상한이 차면 이어서 묻기는 미루고, 시간창이 지난 잠정 마감은 처리한다", async () => {
    running("org:X", 4);
    running("org:Y", 4);
    add({
      org: "A",
      id: "cont",
      leaseUntil: new Date(NOW.getTime() + 3_600_000),
      attemptStartedAt: minAgo(30),
    });
    expect((await runAuditQueueTick(1, NOW)).picked).toBeNull();
    add({
      org: "C",
      id: "expired",
      leaseUntil: minAgo(5),
      attemptStartedAt: minAgo(130),
    });
    const result = await runAuditQueueTick(1, NOW);
    expect(result).toMatchObject({ jobId: "expired", kind: "continuation" });
  });

  it("같은 대기 job 을 두 일꾼이 동시에 집어도 한쪽만 실행된다(claim 원자성)", async () => {
    const w = add({ org: "A", id: "race" });
    let executed = 0;
    // 러너의 첫 동작(claimAuditExecution: queued→processing 원자 갱신)을 같은 의미로 흉내낸다.
    m.runAuditJob.mockImplementation(async () => {
      if (w.status === "queued") {
        w.status = "processing";
        executed += 1;
      }
    });
    await Promise.all([runAuditQueueTick(1, NOW), runAuditQueueTick(2, NOW)]);
    expect(m.runAuditJob).toHaveBeenCalledTimes(2);
    expect(executed).toBe(1);
  });
});

describe("cron 라우트", () => {
  const req = (auth?: string) =>
    new Request("http://x/api/cron/audit-queue", {
      headers: auth ? { authorization: auth } : {},
    }) as never;

  it("CRON_SECRET 없이는 401 — 플래그가 켜져 있어도 일꾼이 돌지 않는다", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    add({ org: "A" });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(m.runAuditJob).not.toHaveBeenCalled();
  });

  it("플래그가 꺼져 있으면 즉시 skipped 200", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("STABILITY_ADMISSION_ENABLED", "");
    add({ org: "A" });
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: true });
    expect(m.runAuditJob).not.toHaveBeenCalled();
  });

  it("인증 + 플래그 켜짐이면 대기 1건을 실행한다", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    add({ org: "A", id: "w" });
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(ranIds()).toEqual(["w"]);
  });
});

describe("슬롯 예약(2026-10-18 판정 경합 수정)", () => {
  it("일꾼은 대기 job 에 예약 표식을 찍은 뒤에 러너를 부른다", async () => {
    const job = add({ org: "A", id: "w1" });
    m.runAuditJob.mockImplementation(async () => {
      // 러너가 불리는 시점에 이미 예약 표식이 있어야 한다(다른 판정이 이 자리를 센다).
      expect(job.leaseToken?.startsWith("admit:")).toBe(true);
    });
    await runAuditQueueTick(1, NOW);
    expect(ranIds()).toEqual(["w1"]);
  });

  it("예약된 job 은 다른 일꾼의 대기 후보에서 빠진다(같은 건을 또 집지 않음)", async () => {
    add({
      org: "A",
      id: "reserved",
      leaseToken: "admit:xyz",
      attemptStartedAt: NOW,
    });
    const result = await runAuditQueueTick(1, NOW);
    expect(result).toMatchObject({ picked: null });
    expect(m.runAuditJob).not.toHaveBeenCalled();
  });

  it("시작하지 못한 예약(TTL 90초 초과)은 틱 맨 앞에서 대기로 되돌아와 시작된다", async () => {
    const stale = add({
      org: "A",
      id: "stale-res",
      leaseToken: "admit:old",
      attemptStartedAt: new Date(NOW.getTime() - 5 * 60_000),
    });
    const result = await runAuditQueueTick(1, NOW);
    expect(result).toMatchObject({ picked: true, jobId: "stale-res" });
    expect(stale.leaseToken?.startsWith("admit:")).toBe(true); // 되돌린 뒤 다시 예약돼 실행
    expect(ranIds()).toEqual(["stale-res"]);
  });

  it("살아 있는 예약도 자리를 차지한다 — 전역 상한이 예약 때문에 가득 차면 새 대기를 시작하지 않는다", async () => {
    for (let i = 0; i < 8; i += 1) {
      add({
        org: `R${i}`,
        id: `res-${i}`,
        leaseToken: "admit:live",
        attemptStartedAt: NOW,
      });
    }
    add({ org: "W", id: "waiting" });
    const result = await runAuditQueueTick(1, NOW);
    expect(result).toMatchObject({ picked: null, reason: "no_room" });
    expect(m.runAuditJob).not.toHaveBeenCalled();
  });
});
