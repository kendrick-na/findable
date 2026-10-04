/** @vitest-environment node */

// Hardening from the adversarial review of 4b723e0 / fcc8126:
// - the operator kit must mirror `A ?? B` env fallbacks (app migrate reads
//   DATABASE_URL_UNPOOLED ?? DATABASE_URL), otherwise step 1 can never pass;
// - `?schema=` selects the Prisma schema, so it is part of the target and of
//   where _prisma_migrations / Engine live;
// - a live unfinished migration row means failed even next to a finished row
//   (Prisma `migrate status` reports failed, `migrate deploy` refuses P3009);
// - parse errors must not echo the raw value.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  connectionSchema,
  fingerprintDatabaseUrl,
  parseTargetSpec,
  resolveEnvSpec,
  safeErrorLabel,
} from "@repo/database/prisma/db-target-fingerprint";
import { evaluateMigrationBaseline } from "@repo/database/prisma/migration-baseline-gate";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync("/tmp/findable-inspection-hardening-");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const url = (db: string, query = "") =>
  `postgresql://u:p@ep-a-1.x.neon.tech/${db}${query}`;

describe("env spec fallbacks", () => {
  it("mirrors JS ?? exactly: first defined variable wins, empty stops instead of falling back", () => {
    const file = join(dir, "app.env");
    writeFileSync(
      file,
      `DATABASE_URL="${url("db")}"\nDATABASE_URL_UNPOOLED=""\n`
    );
    // Runtime `A ?? B` picks "" for A (then z.url() fails); never silently use B.
    expect(
      resolveEnvSpec(`${file}#DATABASE_URL_UNPOOLED??DATABASE_URL`)
    ).toBeUndefined();
    expect(resolveEnvSpec(`${file}#ABSENT??DATABASE_URL`)).toBe(url("db"));
    expect(parseTargetSpec(`app.migrate=${file}#ABSENT??DATABASE_URL`)).toEqual(
      { label: "app.migrate", value: url("db") }
    );
    expect(resolveEnvSpec(`${file}#NOPE??ALSO_NOPE`)).toBeUndefined();
  });
});

describe("Supabase targets", () => {
  const pooler = (ref: string, port = 6543) =>
    `postgresql://postgres.${ref}:pw@aws-0-ap-northeast-2.pooler.supabase.com:${port}/postgres`;
  const direct = (ref: string) =>
    `postgresql://postgres:pw@db.${ref}.supabase.co:5432/postgres`;

  it("separates projects that share a regional pooler host", () => {
    expect(fingerprintDatabaseUrl(pooler("aaaaaaaa")).target).not.toBe(
      fingerprintDatabaseUrl(pooler("bbbbbbbb")).target
    );
  });

  it("joins direct, session and transaction connections of one project", () => {
    const t = fingerprintDatabaseUrl(direct("aaaaaaaa")).target;
    expect(fingerprintDatabaseUrl(pooler("aaaaaaaa")).target).toBe(t);
    expect(fingerprintDatabaseUrl(pooler("aaaaaaaa", 5432)).target).toBe(t);
  });

  it("fails closed on a pooler user without a project ref", () => {
    expect(() =>
      fingerprintDatabaseUrl(
        "postgresql://postgres:pw@aws-0-x.pooler.supabase.com:6543/postgres"
      )
    ).toThrow();
  });
});

describe("schema-aware targets", () => {
  it("treats ?schema= as part of the target and defaults to public", () => {
    expect(connectionSchema(url("db"))).toBe("public");
    expect(connectionSchema(url("db", "?schema=tenant"))).toBe("tenant");
    expect(fingerprintDatabaseUrl(url("db", "?schema=tenant")).target).not.toBe(
      fingerprintDatabaseUrl(url("db")).target
    );
    expect(fingerprintDatabaseUrl(url("db", "?schema=public")).target).toBe(
      fingerprintDatabaseUrl(url("db")).target
    );
  });

  it("rejects schema names that are not plain identifiers", () => {
    expect(() => connectionSchema(url("db", '?schema=a"b'))).toThrow();
  });
});

