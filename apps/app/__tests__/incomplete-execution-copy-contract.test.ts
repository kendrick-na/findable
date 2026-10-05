import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static guard only: a later implementation also needs rendered-page tests.
// Today these pages have a two-way insufficient-sample/verification message.
// If a new incomplete-execution issue is added, falling through to the latter
// would tell customers a false reason for a stopped measurement.
const pages = [
  ["actions", "../app/(authenticated)/actions/page.tsx"],
  ["history detail", "../app/(authenticated)/history/[jobId]/page.tsx"],
] as const;

/**
 * 🔴 2026-10-06 — 대시보드는 문구를 사전(`app.dashboard.issue*`)으로 옮겼다.
 *   같은 계약을 「분기 → 사전 키」 + 「사전 값(ko·en)이 이유를 정확히 말하는가」 두 단계로 잠근다.
 */
const DASHBOARD = readFileSync(
  join(import.meta.dirname, "../app/(authenticated)/page.tsx"),
  "utf8"
);
const dashboardDict = (lang: "ko" | "en") =>
  JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        `../../../packages/internationalization/dictionaries/${lang}.json`
      ),
      "utf8"
    )
  ).app.dashboard as Record<string, string>;

describe("W0-3 dashboard incomplete-execution copy (dictionary)", () => {
  it("RED: dashboard maps incomplete execution to the interruption message", () => {
    expect(
      /=== "incomplete_execution"[\s\S]{0,120}dict\.dashboard\.issueIncomplete/.test(
        DASHBOARD
      )
    ).toBe(true);
    expect(dashboardDict("ko").issueIncomplete).toMatch(
      /(?:질문|측정)[\s\S]{0,100}(?:중단|미완료)/
    );
    expect(dashboardDict("en").issueIncomplete).toMatch(
      /stopped|did not (?:fully )?complete/
    );
  });
  it("dashboard explains an unverified historical question plan without claiming a failed brand verdict", () => {
    expect(
      /=== "question_plan_unverified"[\s\S]{0,120}dict\.dashboard\.issuePlanUnverified/.test(
        DASHBOARD
      )
    ).toBe(true);
    expect(dashboardDict("ko").issuePlanUnverified).toContain("질문 계획");
    expect(dashboardDict("en").issuePlanUnverified).toContain("question plan");
  });
});

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
