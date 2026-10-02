/** @vitest-environment node */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ report: { findUnique: vi.fn() } }));

vi.mock("server-only", () => ({}));
vi.mock("@repo/database", () => ({ database: db }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { loadClientReport } = await import("../lib/client-report/load");
const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("./fixtures/client-report/knowverse-v12.report.json", import.meta.url)
    ),
    "utf8"
  )
) as Record<string, unknown>;
const TOKEN = "A".repeat(43);

beforeEach(() => vi.clearAllMocks());

describe("client report link loader", () => {
  it("rejects an expired v2 report before rendering it", async () => {
    db.report.findUnique.mockResolvedValue({
      id: "report-1",
      pdfUrl: null,
      data: {
        ...fixture,
        release: {
          ...(fixture.release as Record<string, unknown>),
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
      },
    });

    await expect(loadClientReport(TOKEN, undefined)).resolves.toBeNull();
  });

  it("allows a live v2 report with the same valid token", async () => {
    db.report.findUnique.mockResolvedValue({
      id: "report-1",
      pdfUrl: null,
      data: fixture,
    });

    await expect(loadClientReport(TOKEN, undefined)).resolves.toMatchObject({
      reportId: "report-1",
    });
  });
});