describe("Prisma-equivalent failed state", () => {
  it("reports failed when an unfinished, non-rolled-back row sits next to a finished one", () => {
    const repo = [{ name: "20261004_tracking_row_key", checksum: "c" }];
    const verdict = evaluateMigrationBaseline(repo, [
      {
        migration_name: "20261004_tracking_row_key",
        checksum: "c",
        finished_at: null,
        rolled_back_at: null,
      },
      {
        migration_name: "20261004_tracking_row_key",
        checksum: "c",
        finished_at: new Date(),
        rolled_back_at: null,
      },
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toEqual(["20261004_tracking_row_key"]);
  });
});

describe("safeErrorLabel", () => {
  it("never includes the error message, which may contain the raw value", () => {
    let caught: unknown;
    try {
      new URL("host=secret-host password=hunter2");
    } catch (error) {
      caught = error;
    }
    const label = safeErrorLabel(caught);
    expect(label).not.toContain("hunter2");
    expect(label).not.toContain("secret-host");
    expect(label).toMatch(/TypeError/);
  });
});

describe("schema handling against a disposable PostgreSQL", () => {
  it("baseline follows ?schema= like migrate; Engine gate reads public like the runtime", async () => {
    const { execFileSync, spawnSync } = await import("node:child_process");
    const { createHash } = await import("node:crypto");
    const { mkdirSync } = await import("node:fs");
    const { PrismaPg } = await import(
      "@repo/database/node_modules/@prisma/adapter-pg/dist/index.mjs"
    );
    const { PrismaClient } = await import("@repo/database/generated/client");
    const { readEngineSeedState } = await import(
      "@repo/database/prisma/engine-seed-gate"
    );
    const { readMigrationBaseline } = await import(
      "@repo/database/prisma/migration-baseline-gate"
    );
    const pgEnv = { ...process.env, LC_ALL: "C", LANG: "C" };
    const dbDir = join(dir, "pg");
    const socketDir = join(dir, "pgsock");
    const port = 16_332 + Math.floor(Math.random() * 100);
    const role = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
    const base = `postgresql://${role}@127.0.0.1:${port}/postgres`;
    const run = (cmd: string, args: string[]) => {
      const r = spawnSync(cmd, args, { encoding: "utf8", env: pgEnv });
      if (r.status !== 0) {
        throw new Error(`${cmd} failed: ${r.stderr || r.stdout}`);
      }
    };
    run("initdb", ["-D", dbDir, "-A", "trust", "--no-locale"]);
    mkdirSync(socketDir);
    run("pg_ctl", [
      "-D",
      dbDir,
      "-o",
      `-p ${port} -k ${socketDir}`,
      "-l",
      join(dir, "pg.log"),
      "start",
    ]);
    const migrationsDir = join(dir, "migrations");
    mkdirSync(join(migrationsDir, "20260818_invite_code"), { recursive: true });
    const sql = 'CREATE TABLE "A" (id int);\n';
    writeFileSync(
      join(migrationsDir, "20260818_invite_code", "migration.sql"),
      sql
    );
    const admin = new PrismaClient({
      adapter: new PrismaPg({ connectionString: base, max: 1 }),
    });
    try {
      for (let i = 0; i < 50; i++) {
        try {
          await admin.$executeRawUnsafe("SELECT 1");
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      await admin.$executeRawUnsafe("CREATE SCHEMA tenant");
      for (const schema of ["public", "tenant"]) {
        await admin.$executeRawUnsafe(
          `CREATE TABLE ${schema}."Engine" (id text PRIMARY KEY)`
        );
      }
      await admin.$executeRawUnsafe(`CREATE TABLE tenant."_prisma_migrations" (
        id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL,
        finished_at timestamptz, migration_name varchar(255) NOT NULL,
        logs text, rolled_back_at timestamptz,
        started_at timestamptz NOT NULL DEFAULT now(),
        applied_steps_count integer NOT NULL DEFAULT 0)`);
      await admin.$executeRawUnsafe(
        `INSERT INTO tenant."_prisma_migrations" (id, checksum, finished_at, migration_name)
         VALUES ('m1', $1, now(), '20260818_invite_code')`,
        createHash("sha256").update(sql).digest("hex")
      );
      await admin.$executeRawUnsafe(
        `INSERT INTO tenant."Engine" (id) VALUES ('chatgpt')`
      );

      const tenantUrl = `${base}?schema=tenant`;
      const baseline = await readMigrationBaseline(tenantUrl, migrationsDir);
      expect(baseline.historyTable).toBe("present");
      expect(baseline.ok).toBe(true);
      expect(
        (await readMigrationBaseline(base, migrationsDir)).historyTable
      ).toBe("missing");

      // Rows only in tenant must not satisfy the gate: the runtime reads public.
      const engines = await readEngineSeedState(tenantUrl, ["chatgpt"]);
      expect(engines).toEqual({ ok: false, missing: ["chatgpt"] });
    } finally {
      await admin.$disconnect();
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
        { stdio: "ignore", env: pgEnv }
      );
    }
  }, 60_000);
});
