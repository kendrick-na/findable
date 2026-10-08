/** @vitest-environment node */

// W1 PromptAttempt 원장 — 일회용 PostgreSQL 위에서 실제 migration SQL 과 Prisma 로
// RED 매트릭스 8건 + 정책(cooldown)·플래그 off 읽기 내성을 검증한다.
// 운영/공유 DB 는 절대 쓰지 않는다(initdb 로 만든 임시 클러스터만).

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveQuestionCheckpoint } from "@repo/audit/audit-execution-lease";
import {
  isSuccessfulMeasurement,
  type PromptAttempt,
} from "@repo/audit/prompt-attempt-ledger";
import {
  adoptPromptAttemptPlan,
  markPromptAttemptStarted,
  PromptAttemptLeaseLostError,
  readPromptAttemptHealth,
  reservePromptAttemptPlan,
  resetPromptAttemptStreak,
  saveCheckpointAndFinishAttempts,
} from "@repo/audit/prompt-attempt-store";
import { PrismaClient } from "@repo/database/generated/client";
import { PrismaPg } from "@repo/database/node_modules/@prisma/adapter-pg/dist/index.mjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  database: null as unknown,
  ledgerEnabled: false,
}));
vi.mock("@repo/database", () => ({
  get database() {
    return state.database;
  },
}));
vi.mock("@repo/audit/keys", () => ({
  keys: () => ({ PROMPT_ATTEMPT_LEDGER_ENABLED: state.ledgerEnabled }),
}));
vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@repo/observability/error", () => ({
  parseError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

const tempDir = mkdtempSync("/tmp/findable-prompt-attempt-pg-");
const socketDir = join(tempDir, "socket");
const port = 17_200 + Math.floor(Math.random() * 500);
const role = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
const connectionString = `postgresql://${role}@127.0.0.1:${port}/postgres?application_name=findable_prompt_attempt`;
let serverStarted = false;
let database: PrismaClient;
// initdb/postmaster abort on macOS without a valid locale
// ("postmaster became multithreaded during startup"), so pin C locale here.
const pgEnv = { ...process.env, LC_ALL: "C", LANG: "C" };
const migrationSql = readFileSync(
  fileURLToPath(
    new URL(
      "../../../packages/database/prisma/migrations/20261005_prompt_attempt_ledger/migration.sql",
      import.meta.url
    )
  ),
  "utf8"
);

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8", env: pgEnv });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
}

function startDatabase() {
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
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (
      spawnSync("pg_isready", ["-h", "127.0.0.1", "-p", String(port)])
        .status === 0
    ) {
      return;
    }
  }
  throw new Error("PostgreSQL readiness timed out");
}

const BRAND = "brand-1";
const prompts = Array.from({ length: 9 }, (_, index) => ({
  id: `p${index + 1}`,
  lastTrackedAt: null,
}));

async function createJob(id: string, leaseToken: string, validSeconds = 300) {
  await database.$executeRawUnsafe(
    `INSERT INTO "AuditJob" ("id", "status", "leaseToken", "leaseUntil")
     VALUES ($1, 'processing', $2, (now() AT TIME ZONE 'UTC') + make_interval(secs => $3))`,
    id,
    leaseToken,
    validSeconds
  );
}

/** 만료 → sweeper/measure-one 재큐 → 새 claim 을 한 번에 흉내 낸다. */
async function reclaimJob(id: string, newLeaseToken: string) {
  await database.$executeRawUnsafe(
    `UPDATE "AuditJob" SET "leaseToken" = $2,
       "leaseUntil" = (now() AT TIME ZONE 'UTC') + interval '5 minutes',
       "status" = 'processing'
     WHERE "id" = $1`,
    id,
    newLeaseToken
  );
}

async function setJobStatus(id: string, status: "completed" | "failed") {
  await database.$executeRawUnsafe(
    `UPDATE "AuditJob" SET "status" = $2::"AuditStatus" WHERE "id" = $1`,
    id,
    status
  );
}

function reserve(
  auditJobId: string,
  leaseToken: string,
  limit = 8,
  options: {
    candidates?: typeof prompts;
    saveCheckpoint?: Parameters<
      typeof reservePromptAttemptPlan
    >[0]["saveCheckpoint"];
  } = {}
) {
  return reservePromptAttemptPlan({
    auditJobId,
    brandId: BRAND,
    leaseToken,
    limit,
    prompts: options.candidates ?? prompts,
    saveCheckpoint:
      options.saveCheckpoint ??
      ((selected, tx) =>
        saveQuestionCheckpoint(
          auditJobId,
          leaseToken,
          { plan: selected.map((prompt) => prompt.id) } as never,
          tx
        )),
  });
}

