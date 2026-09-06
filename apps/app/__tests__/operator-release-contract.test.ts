// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

const SIDEBAR = source("app/(authenticated)/components/sidebar.tsx");
const LAYOUT = source("app/(authenticated)/layout.tsx");
const ORG_ACTION = source("app/actions/admin/orgs.ts");
const ORG_TABLE = source("app/(authenticated)/admin/orgs/org-table.tsx");
const SITE_AUDIT_PAGE = source("app/(authenticated)/site-audit/page.tsx");
const APP_PACKAGE = source("package.json");
const APP_RELEASE_GUARD = source("scripts/verify-production-source.js");
const WEB_PACKAGE = source("../web/package.json");
const WEB_RELEASE_GUARD = source("../web/scripts/verify-production-source.js");

describe("운영 릴리스 계약", () => {
  it("사이트 준비도 진입점을 사이드바와 레이아웃에 유지한다", () => {
    expect(SIDEBAR).toContain('url: "/site-audit"');
    expect(SIDEBAR).toContain("title: t.siteAudit");
    expect(LAYOUT).toContain("siteAudit: t.sidebar.siteAudit");
  });

  it("조직 목록에서 누적 응답과 실제 최신 GEO 점수를 구분한다", () => {
    expect(ORG_TABLE).toContain("누적 응답");
    expect(ORG_TABLE).toContain("최신 GEO");
    expect(ORG_TABLE).toContain("latestGeoScore");
    expect(ORG_ACTION).toContain("scoreOf");
  });

  it("선택 브랜드 도메인과 다른 준비도 결과를 렌더하지 않는다", () => {
    expect(SITE_AUDIT_PAGE).toContain("readinessUrlMatchesBrand");
    expect(SITE_AUDIT_PAGE).toContain("matchingCompletedRuns[0]");
  });

  it("두 프로덕션 앱을 GitHub main 커밋에서만 빌드한다", () => {
    for (const guard of [APP_RELEASE_GUARD, WEB_RELEASE_GUARD]) {
      expect(guard).toContain('VERCEL_GIT_PROVIDER !== "github"');
      expect(guard).toContain('VERCEL_GIT_COMMIT_REF !== "main"');
      expect(guard).toContain("VERCEL_GIT_COMMIT_SHA");
    }
    expect(APP_PACKAGE).toContain("verify-production-source.js");
    expect(WEB_PACKAGE).toContain("verify-production-source.js");
  });
});
