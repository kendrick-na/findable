import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("builds action-guide verdict evidence from scored brand answers, not discovery answers", () => {
  const runner = readFileSync(
    join(process.cwd(), "../../packages/audit/runner.ts"),
    "utf8"
  );

  // Discovery prompts deliberately do not affect GEO score or appearance rate.
  // Their responses must not leak into action evidence that says “AI answered N times”.
  expect(runner).toMatch(/verdicts:\s*summarizeVerdicts\(brandFlat,/);
});