async function measure(
  auditJobId: string,
  leaseToken: string,
  promptIds: readonly string[],
  outcome: "completed" | "failed" | "unverified"
) {
  for (const promptId of promptIds) {
    await markPromptAttemptStarted(auditJobId, leaseToken, promptId);
    await saveCheckpointAndFinishAttempts({
      auditJobId,
      checkpoint: { done: promptId } as never,
      finishes: [{ promptId, outcome }],
      leaseToken,
    });
  }
}

async function attemptRows(auditJobId?: string): Promise<PromptAttempt[]> {
  return (await database.promptAttempt.findMany({
    where: auditJobId ? { auditJobId } : {},
    orderBy: { selectionSeq: "asc" },
  })) as PromptAttempt[];
}

async function checkpointOf(id: string) {
  const rows = await database.$queryRawUnsafe<Array<{ checkpoint: unknown }>>(
    `SELECT "checkpoint" FROM "AuditJob" WHERE "id" = $1`,
    id
  );
  return rows[0]?.checkpoint ?? null;
}

async function resetData() {
  await database.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS fail_checkpoint ON "AuditJob";
     TRUNCATE "PromptAttempt", "PromptAttemptReset", "AuditJob", "Tracking";`
  );
}

beforeAll(async () => {
  startDatabase();
  database = new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 4 }),
  });
  state.database = database;
  await database.$executeRawUnsafe(`
    CREATE TYPE "AuditStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');
    CREATE TABLE "AuditJob" (
      "id" text PRIMARY KEY,
      "status" "AuditStatus" NOT NULL DEFAULT 'queued',
      "checkpoint" jsonb,
      "leaseToken" text,
      "leaseUntil" timestamp(3)
    );
    CREATE TABLE "Tracking" ("id" text PRIMARY KEY, "promptId" text NOT NULL);
  `);
});

afterAll(async () => {
  await database?.$disconnect();
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

describe("PromptAttempt ledger on disposable PostgreSQL", () => {
  it("flag off: reads never query, and a missing table is tolerated before the migration", async () => {
    const touched: string[] = [];
    state.database = new Proxy(database, {
      get(target, property, receiver) {
        touched.push(String(property));
        return Reflect.get(target, property, receiver);
      },
    });
    state.ledgerEnabled = false;
    expect(await readPromptAttemptHealth(BRAND, prompts)).toBeNull();
    await expect(
      resetPromptAttemptStreak({ brandId: BRAND, promptId: "p1" })
    ).rejects.toThrow("disabled");
    expect(touched).toEqual([]);
    state.database = database;

    // Flag flipped before the migration (wrong order): reads still degrade to null.
    state.ledgerEnabled = true;
    expect(await readPromptAttemptHealth(BRAND, prompts)).toBeNull();
    state.ledgerEnabled = false;

    // Apply the real migration for the remaining cases.
    await database.$executeRawUnsafe(migrationSql);
  });

  it("RED 1: 9 questions / 8 slots / all 8 fail → the next job reaches the 9th", async () => {
    await resetData();
    await createJob("job-1", "lease-1");
    const first = await reserve("job-1", "lease-1");
    const firstIds = first.prompts.map((prompt) => prompt.id);
    expect(firstIds).toHaveLength(8);
    await measure("job-1", "lease-1", firstIds, "failed");
    await setJobStatus("job-1", "completed");

    await createJob("job-2", "lease-2");
    const second = await reserve("job-2", "lease-2");
    expect(second.prompts.map((prompt) => prompt.id)).toContain("p9");
  });

  it("RED 2: a crash inside reservation leaves neither intent rows nor checkpoint", async () => {
    await resetData();
    await createJob("job-1", "lease-1");
    await expect(
      reserve("job-1", "lease-1", 8, {
        saveCheckpoint: async (selected, tx) => {
          await saveQuestionCheckpoint(
            "job-1",
            "lease-1",
            { plan: selected.map((prompt) => prompt.id) } as never,
            tx
          );
          throw new Error("process crashed");
        },
      })
    ).rejects.toThrow("process crashed");

    expect(await attemptRows()).toHaveLength(0);
    expect(await checkpointOf("job-1")).toBeNull();
  });

  it("RED 3: crash after intent + checkpoint → resume reuses the same plan under the new lease", async () => {
    await resetData();
    await createJob("job-1", "lease-1");
    const first = await reserve("job-1", "lease-1", 3);
    expect(await checkpointOf("job-1")).toEqual({
      plan: first.prompts.map((prompt) => prompt.id),
    });

    await reclaimJob("job-1", "lease-2");
    const resumed = await reserve("job-1", "lease-2", 3);
    expect(resumed.resumed).toBe(true);
    expect(resumed.prompts.map((prompt) => prompt.id)).toEqual(
      first.prompts.map((prompt) => prompt.id)
    );
    const rows = await attemptRows("job-1");
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.leaseToken === "lease-2")).toBe(true);
  });

  it("RED 4: crash after dispatch keeps the dispatch; re-dispatch by the next lease counts attemptNo 2", async () => {
    await resetData();
    await createJob("job-1", "lease-1");
    await reserve("job-1", "lease-1", 1);
    expect(await markPromptAttemptStarted("job-1", "lease-1", "p1")).toBe(true);
    // crash: never finished
    await reclaimJob("job-1", "lease-2");
    expect(await adoptPromptAttemptPlan("job-1", "lease-2")).toBe(1);
    const [afterCrash] = await attemptRows("job-1");
    expect(afterCrash).toMatchObject({
      attemptNo: 1,
      startedLeaseToken: "lease-1",
      finishedAt: null,
      leaseToken: "lease-2",
    });
    expect(afterCrash.startedAt).not.toBeNull();

    // A finish by the new lease without re-dispatch cannot claim the old call.
    await saveCheckpointAndFinishAttempts({
      auditJobId: "job-1",
      checkpoint: {} as never,
      finishes: [{ promptId: "p1", outcome: "completed" }],
      leaseToken: "lease-2",
    });
    expect((await attemptRows("job-1"))[0].finishedAt).toBeNull();

    expect(await markPromptAttemptStarted("job-1", "lease-2", "p1")).toBe(true);
    const [redispatched] = await attemptRows("job-1");
    expect(redispatched).toMatchObject({
      attemptNo: 2,
      startedLeaseToken: "lease-2",
    });
  });

  it("RED 5: concurrent jobs of one brand reserve disjoint question sets", async () => {
    await resetData();
    await createJob("job-a", "lease-a");
    await createJob("job-b", "lease-b");
    const slow = (jobId: string, lease: string) =>
      reserve(jobId, lease, 4, {
        saveCheckpoint: async (selected, tx) => {
          // Hold the brand lock long enough for the other job to contend.
          await new Promise((resolve) => setTimeout(resolve, 150));
          await saveQuestionCheckpoint(
            jobId,
            lease,
            { plan: selected.map((prompt) => prompt.id) } as never,
            tx
          );
        },
      });
    const [a, b] = await Promise.all([
      slow("job-a", "lease-a"),
      slow("job-b", "lease-b"),
    ]);
    const aIds = a.prompts.map((prompt) => prompt.id);
    const bIds = b.prompts.map((prompt) => prompt.id);
    expect(aIds).toHaveLength(4);
    expect(bIds).toHaveLength(4);
    expect(aIds.filter((id) => bIds.includes(id))).toEqual([]);
    expect((await attemptRows()).map((row) => row.selectionSeq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it("RED 6: a late (superseded or expired) lease writes zero started/finished rows", async () => {
    await resetData();
    await createJob("job-1", "lease-1");
    await reserve("job-1", "lease-1", 2);
    await reclaimJob("job-1", "lease-2");

    await expect(
      markPromptAttemptStarted("job-1", "lease-1", "p1")
    ).rejects.toBeInstanceOf(PromptAttemptLeaseLostError);
    await expect(
      saveCheckpointAndFinishAttempts({
        auditJobId: "job-1",
        checkpoint: {} as never,
        finishes: [{ promptId: "p1", outcome: "completed" }],
        leaseToken: "lease-1",
      })
    ).rejects.toBeInstanceOf(PromptAttemptLeaseLostError);

    // Expired but not yet reclaimed lease is also dead.
    await createJob("job-2", "lease-x", -1);
    await expect(
      markPromptAttemptStarted("job-2", "lease-x", "p3")
    ).rejects.toBeInstanceOf(PromptAttemptLeaseLostError);

    const rows = await attemptRows("job-1");
    expect(rows.every((row) => row.startedAt === null)).toBe(true);
    expect(rows.every((row) => row.finishedAt === null)).toBe(true);
  });

  it("RED 7: a checkpoint write failure rolls back the attempt finish", async () => {
    await resetData();
    await createJob("job-1", "lease-1");
    await reserve("job-1", "lease-1", 1);
    await markPromptAttemptStarted("job-1", "lease-1", "p1");
    await database.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_checkpoint() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'checkpoint storage failed'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_checkpoint BEFORE UPDATE OF "checkpoint" ON "AuditJob"
      FOR EACH ROW EXECUTE FUNCTION fail_checkpoint();
    `);
    await expect(
      saveCheckpointAndFinishAttempts({
        auditJobId: "job-1",
        checkpoint: { done: "p1" } as never,
        finishes: [{ promptId: "p1", outcome: "completed" }],
        leaseToken: "lease-1",
      })
    ).rejects.toThrow();
    const [row] = await attemptRows("job-1");
    expect(row.finishedAt).toBeNull();
    expect(row.outcome).toBeNull();
  });

  it("RED 8: failed/unverified ledger rows never become success Tracking or measurement", async () => {
    await resetData();
    await createJob("job-1", "lease-1");
    await reserve("job-1", "lease-1", 2);
    await measure("job-1", "lease-1", ["p1"], "failed");
    await measure("job-1", "lease-1", ["p2"], "unverified");

    const rows = await attemptRows("job-1");
    expect(rows.map((row) => row.outcome)).toEqual(["failed", "unverified"]);
    expect(rows.some(isSuccessfulMeasurement)).toBe(false);
    const tracking = await database.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM "Tracking"`
    );
    expect(Number(tracking[0]?.n)).toBe(0);
  });

  it("policy: 2 consecutive failures skip the prompt for the next 2 runs, then it returns", async () => {
    await resetData();
    const four = prompts.slice(0, 4);
    let job = 0;
    const runOnce = async (
      outcomes: Record<string, "completed" | "failed">
    ) => {
      job += 1;
      const id = `job-${job}`;
      await createJob(id, `lease-${job}`);
      const plan = await reserve(id, `lease-${job}`, 4, { candidates: four });
      const ids = plan.prompts.map((prompt) => prompt.id);
      for (const promptId of ids) {
        await measure(
          id,
          `lease-${job}`,
          [promptId],
          outcomes[promptId] ?? "completed"
        );
      }
      await setJobStatus(id, "completed");
      return ids;
    };
    await runOnce({ p1: "failed" });
    await runOnce({ p1: "failed" });
    expect(await runOnce({})).not.toContain("p1");
    expect(await runOnce({})).not.toContain("p1");
    expect(await runOnce({})).toContain("p1");

    state.ledgerEnabled = true;
    const health = await readPromptAttemptHealth(BRAND, four);
    state.ledgerEnabled = false;
    expect(health?.find((verdict) => verdict.promptId === "p1")).toMatchObject({
      health: "ok",
      consecutiveFailures: 0,
    });
  });

  it("policy: needs-attention after 5 failures; manual reset re-admits it", async () => {
    await resetData();
    const four = prompts.slice(0, 4);
    // 5 consecutive failures recorded on p1 by past jobs (each its own run).
    for (let index = 1; index <= 5; index += 1) {
      const id = `old-${index}`;
      await createJob(id, `old-lease-${index}`);
      await reserve(id, `old-lease-${index}`, 1, { candidates: [four[0]] });
      await measure(id, `old-lease-${index}`, ["p1"], "failed");
      await setJobStatus(id, "completed");
    }
    // Plenty of runs since the last failure, so only needs-attention can block it.
    for (let index = 1; index <= 3; index += 1) {
      const id = `filler-${index}`;
      await createJob(id, `filler-lease-${index}`);
      await reserve(id, `filler-lease-${index}`, 1, { candidates: [four[1]] });
      await setJobStatus(id, "completed");
    }
    await createJob("job-now", "lease-now");
    const blocked = await reserve("job-now", "lease-now", 4, {
      candidates: four,
    });
    expect(blocked.prompts.map((prompt) => prompt.id)).not.toContain("p1");
    expect(
      blocked.verdicts.find((verdict) => verdict.promptId === "p1")?.health
    ).toBe("needs_attention");
    await setJobStatus("job-now", "completed");

    state.ledgerEnabled = true;
    await resetPromptAttemptStreak({ brandId: BRAND, promptId: "p1" });
    state.ledgerEnabled = false;
    await createJob("job-after-reset", "lease-after-reset");
    const readmitted = await reserve(
      "job-after-reset",
      "lease-after-reset",
      4,
      {
        candidates: four,
      }
    );
    expect(readmitted.prompts.map((prompt) => prompt.id)).toContain("p1");
  });

  it("reclaims never-dispatched intent of a finished job so its turn is not lost", async () => {
    await resetData();
    const three = prompts.slice(0, 3);
    await createJob("job-1", "lease-1");
    await reserve("job-1", "lease-1", 2, { candidates: three });
    // Only p1 was dispatched before the time budget stopped the run.
    await measure("job-1", "lease-1", ["p1"], "completed");
    await setJobStatus("job-1", "completed");

    await createJob("job-2", "lease-2");
    const next = await reserve("job-2", "lease-2", 2, { candidates: three });
    expect(next.prompts.map((prompt) => prompt.id)).toEqual(["p2", "p3"]);
  });
});
