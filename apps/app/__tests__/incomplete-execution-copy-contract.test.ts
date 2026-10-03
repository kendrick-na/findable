import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static guard only: a later implementation also needs rendered-page tests.
// Today these pages have a two-way insufficient-sample/verification message.
// If a new incomplete-execution issue is added, falling through to the latter
// would tell customers a false reason for a stopped measurement.
const pages = [
  ["dashboard", "../app/(authenticated)/page.tsx"],
  ["actions", "../app/(authenticated)/actions/page.tsx"],
  ["history detail", "../app/(authenticated)/history/[jobId]/page.tsx"],
] as const;

describe("W0-3 proposed incomplete-execution issue copy", () => {
  for (const [label, path] of pages) {
    it(`RED: ${label} explicitly maps incomplete execution to measurement interruption`, () => {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(/=== "incomplete_execution"/.test(source)).toBe(true);
      expect(
        /incomplete_execution[\s\S]{0,450}(?:질문|측정)[\s\S]{0,100}(?:중단|미완료)/.test(
          source
        )
      ).toBe(true);
    });
    it(`${label} explains an unverified historical question plan without claiming a failed brand verdict`, () => {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(
        /=== "question_plan_unverified"[\s\S]{0,250}질문 계획/.test(source)
      ).toBe(true);
    });
  }
});
