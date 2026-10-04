/** @vitest-environment node */

// W0-2 read-only inventory of already-issued Report/PDF exposure.
// The web quarantine hides narrative and stored PDF links for every frozen
// snapshot, but a stored PDF URL that was already delivered keeps working.
// Operators need a per-customer list — without tokens, URLs or e-mails — to
// decide keep / reissue / revoke / notify for each issued artefact.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  classifyHistoricalReport,
  readHistoricalReportInventory,
  summarizeHistoricalInventory,
} from "@repo/audit/client-report/historical-inventory";
import { PrismaClient } from "@repo/database/generated/client";
import { PrismaPg } from "@repo/database/node_modules/@prisma/adapter-pg/dist/index.mjs";
import { afterAll, describe, expect, it } from "vitest";

const snapshot = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "fixtures/client-report/knowverse.report.json"),
    "utf8"
  )
) as unknown;
const blobUrl =
  "https://abc123.public.blob.vercel-storage.com/reports/knowverse-secret-name.pdf";
const token = "tok_9f8e7d6c5b4a3210";

const baseRow = {
  id: "r-1",
  organizationId: "org-1",
  brandId: "brand-1",
  type: "custom",
  generatedAt: new Date("2026-09-28T15:00:00Z"),
  accessToken: token as string | null,
  pdfUrl: blobUrl as string | null,
  data: snapshot,
  viewCount: 3,
  lastViewedAt: new Date("2026-10-01T09:00:00Z") as Date | null,
};

