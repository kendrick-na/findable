import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ORGS_ACTION = readFileSync(
  join(process.cwd(), "app/actions/admin/orgs.ts"),
  "utf8"
);
const ORG_TABLE = readFileSync(
  join(process.cwd(), "app/(authenticated)/admin/orgs/org-table.tsx"),
  "utf8"
);

describe("가입 조직 측정 데이터 진입점", () => {
  it("준비도 실행 이력이 전혀 없는 브랜드만 보완 실행한다", () => {
    expect(ORGS_ACTION).toContain("backfillMissingSiteReadiness");
    expect(ORGS_ACTION).toContain("siteReadinessRuns: { none: {} }");
    expect(ORGS_ACTION).toContain("executeSiteReadinessRun(run.id)");
  });

  it("목록에서 준비도 누락과 실측 데이터 진입점을 드러낸다", () => {
    expect(ORG_TABLE).toContain("미측정");
    expect(ORG_TABLE).toContain("실측 데이터");
  });
});
