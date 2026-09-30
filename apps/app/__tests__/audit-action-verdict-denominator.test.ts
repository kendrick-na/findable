import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("builds action-guide verdict evidence from AI answers, not discovery or search rows", () => {
  const runner = readFileSync(
    join(process.cwd(), "../../packages/audit/runner.ts"),
    "utf8"
  );

  // Discovery prompts deliberately do not affect GEO score or appearance rate.
  // Naver/Daum are search-visibility rows, not AI answers. Neither may leak into
  // an action card that says “AI answered N times”.
  expect(runner).toMatch(/const aiBrandFlat = brandFlat\.filter/);
  expect(runner).toMatch(/verdicts:\s*summarizeVerdicts\(aiBrandFlat,/);
});
