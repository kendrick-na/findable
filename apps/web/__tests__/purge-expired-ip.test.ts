/**
 * 접속 IP 3개월 자동 삭제 — 2026-10-20 대표 결정 ②.
 *  - 3개월 지난 행의 IP 칸만 비우고(행은 유지), 최근 것·이미 비운 것은 그대로 둔다
 *  - 두 번 돌려도 같다(멱등)
 *  - cron 은 진짜 `denyIfNotCron` 을 거친다(비밀값 없거나 틀리면 DB 를 안 건드린다)
 *  - vercel.json 에 매일 일정이 등록돼 있고 하트비트 일정과 같다
 * 운영 DB 접속 0(메모리 DB).
 *
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface JobRow {
  createdAt: Date;
  id: string;
  ipAddress: string | null;
}

const h = vi.hoisted(() => ({
  rows: [] as JobRow[],
  calls: 0,
  updateBatches: 0,
  lockFree: true,
  lockQueries: [] as string[],
  txTimeouts: [] as number[],
}));

interface ExpiredWhere {
  createdAt: { lt: Date };
  id?: { in: string[] };
  ipAddress: { not: null };
}

const isExpired = (row: JobRow, where: ExpiredWhere) =>
  row.createdAt < where.createdAt.lt &&
  row.ipAddress !== null &&
  (where.id ? where.id.in.includes(row.id) : true);

/** 이 기능이 쓰는 Prisma 인자 모양만 구현한 메모리 AuditJob(정렬·take 포함). */
const memoryAuditJob = {
  findMany: ({ where, take }: { where: ExpiredWhere; take: number }) => {
    h.calls += 1;
    const rows = h.rows
      .filter((r) => isExpired(r, where))
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id)
      )
      .slice(0, take)
      .map((r) => ({ id: r.id }));
    return Promise.resolve(rows);
  },
  updateMany: ({
    where,
    data,
  }: {
    where: ExpiredWhere;
    data: { ipAddress: null };
  }) => {
    h.calls += 1;
    h.updateBatches += 1;
    let count = 0;
    for (const row of h.rows) {
      if (isExpired(row, where)) {
        row.ipAddress = data.ipAddress;
        count += 1;
      }
    }
    return Promise.resolve({ count });
  },
};

/** 이 기능이 쓰는 모양만 흉내 낸 Prisma: 배치 트랜잭션 + `pg_try_advisory_xact_lock`. */
const memoryDb = {
  $transaction: (
    fn: (tx: unknown) => Promise<unknown>,
    options?: { timeout?: number }
  ) => {
    h.txTimeouts.push(options?.timeout ?? -1);
    return fn({
      auditJob: memoryAuditJob,
      $queryRaw: (strings: TemplateStringsArray) => {
        h.lockQueries.push(strings.join("?"));
        return Promise.resolve([{ locked: h.lockFree }]);
      },
      $executeRaw: () => Promise.resolve(0),
    });
  },
};

