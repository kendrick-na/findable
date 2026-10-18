/** @vitest-environment node */

// 입장 판정 경합 수정 증명(2026-10-18) — 실제 PostgreSQL + Prisma pg 어댑터(연결 풀 max 1, 운영과 같은 설정).
//
// 증명하는 것
//  ① 같은 서버 인스턴스(풀 1개)에 20건이 동시에 몰려도 고객별 상한을 넘는 예약이 0건이고, 정확히 상한만큼 예약된다(살아 있다).
//  ② 서로 다른 서버 인스턴스 6개(각자 풀 1개 = 별개 DB 연결)가 동시에 몰려도 전체·고객별 상한 초과 0건 — 어드바이저리 잠금이 인스턴스 사이를 직렬화한다.
//  ③ 예약은 러너 선점(queued→processing)으로 이어져 계속 센다(세는 틈 없음). 끝나면 자리가 난다.
//  ④ 시작하지 못한 예약은 TTL 뒤 세지 않고, 일꾼이 대기로 되돌린다.
//  ⑤ 새 교착·긴 대기 없음 — 모든 호출이 짧은 시간 안에 끝난다(DB 풀 max 1 환경, N6).
// 운영/공유 DB 는 쓰지 않는다(initdb 임시 클러스터만).

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@repo/database/generated/client";
import { PrismaPg } from "@repo/database/node_modules/@prisma/adapter-pg/dist/index.mjs";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const state = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("@repo/database", () => ({
  get database() {
    return state.database;
  },
}));

const tempDir = mkdtempSync("/tmp/findable-admission-pg-");
const socketDir = join(tempDir, "socket");
const port = 19_200 + Math.floor(Math.random() * 500);
const role = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
const connectionString = `postgresql://${role}@127.0.0.1:${port}/postgres?application_name=findable_admission`;
let serverStarted = false;
const clients: PrismaClient[] = [];
const pgEnv = { ...process.env, LC_ALL: "C", LANG: "C" };

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8", env: pgEnv });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
}

/** 서버 인스턴스 하나 = 풀 max 1 짜리 별개 연결(운영 `packages/database/index.ts` 와 같은 설정). */
const newInstance = () => {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 1 }),
  });
  clients.push(client);
  return client;
};

beforeAll(async () => {
  run("initdb", ["-D", tempDir, "-A", "trust", "--no-locale"]);
  mkdirSync(socketDir);
  run("pg_ctl", [
    "-D",
    tempDir,
    "-o",
    `-p ${port} -k ${socketDir}`,
    "-l",
    join(tempDir, "postgres.log"),
    "start",
  ]);
  serverStarted = true;
  const deadline = Date.now() + 8000;
  while (
    Date.now() < deadline &&
    spawnSync("pg_isready", ["-h", "127.0.0.1", "-p", String(port)]).status !==
      0
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const admin = newInstance();
  state.database = admin;
  await admin.$executeRawUnsafe(
    `CREATE TYPE "AuditStatus" AS ENUM ('queued','processing','completed','failed')`
  );
  await admin.$executeRawUnsafe(`CREATE TABLE "AuditJob" (
    "id" text PRIMARY KEY,
    "email" text NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'queued',
    "leaseToken" text,
    "leaseUntil" timestamp(3),
    "attemptStartedAt" timestamp(3),
    "createdAt" timestamp(3) NOT NULL DEFAULT now()
  )`);
}, 60_000);

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  if (serverStarted) {
    spawnSync(
      "pg_ctl",
      [
        "-D",
        tempDir,
        "-o",
        `-p ${port} -k ${socketDir}`,
        "stop",
        "-m",
        "immediate",
      ],
      { stdio: "ignore" }
    );
  }
  rmSync(tempDir, { recursive: true, force: true });
});

const admin = () => state.database as PrismaClient;

beforeEach(async () => {
  await admin().$executeRawUnsafe(`TRUNCATE "AuditJob"`);
});

const LIMITS = {
  breakerCooldownMs: 300_000,
  breakerFailThreshold: 3,
  cellMaxRetries: 1,
  globalConcurrency: 8,
  orgConcurrency: 2,
  orgConcurrencyByPlan: { growth: 2, scale: 2, starter: 1 },
  orgDailyCap: { growth: 5, scale: 10, starter: 2 },
  orgMonthlyCap: { growth: 100, scale: 250, starter: 30 },
  queueWaitMaxMinutes: 120,
  retryAfterCapMs: 15_000,
  retryDelaysMs: [2000],
  retryOn429WithoutRetryAfter: false,
  retryTotalShare: 0.2,
};

