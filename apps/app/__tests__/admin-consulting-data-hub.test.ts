import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ACTION = readFileSync(
  join(process.cwd(), "app/actions/admin/consulting.ts"),
  "utf8"
);
const PAGE = readFileSync(
  join(process.cwd(), "app/(authenticated)/admin/orgs/[orgId]/page.tsx"),
  "utf8"
);
const PANEL = readFileSync(
  join(
    process.cwd(),
    "app/(authenticated)/admin/orgs/[orgId]/customer-data-panel.tsx"
  ),
  "utf8"
);
const ORG_TABLE = readFileSync(
  join(process.cwd(), "app/(authenticated)/admin/orgs/org-table.tsx"),
  "utf8"
);

describe("고객사 데이터 허브", () => {
  it("운영자 전용 조회에서 측정·준비도·검색 연동 데이터를 함께 가져온다", () => {
    expect(ACTION).toContain("requireAdmin()");
    expect(ACTION).toContain("auditJobs:");
    expect(ACTION).toContain("siteReadinessRuns:");
    expect(ACTION).toContain("searchPerformanceConnections:");
    expect(ACTION).toContain("engineResponses");
    expect(ACTION).toContain("failedEngineIds");
  });

  it("고객사 상세가 공개 리포트 링크만이 아니라 내부 데이터 패널을 렌더한다", () => {
    expect(PAGE).toContain("CustomerDataPanel");
    expect(ORG_TABLE).toContain("실측 데이터");
    expect(ORG_TABLE).toContain("/admin/orgs/${o.id}");
  });

  it("부분 성공 측정을 정상 완료처럼 숨기지 않는다", () => {
    expect(PANEL).toContain("부분 측정입니다.");
    expect(PANEL).toContain("audit.failedEngineIds");
  });
});
