import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  canExposeAuditResult,
  canUseAnonymousAuditCache,
} from "../../web/app/api/audit/_lib/public-access";

const POST_ROUTE = readFileSync(
  join(import.meta.dirname, "../../web/app/api/audit/route.ts"),
  "utf8"
);
const POLL_ROUTE = readFileSync(
  join(import.meta.dirname, "../../web/app/api/audit/[jobId]/route.ts"),
  "utf8"
);
const SSR_PAGE = readFileSync(
  join(import.meta.dirname, "../../web/app/[locale]/audit/[jobId]/page.tsx"),
  "utf8"
);
const OG_ROUTE = readFileSync(
  join(import.meta.dirname, "../../web/app/api/og/audit/[jobId]/route.tsx"),
  "utf8"
);
const PRIVATE_SUBROUTES = [
  "../../web/app/api/audit/[jobId]/crew/route.ts",
  "../../web/app/api/audit/[jobId]/briefing/route.ts",
  "../../web/app/api/audit/[jobId]/chat/route.ts",
  "../../web/app/api/audit/[jobId]/lead/route.ts",
].map((path) => readFileSync(join(import.meta.dirname, path), "utf8"));

describe("audit tenant boundary", () => {
  test("anonymous cache only accepts public free jobs", () => {
    expect(
      canUseAnonymousAuditCache({
        email: "free@example.com",
        organizationId: null,
      })
    ).toBe(true);
    expect(
      canUseAnonymousAuditCache({ email: "org:deleted", organizationId: null })
    ).toBe(false);
    expect(
      canUseAnonymousAuditCache({
        email: "free@example.com",
        organizationId: "org_private",
      })
    ).toBe(false);
  });

  test("organization results require the owning viewer", () => {
    expect(
      canExposeAuditResult(
        { email: "free@example.com", organizationId: null },
        false
      )
    ).toBe(true);
    expect(
      canExposeAuditResult(
        { email: "org:deleted", organizationId: null },
        false
      )
    ).toBe(false);
    expect(
      canExposeAuditResult({ email: "org:deleted", organizationId: null }, true)
    ).toBe(true);
    expect(
      canExposeAuditResult(
        { email: "org:private", organizationId: "org_private" },
        false
      )
    ).toBe(false);
  });

  test("anonymous cache query is tenant-bound", () => {
    expect(POST_ROUTE).toMatch(/organizationId:\s*null/);
    expect(POST_ROUTE).toMatch(
      /NOT:\s*\{\s*email:\s*\{\s*startsWith:\s*"org:"/
    );
  });

  test("public poll route applies the private-result gate", () => {
    const gate = POLL_ROUTE.indexOf("canExposeAuditResult(job, isOwner)");
    const reconcile = POLL_ROUTE.indexOf("await reconcileStaleAuditJob(job)");
    const historyQuery = POLL_ROUTE.indexOf("await loadHistory(job)");
    expect(gate).toBeGreaterThan(-1);
    expect(reconcile).toBeGreaterThan(gate);
    expect(historyQuery).toBeGreaterThan(gate);
    expect(POLL_ROUTE).toMatch(/status:\s*403/);
  });

  test("SSR summary and private subroutes use the same visibility gate", () => {
    expect(SSR_PAGE).toMatch(/canExposeAuditResult/);
    for (const route of PRIVATE_SUBROUTES) {
      expect(route).toMatch(/canExposeAuditResult/);
      expect(route).toMatch(/status:\s*403/);
    }
  });

  test("OG rendering delegates visibility to the gated audit API", () => {
    expect(OG_ROUTE).toMatch(/fetch\(apiUrl,\s*\{\s*cache:\s*"no-store"/);
    expect(OG_ROUTE).not.toMatch(/database\.auditJob\./);
  });
});