vi.mock("@repo/database", () => ({ database: memoryDb }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { ipRetentionCutoff, purgeExpiredIpAddresses } = await import(
  "../lib/purge-expired-ip"
);
const { GET } = await import("../app/api/cron/purge-expired-ip/route");

/** 메모리 updateMany 를 Prisma 시그니처로 맞춘다(이 기능이 쓰는 인자 모양만 구현). */
const memClient = () =>
  memoryDb as unknown as Parameters<typeof purgeExpiredIpAddresses>[0];

const NOW = new Date("2026-10-20T03:00:00.000Z");
const at = (iso: string) => new Date(iso);

const seedRows = (): JobRow[] => [
  { id: "old", createdAt: at("2026-07-19T00:00:00Z"), ipAddress: "1.2.3.4" },
  {
    id: "old_v6",
    createdAt: at("2026-01-01T00:00:00Z"),
    ipAddress: "2001:db8:1:2::/64",
  },
  {
    id: "old_mark",
    createdAt: at("2026-06-01T00:00:00Z"),
    ipAddress: "auto-refresh",
  },
  { id: "edge", createdAt: at("2026-07-20T03:00:00Z"), ipAddress: "5.6.7.8" },
  { id: "recent", createdAt: at("2026-10-19T00:00:00Z"), ipAddress: "9.9.9.9" },
  { id: "old_null", createdAt: at("2026-01-01T00:00:00Z"), ipAddress: null },
];

const ipOf = (id: string) => h.rows.find((r) => r.id === id)?.ipAddress;

beforeEach(() => {
  h.rows = seedRows();
  h.calls = 0;
  h.updateBatches = 0;
  h.lockFree = true;
  h.lockQueries = [];
  h.txTimeouts = [];
});

describe("ipRetentionCutoff — 달력 기준 3개월", () => {
  it("10-20 이면 07-20 같은 시각", () => {
    expect(ipRetentionCutoff(NOW).toISOString()).toBe(
      "2026-07-20T03:00:00.000Z"
    );
  });
  it.each([
    ["2026-05-31T09:00:00.000Z", "2026-02-28T09:00:00.000Z"],
    ["2028-05-31T09:00:00.000Z", "2028-02-29T09:00:00.000Z"], // 윤년
    ["2026-08-31T00:00:00.000Z", "2026-05-31T00:00:00.000Z"],
    ["2026-12-31T23:59:59.999Z", "2026-09-30T23:59:59.999Z"],
  ])("월말 넘침 없음: %s → %s", (from, expected) => {
    expect(ipRetentionCutoff(at(from)).toISOString()).toBe(expected);
  });
  it("연도를 넘어간다(2027-01-15 → 2026-10-15)", () => {
    expect(ipRetentionCutoff(at("2027-01-15T00:00:00Z")).toISOString()).toBe(
      "2026-10-15T00:00:00.000Z"
    );
  });
});

describe("purgeExpiredIpAddresses", () => {
  it("3개월 지난 행의 IP 만 비우고, 최근·경계 시각·이미 빈 행은 그대로 둔다", async () => {
    const r = await purgeExpiredIpAddresses(memClient(), NOW);
    expect(r.cleared).toBe(3);
    expect(ipOf("old")).toBeNull();
    expect(ipOf("old_v6")).toBeNull();
    expect(ipOf("old_mark")).toBeNull();
    expect(ipOf("edge")).toBe("5.6.7.8"); // 정확히 3개월 = 아직 보관
    expect(ipOf("recent")).toBe("9.9.9.9");
    expect(h.rows).toHaveLength(6); // 행은 지우지 않는다
  });

  it("멱등: 두 번째 실행은 0건", async () => {
    await purgeExpiredIpAddresses(memClient(), NOW);
    const snapshot = structuredClone(h.rows);
    const again = await purgeExpiredIpAddresses(memClient(), NOW);
    expect(again.cleared).toBe(0);
    expect(h.rows).toEqual(snapshot);
  });
});

describe("배치 처리", () => {
  const manyOld = (n: number): JobRow[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `bulk_${String(i).padStart(5, "0")}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      ipAddress: `10.0.${Math.floor(i / 250)}.${i % 250}`,
    }));

  it("1,000건씩 나눠 끝까지 비운다(2,500건 → 3번)", async () => {
    h.rows = manyOld(2500);
    const r = await purgeExpiredIpAddresses(memClient(), NOW);
    expect(r).toMatchObject({ cleared: 2500, batches: 3, done: true });
    expect(h.rows.every((row) => row.ipAddress === null)).toBe(true);
  });

  it("시간 예산이 다 되면 멈추고 done:false — 다음 실행이 오래된 것부터 이어서 한다", async () => {
    h.rows = manyOld(2500);
    let t = 0;
    // 한 번 물을 때마다 시계가 30초 흐른다 → 예산 45초면 1배치만 하고 멈춘다.
    const clock = () => {
      const now = t;
      t += 30_000;
      return now;
    };
    const first = await purgeExpiredIpAddresses(memClient(), NOW, { clock });
    expect(first).toMatchObject({ cleared: 1000, batches: 1, done: false });
    // 가장 오래된 1,000건이 먼저 비워졌다.
    expect(h.rows.slice(0, 1000).every((row) => row.ipAddress === null)).toBe(
      true
    );
    expect(h.rows[1000].ipAddress).not.toBeNull();
    const rest = await purgeExpiredIpAddresses(memClient(), NOW);
    expect(rest).toMatchObject({ cleared: 1500, done: true });
  });
});

describe("동시 실행 방지·배치 시간", () => {
  it("배치마다 pg_try_advisory_xact_lock 을 시도한다", async () => {
    await purgeExpiredIpAddresses(memClient(), NOW);
    expect(h.lockQueries.length).toBeGreaterThan(0);
    expect(h.lockQueries[0]).toContain("pg_try_advisory_xact_lock");
  });

  it("⛔ 다른 실행이 잠금을 쥐고 있으면 아무것도 바꾸지 않고 lockBusy 로 비켜선다", async () => {
    h.lockFree = false;
    const before = structuredClone(h.rows);
    const r = await purgeExpiredIpAddresses(memClient(), NOW);
    expect(r).toMatchObject({
      cleared: 0,
      batches: 0,
      done: false,
      lockBusy: true,
    });
    expect(h.rows).toEqual(before);
    expect(h.updateBatches).toBe(0);
  });

  it("배치 트랜잭션 시간 = min(남은 예산, 15초) — 느린 배치가 함수 제한을 넘지 않게", async () => {
    await purgeExpiredIpAddresses(memClient(), NOW, { timeBudgetMs: 8000 });
    expect(h.txTimeouts[0]).toBeLessThanOrEqual(8000);
    h.txTimeouts = [];
    await purgeExpiredIpAddresses(memClient(), NOW);
    expect(h.txTimeouts[0]).toBe(15_000);
  });

  it("남은 예산이 2초 미만이면 새 배치를 시작하지 않는다", async () => {
    const r = await purgeExpiredIpAddresses(memClient(), NOW, {
      timeBudgetMs: 1000,
    });
    expect(r).toMatchObject({ batches: 0, done: false, lockBusy: false });
    expect(h.txTimeouts).toHaveLength(0);
  });
});

describe("cron 라우트 — 진짜 CRON_SECRET 검사", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  const call = (auth?: string) =>
    GET(
      new Request("https://www.test/api/cron/purge-expired-ip", {
        headers: auth ? { authorization: auth } : {},
      }) as never
    );

  it("비밀값이 맞으면 정리하고 건수를 돌려준다", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.VERCEL_ENV = "production";
    const res = await call("Bearer s3cret");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cleared: number };
    // 라우트는 실제 현재 시각을 쓴다 → 비운 건수 = 실제로 비워진 행 수인지만 본다.
    const nulledNow = h.rows.filter(
      (row) => row.id !== "old_null" && row.ipAddress === null
    ).length;
    expect(body.cleared).toBe(nulledNow);
    expect(body.cleared).toBeGreaterThanOrEqual(3);
    expect(h.updateBatches).toBe(1);
  });

  it.each([
    ["헤더 없음", undefined],
    ["틀린 값", "Bearer nope"],
  ])("⛔ %s 이면 401 이고 DB 를 건드리지 않는다", async (_name, auth) => {
    process.env.CRON_SECRET = "s3cret";
    process.env.VERCEL_ENV = "production";
    const res = await call(auth);
    expect(res.status).toBe(401);
    expect(h.calls).toBe(0);
  });

  it("⛔ Preview 배포에서는 403 이고 DB 를 건드리지 않는다", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.VERCEL_ENV = "preview";
    const res = await call("Bearer s3cret");
    expect(res.status).toBe(403);
    expect(h.calls).toBe(0);
  });
});

describe("배포 설정", () => {
  it("vercel.json 에 매일 일정이 있고 라우트의 하트비트 일정과 같다", () => {
    const config = JSON.parse(
      readFileSync(join(import.meta.dirname, "../vercel.json"), "utf8")
    ) as { crons?: Array<{ path: string; schedule: string }> };
    const cron = config.crons?.find(
      (c) => c.path === "/api/cron/purge-expired-ip"
    );
    expect(cron?.schedule).toBe("30 16 * * *");
    const route = readFileSync(
      join(import.meta.dirname, "../app/api/cron/purge-expired-ip/route.ts"),
      "utf8"
    );
    expect(route).toContain(`"${cron?.schedule}"`);
    expect(route).toContain("denyIfNotCron");
  });
});