const insertQueued = async (orgs: string[], perOrg: number) => {
  const ids: { id: string; org: string }[] = [];
  for (const org of orgs) {
    for (let n = 0; n < perOrg; n++) {
      ids.push({ id: `${org}-${n}`, org });
    }
  }
  await admin().$executeRawUnsafe(
    `INSERT INTO "AuditJob" ("id","email","status") SELECT x.id, 'org:' || x.org, 'queued' FROM jsonb_to_recordset($1::jsonb) AS x(id text, org text)`,
    JSON.stringify(ids)
  );
  return ids;
};

const countBy = async () =>
  await admin().$queryRawUnsafe<{ email: string; n: number }[]>(
    `SELECT "email", count(*)::int AS n FROM "AuditJob" WHERE "leaseToken" LIKE 'admit:%' OR "status" = 'processing' GROUP BY "email"`
  );

describe("입장 판정 경합 — 실제 PostgreSQL(연결 풀 max 1)에서 상한 초과 0회", () => {
  it("① 한 인스턴스에 20건이 동시에 몰려도 고객별 상한(그로스 2)을 넘는 예약 0건, 정확히 2건 예약, 짧은 시간 안에 끝난다", async () => {
    const { reserveSlot } = await import("../lib/audit-queue/slot-reservation");
    const jobs = await insertQueued(["A"], 20);
    const client = newInstance();
    const started = Date.now();
    const results = await Promise.all(
      jobs.map((job) =>
        reserveSlot({
          client,
          jobId: job.id,
          limits: LIMITS,
          orgId: "A",
          plan: "growth",
        })
      )
    );
    const elapsed = Date.now() - started;
    expect(results.filter((r) => r === "reserved")).toHaveLength(2);
    expect(results.filter((r) => r === "full")).toHaveLength(18);
    expect(elapsed).toBeLessThan(5000); // 교착·긴 대기 없음(풀 1개에서 20건 직렬 처리)
    const marked = await countBy();
    expect(marked).toEqual([{ email: "org:A", n: 2 }]);
  }, 30_000);

  it("② 서로 다른 서버 인스턴스 6개가 동시에 몰려도 전체 상한(8)·고객별 상한(2) 초과 0건 — 5회 반복", async () => {
    const { reserveSlot } = await import("../lib/audit-queue/slot-reservation");
    const instances = Array.from({ length: 6 }, newInstance);
    const orgs = Array.from({ length: 10 }, (_, i) => `O${i}`);
    let worst = 0;
    for (let round = 0; round < 5; round++) {
      await admin().$executeRawUnsafe(`TRUNCATE "AuditJob"`);
      const jobs = await insertQueued(orgs, 6); // 60건
      const started = Date.now();
      const results = await Promise.all(
        jobs.map((job, index) =>
          reserveSlot({
            client: instances[index % instances.length] as PrismaClient,
            jobId: job.id,
            limits: LIMITS,
            orgId: job.org,
            plan: "growth",
          })
        )
      );
      worst = Math.max(worst, Date.now() - started);
      const reserved = results.filter((r) => r === "reserved").length;
      expect(reserved).toBe(8); // 정확히 전체 상한만큼 — 초과 0, 부족 0
      const perOrg = await countBy();
      expect(perOrg.reduce((sum, row) => sum + row.n, 0)).toBe(8);
      for (const row of perOrg) {
        expect(row.n).toBeLessThanOrEqual(2);
      }
    }
    expect(worst).toBeLessThan(10_000); // 60건이 6개 연결로 직렬화돼도 긴 대기 없음
  }, 120_000);

  it("③ 예약은 러너 선점과 이어져 계속 센다(세는 틈 없음), 끝나면 자리가 난다", async () => {
    const { reserveSlot } = await import("../lib/audit-queue/slot-reservation");
    const jobs = await insertQueued(["A"], 6);
    const client = newInstance();
    const reserve = (id: string) =>
      reserveSlot({
        client,
        jobId: id,
        limits: LIMITS,
        orgId: "A",
        plan: "growth",
      });
    expect(await reserve("A-0")).toBe("reserved");
    expect(await reserve("A-1")).toBe("reserved");
    expect(await reserve("A-2")).toBe("full");
    // 러너가 선점: queued → processing, leaseToken 이 러너 토큰으로 덮임(예약 표식 사라짐) — 그래도 2건으로 센다.
    await admin().$executeRawUnsafe(
      `UPDATE "AuditJob" SET "status"='processing', "leaseToken"='run:1', "leaseUntil"=(now() AT TIME ZONE 'utc') + interval '6 minutes' WHERE "id"='A-0'`
    );
    expect(await reserve("A-2")).toBe("full");
    // 하나 끝남 → 자리 1개
    await admin().$executeRawUnsafe(
      `UPDATE "AuditJob" SET "status"='completed', "leaseUntil"=NULL WHERE "id"='A-0'`
    );
    expect(await reserve("A-2")).toBe("reserved");
    expect(await reserve("A-3")).toBe("full");
    expect(jobs).toHaveLength(6);
  }, 30_000);

  it("④ 시작하지 못한 예약은 TTL 뒤 세지 않고, releaseStaleReservations 가 대기로 되돌린다", async () => {
    const { releaseStaleReservations, reserveSlot } = await import(
      "../lib/audit-queue/slot-reservation"
    );
    await insertQueued(["A"], 4);
    const client = newInstance();
    const reserve = (id: string) =>
      reserveSlot({
        client,
        jobId: id,
        limits: LIMITS,
        orgId: "A",
        plan: "growth",
      });
    expect(await reserve("A-0")).toBe("reserved");
    expect(await reserve("A-1")).toBe("reserved");
    expect(await reserve("A-2")).toBe("full");
    // 두 예약이 5분 전(TTL 90초 초과)에 찍힌 것처럼 — 요청이 죽어 시작하지 못함.
    await admin().$executeRawUnsafe(
      `UPDATE "AuditJob" SET "attemptStartedAt" = (now() AT TIME ZONE 'utc') - interval '5 minutes' WHERE "leaseToken" LIKE 'admit:%'`
    );
    expect(await reserve("A-2")).toBe("reserved"); // 만료된 예약은 세지 않는다
    const released = await releaseStaleReservations();
    expect(released).toBe(2);
    const rows = await admin().$queryRawUnsafe<
      { id: string; leaseToken: string | null }[]
    >(
      `SELECT "id","leaseToken" FROM "AuditJob" WHERE "id" IN ('A-0','A-1') ORDER BY "id"`
    );
    expect(rows.every((row) => row.leaseToken === null)).toBe(true);
  }, 30_000);

  it("⑤ queued 가 아닌 job 은 gone — 다른 곳이 이미 집은 job 에 예약을 덮지 않고, 자리도 쓰지 않는다", async () => {
    const { reserveSlot } = await import("../lib/audit-queue/slot-reservation");
    await insertQueued(["A"], 2);
    await admin().$executeRawUnsafe(
      `UPDATE "AuditJob" SET "status"='failed' WHERE "id"='A-0'`
    );
    const client = newInstance();
    const gone = await reserveSlot({
      client,
      jobId: "A-0",
      limits: LIMITS,
      orgId: "A",
      plan: "growth",
    });
    expect(gone).toBe("gone");
    expect(await countBy()).toEqual([]);
  }, 30_000);

  it("⑥ 진짜 claimAuditExecution(러너 선점)이 예약 표식을 러너 토큰으로 덮고 processing 으로 이어진다 — 세는 틈 없음", async () => {
    const { reserveSlot } = await import("../lib/audit-queue/slot-reservation");
    const { claimAuditExecution } = await import(
      "@repo/audit/audit-execution-lease"
    );
    await insertQueued(["A"], 3);
    const client = newInstance();
    const reserve = (id: string) =>
      reserveSlot({
        client,
        jobId: id,
        limits: LIMITS,
        orgId: "A",
        plan: "growth",
      });
    expect(await reserve("A-0")).toBe("reserved");
    expect(await reserve("A-1")).toBe("reserved");
    expect(await reserve("A-2")).toBe("full");
    // 러너의 실제 선점 — queued→processing, leaseToken 덮기, lease 부여.
    const token = await claimAuditExecution(
      "A-0",
      new Date(),
      "runner-token-0"
    );
    expect(token).toBe("runner-token-0");
    const row = await admin().$queryRawUnsafe<
      { status: string; leaseToken: string | null }[]
    >(
      `SELECT "status"::text AS status, "leaseToken" FROM "AuditJob" WHERE "id"='A-0'`
    );
    expect(row[0]).toEqual({
      status: "processing",
      leaseToken: "runner-token-0",
    });
    // 예약 1 + 실행 중 1 = 여전히 2건으로 센다.
    expect(await reserve("A-2")).toBe("full");
  }, 30_000);

  it("고객별 상한은 플랜별(스타터 1) — 전체 여유가 있어도 한 고객이 상한을 넘지 못한다", async () => {
    const { reserveSlot } = await import("../lib/audit-queue/slot-reservation");
    await insertQueued(["S"], 10);
    const instances = Array.from({ length: 3 }, newInstance);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, n) =>
        reserveSlot({
          client: instances[n % 3] as PrismaClient,
          jobId: `S-${n}`,
          limits: LIMITS,
          orgId: "S",
          plan: "starter",
        })
      )
    );
    expect(results.filter((r) => r === "reserved")).toHaveLength(1);
  }, 30_000);
});
