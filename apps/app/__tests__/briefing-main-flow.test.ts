import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "../..");
const source = (path: string) => readFileSync(join(root, path), "utf8");
const runner = source("packages/audit/runner.ts");
const route = source("apps/web/app/api/audit/[jobId]/briefing/route.ts");

describe("briefing remains an explicit request", () => {
  it("leaves the core result unrequested and its postprocessing not required", () => {
    expect(runner).toMatch(/briefingStatus:\s*"not_requested"/);
    expect(runner).toMatch(/briefing:\s*"not_required"/);
  });

  it("never imports, calls, or enables briefing in the core runner", () => {
    expect(runner).not.toMatch(/import\s*\{\s*runBriefingForAuditJob\s*\}/);
    expect(runner).not.toContain("runBriefingForAuditJob({");
    expect(runner).not.toContain("keys().AUDIT_BRIEFING_IN_MAIN_ENABLED");
  });

  it("starts paid briefing only through the explicit route with a dated claim", () => {
    expect(route).toContain("export async function POST");
    expect(route).toContain("'{briefingStartedAt}'");
    expect(route).toContain("runBriefingForAuditJob({");
    for (const path of [
      "apps/app/app/actions/brand/start-tracking.ts",
      "apps/app/app/actions/admin/measure.ts",
      "apps/web/app/api/admin/measure-one/route.ts",
      "apps/web/app/api/audit/route.ts",
    ]) {
      expect(source(path)).not.toContain("runBriefingForAuditJob({");
    }
  });
});
