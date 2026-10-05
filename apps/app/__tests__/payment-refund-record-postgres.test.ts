/** @vitest-environment node */

// PaymentRefund 기록 — 일회용 PostgreSQL 위에서 실제 Prisma 어댑터 오류 코드로
// ① migration 적용 전(테이블 없음) 내성 + 1회 경고, ② 적용 후 멱등 기록을 검증한다.
// 운영/공유 DB 는 절대 쓰지 않는다(initdb 로 만든 임시 클러스터만).

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@repo/database/generated/client";
import { PrismaPg } from "@repo/database/node_modules/@prisma/adapter-pg/dist/index.mjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  database: null as unknown,
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@repo/database", () => ({
  get database() {
    return state.database;
  },
}));
vi.mock("@repo/observability/log", () => ({ log: state.log }));
vi.mock("@repo/observability/error", () => ({
  parseError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

const tempDir = mkdtempSync("/tmp/findable-payment-refund-pg-");
const socketDir = join(tempDir, "socket");
const port = 17_800 + Math.floor(Math.random() * 500);
const role = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
const connectionString = `postgresql://${role}@127.0.0.1:${port}/postgres?application_name=findable_payment_refund`;
let serverStarted = false;
let database: PrismaClient;
const pgEnv = { ...process.env, LC_ALL: "C", LANG: "C" };
const migrationSql = readFileSync(
  fileURLToPath(
    new URL(
      "../../../packages/database/prisma/migrations/20261005_payment_refund_record/migration.sql",
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

const fact = (overrides: Record<string, unknown> = {}) => ({
  paymentId: "fdbl-starter-owner-1-mut27bhc",
  userId: "user_owner-1",
  organizationId: "org-1",
  amount: 1000,
  kind: "partial" as const,
  refundedAt: new Date("2026-10-04T00:30:00.000Z"),
  ...overrides,
});

beforeAll(() => {
  startDatabase();
  database = new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 2 }),
  });
  state.database = database;
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

describe("PaymentRefund record on real PostgreSQL", () => {
  it("before the migration: writes and reads are tolerated and the gap is warned once", async () => {
    const { readPaymentRefundKind, recordPaymentRefund } = await import(
      "@/lib/billing/payment-refund-record"
    );
    expect(await recordPaymentRefund(fact())).toBe("unavailable");
    expect(await readPaymentRefundKind(fact().paymentId)).toBeNull();
    expect(await recordPaymentRefund(fact({ kind: "full" }))).toBe(
      "unavailable"
    );
    const missing = state.log.warn.mock.calls.filter(
      ([event]) => event === "payments.refund_record.table_missing"
    );
    expect(missing).toHaveLength(1);
    expect(state.log.error).not.toHaveBeenCalled();
  });

  it("after the migration: one row per payment, promoted partial to full, never demoted", async () => {
    await database.$executeRawUnsafe(migrationSql);
    const { readPaymentRefundKind, recordPaymentRefund } = await import(
      "@/lib/billing/payment-refund-record"
    );
    expect(await recordPaymentRefund(fact())).toBe("created");
    expect(await recordPaymentRefund(fact())).toBe("unchanged");
    expect(await readPaymentRefundKind(fact().paymentId)).toBe("partial");

    const fullAt = new Date("2026-10-04T01:00:00.000Z");
    expect(
      await recordPaymentRefund(
        fact({ kind: "full", amount: 49_500, refundedAt: fullAt })
      )
    ).toBe("updated");
    // Concurrent duplicates converge on one row.
    const replay = await Promise.all(
      Array.from({ length: 5 }, () =>
        recordPaymentRefund(
          fact({ kind: "full", amount: 49_500, refundedAt: fullAt })
        )
      )
    );
    expect(replay.every((result) => result === "unchanged")).toBe(true);
    // A stale partial replay does not demote or shrink.
    expect(await recordPaymentRefund(fact())).toBe("unchanged");

    const rows = await database.paymentRefund.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "full",
      amount: 49_500,
      refundedAt: fullAt,
      organizationId: "org-1",
    });
    expect(await readPaymentRefundKind(fact().paymentId)).toBe("full");
    expect(state.log.error).not.toHaveBeenCalled();
  });
});
