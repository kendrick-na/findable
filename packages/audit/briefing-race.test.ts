import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runnerSource = readFileSync(
  new URL("./briefing-runner.ts", import.meta.url),
  "utf8"
);
const routeSource = readFileSync(
  new URL(
    "../../apps/web/app/api/audit/[jobId]/briefing/route.ts",
    import.meta.url
  ),
  "utf8"
);

describe("briefing result race contract", () => {
  it("uses leaf JSON updates instead of whole-result writes", () => {
    expect(runnerSource).toContain("jsonb_set");
    expect(runnerSource).toContain("jsonb_array_elements");
    expect(runnerSource).toContain("WITH ORDINALITY");
    expect(runnerSource).toContain("ORDER BY ord");
    expect(runnerSource).toContain("IS DISTINCT FROM 'naver-briefing'");
    expect(runnerSource).toContain("jsonb_typeof");
    expect(runnerSource).not.toContain("'{metrics}'");
    expect(runnerSource).not.toMatch(
      /data:\s*\{\s*result:\s*\{\s*\.\.\.latest/
    );
    expect(routeSource).toContain("COALESCE(\"result\", '{}'::jsonb)");
    expect(routeSource).toContain("COALESCE(\"result\"->>'briefingStatus'");
  });

  it("claims only not_requested or failed jobs atomically", () => {
    expect(routeSource).toContain("IN ('not_requested', 'failed')");
    expect(routeSource).toContain("claimed !== 1");
  });
});
