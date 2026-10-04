/** @vitest-environment node */

// W0-0 `_prisma_migrations` baseline gate.
// Before any release touches the production schema, an operator must be able to
// prove — read-only — which repository migrations the target DB has applied,
// which are pending, which failed or were rolled back, which applied rows the
// repository does not know (e.g. a migration created in another checkout), and
// whether an applied file was edited afterwards (checksum drift).

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@repo/database/generated/client";
import { PrismaPg } from "@repo/database/node_modules/@prisma/adapter-pg/dist/index.mjs";
import {
  evaluateMigrationBaseline,
  listRepoMigrations,
  readMigrationBaseline,
} from "@repo/database/prisma/migration-baseline-gate";
import { afterAll, describe, expect, it } from "vitest";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const tempDir = mkdtempSync("/tmp/findable-migration-gate-");
const migrationsDir = join(tempDir, "migrations");
const dbDir = join(tempDir, "db");
const socketDir = join(tempDir, "socket");
const port = 16_132 + Math.floor(Math.random() * 100);
const role = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
const connectionString = `postgresql://${role}@127.0.0.1:${port}/postgres`;
let serverStarted = false;
// initdb/postmaster abort on macOS without a valid locale
// ("postmaster became multithreaded during startup"), so pin C locale here.
const pgEnv = { ...process.env, LC_ALL: "C", LANG: "C" };

const files: Record<string, string> = {
  "20260818_invite_code": 'CREATE TABLE "A" (id int);\n',
  "20260928_client_report_link": 'CREATE TABLE "B" (id int);\n',
  "20261004_tracking_row_key": 'CREATE TABLE "C" (id int);\n',
};
mkdirSync(migrationsDir);
for (const [name, sql] of Object.entries(files)) {
  mkdirSync(join(migrationsDir, name));
  writeFileSync(join(migrationsDir, name, "migration.sql"), sql);
}
writeFileSync(
  join(migrationsDir, "migration_lock.toml"),
  'provider = "postgresql"\n'
);

describe("listRepoMigrations", () => {
  it("lists migration folders with the sha256 Prisma stores as checksum", () => {
    expect(listRepoMigrations(migrationsDir)).toEqual(
      Object.entries(files).map(([name, sql]) => ({ name, checksum: sha(sql) }))
    );
  });
});

describe("evaluateMigrationBaseline", () => {
  const repo = listRepoMigrations(migrationsDir);
  const applied = (name: string, sql = files[name] ?? "") => ({
    migration_name: name,
    checksum: sha(sql),
    finished_at: new Date("2026-10-01T00:00:00Z"),
    rolled_back_at: null,
  });

  it("fails closed when the DB has no migration history", () => {
    const verdict = evaluateMigrationBaseline(repo, []);
    expect(verdict.ok).toBe(false);
    expect(verdict.pending).toEqual(Object.keys(files));
  });

  it("separates pending, unknown, failed, rolled back and edited migrations", () => {
    const verdict = evaluateMigrationBaseline(repo, [
      applied("20260818_invite_code", "-- edited after apply\n"),
      {
        ...applied("20260928_client_report_link"),
        finished_at: null,
      },
      {
        ...applied("20260925_outreach_mail_drafts", "x"),
      },
      {
        ...applied("20261004_tracking_row_key"),
        rolled_back_at: new Date("2026-10-04T00:00:00Z"),
      },
    ]);
    expect(verdict).toEqual({
      ok: false,
      applied: [],
      pending: ["20261004_tracking_row_key"],
      unknownInDb: ["20260925_outreach_mail_drafts"],
      failed: ["20260928_client_report_link"],
      rolledBack: ["20261004_tracking_row_key"],
      checksumMismatch: ["20260818_invite_code"],
    });
  });

  it("passes only when every repo migration is applied once with its checksum", () => {
    const verdict = evaluateMigrationBaseline(
      repo,
      Object.keys(files).map((name) => applied(name))
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.applied).toEqual(Object.keys(files));
  });

  it("accepts a rolled-back attempt that was later re-applied", () => {
    const verdict = evaluateMigrationBaseline(repo, [
      ...Object.keys(files).map((name) => applied(name)),
      {
        ...applied("20261004_tracking_row_key"),
        rolled_back_at: new Date("2026-10-03T00:00:00Z"),
      },
    ]);
    expect(verdict.ok).toBe(true);
    expect(verdict.rolledBack).toEqual([]);
  });
});

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8", env: pgEnv });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
}

afterAll(() => {
  if (serverStarted) {
    spawnSync(
      "pg_ctl",
      [
        "-D",
        dbDir,
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

describe("readMigrationBaseline against a disposable PostgreSQL", () => {
  it("reads _prisma_migrations read-only and reports the baseline", async () => {
    run("initdb", ["-D", dbDir, "-A", "trust", "--no-locale"]);
    mkdirSync(socketDir);
    run("pg_ctl", [
      "-D",
      dbDir,
      "-o",
      `-p ${port} -k ${socketDir}`,
      "-l",
      join(tempDir, "postgres.log"),
      "start",
    ]);
    serverStarted = true;
    const deadline = Date.now() + 5000;
    while (
      spawnSync("pg_isready", ["-h", "127.0.0.1", "-p", String(port)])
        .status !== 0 &&
      Date.now() < deadline
    ) {
      // wait for readiness
    }

    const missingTable = await readMigrationBaseline(
      connectionString,
      migrationsDir
    );
    expect(missingTable.ok).toBe(false);
    expect(missingTable.historyTable).toBe("missing");

    const admin = new PrismaClient({
      adapter: new PrismaPg({ connectionString, max: 1 }),
    });
    try {
      await admin.$executeRawUnsafe(`CREATE TABLE "_prisma_migrations" (
        id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL,
        finished_at timestamptz, migration_name varchar(255) NOT NULL,
        logs text, rolled_back_at timestamptz,
        started_at timestamptz NOT NULL DEFAULT now(),
        applied_steps_count integer NOT NULL DEFAULT 0)`);
      let i = 0;
      for (const [name, sql] of Object.entries(files).slice(0, 2)) {
        i++;
        await admin.$executeRawUnsafe(
          `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name)
           VALUES ($1, $2, now(), $3)`,
          `m${i}`,
          sha(sql),
          name
        );
      }
      const partial = await readMigrationBaseline(
        connectionString,
        migrationsDir
      );
      expect(partial.historyTable).toBe("present");
      expect(partial.ok).toBe(false);
      expect(partial.pending).toEqual(["20261004_tracking_row_key"]);

      await admin.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name)
         VALUES ('m3', $1, now(), '20261004_tracking_row_key')`,
        sha(files["20261004_tracking_row_key"] ?? "")
      );
      const full = await readMigrationBaseline(connectionString, migrationsDir);
      expect(full.ok).toBe(true);
      expect(full.applied).toEqual(Object.keys(files));
    } finally {
      await admin.$disconnect();
    }
  }, 30_000);
});
