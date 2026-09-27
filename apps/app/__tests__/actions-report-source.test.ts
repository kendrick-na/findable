/**
 * The actions screen must reuse the verified audit payload. Recomputing from
 * Tracking drops fields such as rank, market scope and failed-engine coverage,
 * so it can silently disagree with the report it links from.
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(
  join(process.cwd(), "app/(authenticated)/actions/page.tsx"),
  "utf8"
);

describe("actions uses the verified report as its source of truth", () => {
  it("reuses stored geoActions before the legacy Tracking fallback", () => {
    const auditLookup = PAGE.indexOf("const latestAudit");
    const storedActions = PAGE.indexOf("const storedActions = (latestResult");
    const fallback = PAGE.indexOf(": buildGeoActions");

    expect(auditLookup).toBeGreaterThan(-1);
    expect(storedActions).toBeGreaterThan(auditLookup);
    expect(fallback).toBeGreaterThan(storedActions);
  });
});