describe("classifyHistoricalReport", () => {
  it("flags a live web link and a still-addressable stored Blob PDF", () => {
    const record = classifyHistoricalReport(baseRow);
    expect(record).toMatchObject({
      reportId: "r-1",
      organizationId: "org-1",
      snapshot: "parsed",
      templateVersion: "geo-report-template@2026-09-28",
      currentTemplate: false,
      webLinkActive: true,
      narrativeQuarantinedOnWeb: true,
      pdf: { present: true, host: "vercel-blob", hiddenOnWeb: true },
      directPdfUrlNeedsDecision: true,
      viewed: { count: 3, lastViewedAt: "2026-10-01T09:00:00.000Z" },
      decision: "undecided",
    });
    expect(record.pdf.urlSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never echoes access tokens, PDF URLs or file names", () => {
    const serialized = JSON.stringify(classifyHistoricalReport(baseRow));
    for (const secret of [token, blobUrl, "knowverse-secret-name", "abc123"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("keeps unparseable and empty snapshots in the inventory instead of dropping them", () => {
    expect(
      classifyHistoricalReport({ ...baseRow, data: { broken: true } }).snapshot
    ).toBe("unparseable");
    const empty = classifyHistoricalReport({
      ...baseRow,
      data: null,
      pdfUrl: null,
      accessToken: null,
    });
    expect(empty).toMatchObject({
      snapshot: "missing",
      webLinkActive: false,
      pdf: { present: false, host: "none", hiddenOnWeb: false },
      directPdfUrlNeedsDecision: false,
    });
  });

  it("does not treat a self-approving embedded publicationReview as trusted", () => {
    const selfApproved = {
      ...(snapshot as Record<string, unknown>),
      publicationReview: {
        narrativeApproved: true,
        reviewedAt: "2026-10-04T00:00:00Z",
        reviewerUserId: "self",
      },
    };
    const record = classifyHistoricalReport({ ...baseRow, data: selfApproved });
    expect(record.embeddedReviewPresent).toBe(true);
    expect(record.narrativeQuarantinedOnWeb).toBe(true);
  });
});

describe("summarizeHistoricalInventory", () => {
  it("counts exposure per organisation without listing identifiers of other customers", () => {
    const summary = summarizeHistoricalInventory([
      classifyHistoricalReport(baseRow),
      classifyHistoricalReport({ ...baseRow, id: "r-2", pdfUrl: null }),
      classifyHistoricalReport({
        ...baseRow,
        id: "r-3",
        organizationId: "org-2",
        accessToken: null,
        viewCount: 0,
        lastViewedAt: null,
      }),
    ]);
    expect(summary).toEqual({
      reports: 3,
      organizations: 2,
      webLinkActive: 2,
      storedPdf: 2,
      directPdfUrlNeedsDecision: 2,
      viewedAtLeastOnce: 2,
      unparseable: 0,
      missingSnapshot: 0,
      undecided: 3,
    });
  });
});

const tempDir = mkdtempSync("/tmp/findable-report-inventory-");
const dbDir = join(tempDir, "db");
const socketDir = join(tempDir, "socket");
const port = 16_232 + Math.floor(Math.random() * 100);
const role = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
const connectionString = `postgresql://${role}@127.0.0.1:${port}/postgres`;
let serverStarted = false;
// initdb/postmaster abort on macOS without a valid locale
// ("postmaster became multithreaded during startup"), so pin C locale here.
const pgEnv = { ...process.env, LC_ALL: "C", LANG: "C" };

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
      { stdio: "ignore", env: pgEnv }
    );
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("readHistoricalReportInventory against a disposable PostgreSQL", () => {
  it("reads Report, ReportView and free-audit PDFs in a read-only transaction", async () => {
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
    const admin = new PrismaClient({
      adapter: new PrismaPg({ connectionString, max: 1 }),
    });
    try {
      await admin.$executeRawUnsafe(`CREATE TABLE "Report" (
        id text PRIMARY KEY, "brandId" text, "organizationId" text,
        type text NOT NULL, "pdfUrl" text, data jsonb,
        "generatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "accessToken" text UNIQUE)`);
      await admin.$executeRawUnsafe(`CREATE TABLE "ReportView" (
        id text PRIMARY KEY, "reportId" text NOT NULL, "viewedAt" timestamp(3) NOT NULL, "uaHash" text)`);
      await admin.$executeRawUnsafe(`CREATE TABLE "AuditJob" (
        id text PRIMARY KEY, email text NOT NULL, "pdfUrl" text,
        "organizationId" text, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
      await admin.$executeRawUnsafe(
        `INSERT INTO "Report" (id, "organizationId", "brandId", type, "pdfUrl", data, "generatedAt", "accessToken")
         VALUES ('r-1', 'org-1', 'brand-1', 'custom', $1, $2::jsonb, '2026-09-28 15:00:00', $3),
                ('r-2', 'org-2', NULL, 'free_audit', NULL, NULL, '2026-09-20 00:00:00', NULL)`,
        blobUrl,
        JSON.stringify(snapshot),
        token
      );
      await admin.$executeRawUnsafe(
        `INSERT INTO "ReportView" (id, "reportId", "viewedAt") VALUES
         ('v1', 'r-1', '2026-09-29 00:00:00'), ('v2', 'r-1', '2026-10-01 09:00:00')`
      );
      await admin.$executeRawUnsafe(
        `INSERT INTO "AuditJob" (id, email, "pdfUrl", "createdAt") VALUES
         ('a1', 'one@example.com', $1, '2026-09-10 00:00:00'),
         ('a2', 'one@example.com', $1, '2026-09-11 00:00:00'),
         ('a3', 'two@example.com', NULL, '2026-09-12 00:00:00')`,
        blobUrl
      );

      const inventory = await readHistoricalReportInventory(admin);
      // Prisma DateTime columns are timestamp(3) without time zone holding UTC.
      expect(inventory.reports.map((r) => r.reportId)).toEqual(["r-1", "r-2"]);
      expect(inventory.reports[0]?.generatedAt).toBe(
        "2026-09-28T15:00:00.000Z"
      );
      expect(inventory.reports[0]?.viewed).toEqual({
        count: 2,
        lastViewedAt: "2026-10-01T09:00:00.000Z",
      });
      expect(inventory.freeAuditPdfs).toEqual({
        jobsWithStoredPdf: 2,
        distinctRecipients: 1,
        byMonth: { "2026-09": 2 },
        hosts: { "vercel-blob": 2 },
      });
      const serialized = JSON.stringify(inventory);
      for (const secret of [token, blobUrl, "one@example.com"]) {
        expect(serialized).not.toContain(secret);
      }

      const rows = await admin.$queryRawUnsafe<{ n: number }[]>(
        `SELECT (SELECT count(*) FROM "Report") + (SELECT count(*) FROM "ReportView") + (SELECT count(*) FROM "AuditJob") AS n`
      );
      expect(Number(rows[0]?.n)).toBe(7);
    } finally {
      await admin.$disconnect();
    }
  }, 30_000);
});
