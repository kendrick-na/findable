/** @vitest-environment node */

// W0-3 Engine seed gate.
// Tracking.engineId is an Engine FK and persistAuditTracking fails the whole
// write when any successful response engine is missing from the Engine table.
// Two things therefore have to hold before a release touches Tracking:
//   1. the seed's own engine list cannot drift from the runner's engine list;
//   2. operators can prove, read-only, that the target DB holds every row.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BETA_ENGINES, DEFAULT_ENGINES, ENGINES } from "@repo/ai/lib/engines";
import { PrismaClient } from "@repo/database/generated/client";
import { PrismaPg } from "@repo/database/node_modules/@prisma/adapter-pg/dist/index.mjs";
import {
  ACTIVE_ENGINE_IDS,
  ENGINE_SEED,
} from "@repo/database/prisma/engine-seed-data";
import {
  evaluateEngineSeed,
  readEngineSeedState,
} from "@repo/database/prisma/engine-seed-gate";
import { afterAll, describe, expect, it } from "vitest";

describe("Engine seed data stays aligned with the runner", () => {
  it("seeds exactly the runner's engine catalogue", () => {
    const pick = (e: {
      id: string;
      name: string;
      provider: string;
      language: string;
      ordering: number;
    }) => ({
      id: e.id,
      name: e.name,
      provider: e.provider,
      language: e.language,
      ordering: e.ordering,
    });
    expect(ENGINE_SEED.map(pick)).toEqual(ENGINES.map(pick));
  });

  it("marks exactly the default runner engines active", () => {
    expect([...ACTIVE_ENGINE_IDS].sort()).toEqual([...DEFAULT_ENGINES].sort());
  });

  it("seeds every engine the runner can emit, including opt-in briefing", () => {
    const seeded = new Set(ENGINE_SEED.map((e) => e.id));
    expect(BETA_ENGINES.filter((id) => !seeded.has(id))).toEqual([]);
  });
});

describe("evaluateEngineSeed", () => {
  const required = ENGINE_SEED.map((e) => e.id);

  it("fails closed on an empty Engine table", () => {
    const result = evaluateEngineSeed([], required);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([...required].sort());
  });

  it("names only the missing ids and ignores extra rows", () => {
    const rows: { id: string }[] = required
      .filter((id) => id !== "naver-briefing")
      .map((id) => ({ id }));
    rows.push({ id: "legacy-engine" });
    const result = evaluateEngineSeed(rows, required);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["naver-briefing"]);
  });

  it("passes when every required id exists", () => {
    const result = evaluateEngineSeed(
      required.map((id) => ({ id })),
      required
    );
    expect(result).toEqual({ ok: true, missing: [] });
  });
});

const tempDir = mkdtempSync("/tmp/findable-engine-seed-gate-");
const socketDir = join(tempDir, "socket");
const port = 16_032 + Math.floor(Math.random() * 100);
const role = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
const connectionString = `postgresql://${role}@127.0.0.1:${port}/postgres`;
let serverStarted = false;

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
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

afterAll(() => {
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

describe("readEngineSeedState against a disposable PostgreSQL", () => {
  it("reads Engine ids in a read-only transaction and gates on missing seed", async () => {
    startDatabase();
    const admin = new PrismaClient({
      adapter: new PrismaPg({ connectionString, max: 1 }),
    });
    try {
      await admin.$executeRawUnsafe(
        `CREATE TABLE "Engine" (id text PRIMARY KEY, "isActive" boolean NOT NULL DEFAULT true)`
      );
      const required = ENGINE_SEED.map((e) => e.id);

      const empty = await readEngineSeedState(connectionString, required);
      expect(empty.ok).toBe(false);
      expect(empty.missing).toEqual([...required].sort());

      for (const id of required.filter((id) => id !== "naver-briefing")) {
        await admin.$executeRawUnsafe(
          `INSERT INTO "Engine" (id) VALUES ($1)`,
          id
        );
      }
      const partial = await readEngineSeedState(connectionString, required);
      expect(partial).toEqual({ ok: false, missing: ["naver-briefing"] });

      await admin.$executeRawUnsafe(
        `INSERT INTO "Engine" (id) VALUES ('naver-briefing')`
      );
      const full = await readEngineSeedState(connectionString, required);
      expect(full).toEqual({ ok: true, missing: [] });

      const count = await admin.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "Engine"`
      );
      expect(count[0]?.n).toBe(required.length);

      await expect(
        admin.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
          await tx.$executeRawUnsafe(`DELETE FROM "Engine"`);
        })
      ).rejects.toThrow(/read-only/i);
    } finally {
      await admin.$disconnect();
    }
  }, 30_000);
});
