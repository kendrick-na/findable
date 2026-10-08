/**
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  denyIfNotCron: vi.fn(),
}));

vi.mock("@repo/security/cron", () => ({
  denyIfNotCron: mocks.denyIfNotCron,
}));

import { GET } from "../app/api/cron/auto-refresh-tracking/route";

const ROUTE_SOURCE = readFileSync(
  join(import.meta.dirname, "../app/api/cron/auto-refresh-tracking/route.ts"),
  "utf8"
);

const request = () =>
  new Request(
    "https://findable.example/api/cron/auto-refresh-tracking"
  ) as never;

describe("web auto-refresh-tracking is retired", () => {
  beforeEach(() => {
    mocks.denyIfNotCron.mockReset();
  });

  it("keeps the cron auth check first", async () => {
    mocks.denyIfNotCron.mockReturnValue(
      new Response("Unauthorized", { status: 401 })
    );
    const response = await GET(request());
    expect(response.status).toBe(401);
  });

  it("answers 410 to an authenticated call instead of running stale logic", async () => {
    mocks.denyIfNotCron.mockReturnValue(null);
    const response = await GET(request());
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: "moved" });
  });

  it("no longer touches the database, plan expiry, or the runner", () => {
    expect(ROUTE_SOURCE).not.toContain("@repo/database");
    expect(ROUTE_SOURCE).not.toContain("runAuditJob");
    expect(ROUTE_SOURCE).not.toMatch(/planExpiresAt\s*:\s*null/);
  });
});
