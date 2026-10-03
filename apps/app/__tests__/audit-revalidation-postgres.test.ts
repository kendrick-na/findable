/** @vitest-environment node */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@repo/database/node_modules/@prisma/adapter-pg/dist/index.mjs";
import { PrismaClient } from "@repo/database/generated/client";
import { afterAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("@repo/database", () => ({
  get database() { return state.database; },
}));
vi.mock("@repo/auth/admin", () => ({ requireAdmin: async () => "admin-1" }));
vi.mock("@repo/audit/revalidate-stored-audit", () => ({
  revalidateStoredAuditResult: async () => ({
    status: "revalidated",
    result: {
      engineResponses: [{ engineId: "chatgpt", brandMentioned: true }],
      metrics: { sov: 1 },
      mentionVerdictVersion: 2,
      revalidation: { version: 2 },
      geoActions: [],
      topRecommendations: [],
      regionScoresOutdated: true,
      actionsOutdated: true,
    },
    summary: {},
  }),
}));
vi.mock("@repo/observability/log", () => ({
  log: { warn: vi.fn(), error: vi.fn() },
}));

const tempDir = mkdtempSync("/tmp/findable-revalidation-pg-");
const socketDir = join(tempDir, "socket");
const port = 16100 + Math.floor(Math.random() * 1000);
const role = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
const connectionString = `postgresql://${role}@127.0.0.1:${port}/postgres?application_name=findable_revalidation_fixture`;
let serverStarted = false;

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
}

afterAll(() => {
  if (serverStarted) {
    spawnSync("pg_ctl", ["-D", tempDir, "-o", `-p ${port} -k ${socketDir}`, "stop", "-m", "immediate"], { stdio: "ignore" });
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("admin revalidation route with local PostgreSQL", () => {
  it("atomically clears the stale PDF link while preserving a completed briefing row", async () => {
    run("initdb", ["-D", tempDir, "-A", "trust", "--no-locale"]);
    mkdirSync(socketDir);
    run("pg_ctl", ["-D", tempDir, "-o", `-p ${port} -k ${socketDir}`, "-l", join(tempDir, "postgres.log"), "start"]);
    serverStarted = true;
    const database = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1 }) });
    state.database = database;
    try {
      await database.$executeRawUnsafe(`CREATE TABLE "AuditJob" ("id" text PRIMARY KEY, "status" text NOT NULL, "result" jsonb, "pdfUrl" text)`);
      const jobId = "11111111-1111-4111-8111-111111111111";
      const original = {
        engineResponses: [
          { engineId: "chatgpt", brandMentioned: false },
          { engineId: "naver-briefing", brandMentioned: true },
        ],
        briefingStatus: "completed",
        metrics: { sov: 0 },
      };
      await database.$executeRawUnsafe(
        `INSERT INTO "AuditJob" ("id", "status", "result", "pdfUrl") VALUES ($1, 'completed', $2::jsonb, $3)`,
        jobId,
        JSON.stringify(original),
        "https://blob.test/audit-v3-stale.pdf"
      );
      const { POST } = await import("../app/api/admin/audit-revalidation/route");
      const response = await POST(new Request("http://localhost/api/admin/audit-revalidation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobIds: [jobId], apply: true }),
      }));
      expect(response.status).toBe(200);
      expect((await response.json()).outcomes[0].status).toBe("applied");
      const rows = await database.$queryRawUnsafe<Array<{ pdfUrl: string | null; result: Record<string, unknown> }>>(
        `SELECT "pdfUrl", "result" FROM "AuditJob" WHERE "id" = $1`, jobId
      );
      expect(rows[0].pdfUrl).toBeNull();
      expect(rows[0].result.engineResponses).toEqual([
        { engineId: "chatgpt", brandMentioned: true },
        { engineId: "naver-briefing", brandMentioned: true },
      ]);
    } finally {
      await database.$disconnect();
    }
  });
});
