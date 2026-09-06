import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const START_TRACKING = readFileSync(
  join(process.cwd(), "app/actions/brand/start-tracking.ts"),
  "utf8"
);
const AUTO_REFRESH = readFileSync(
  join(process.cwd(), "app/api/cron/auto-refresh-tracking/route.ts"),
  "utf8"
);
const WEB_AUTO_REFRESH = readFileSync(
  join(process.cwd(), "../web/app/api/cron/auto-refresh-tracking/route.ts"),
  "utf8"
);
const RUNNER = readFileSync(
  join(process.cwd(), "../../packages/audit/runner.ts"),
  "utf8"
);
const DATA_PANEL = readFileSync(
  join(
    process.cwd(),
    "app/(authenticated)/admin/orgs/[orgId]/customer-data-panel.tsx"
  ),
  "utf8"
);

describe("브랜드 별칭과 운영자 리포트 경로", () => {
  it("수동 재측정이 저장된 브랜드 별칭을 러너에 전달한다", () => {
    expect(START_TRACKING).toContain("entityVariants: true");
    expect(START_TRACKING).toContain("brandVariants:");
  });

  it("앱 자동 재측정도 저장된 브랜드 별칭을 러너에 전달한다", () => {
    expect(AUTO_REFRESH).toContain("entityVariants: true");
    expect(AUTO_REFRESH).toContain("brandVariants:");
  });

  it("웹 자동 재측정도 저장된 브랜드 별칭을 러너에 전달한다", () => {
    expect(WEB_AUTO_REFRESH).toContain("entityVariants: true");
    expect(WEB_AUTO_REFRESH).toContain("brandVariants:");
  });

  it("저장 별칭과 도메인 기반 추론 별칭을 함께 사용한다", () => {
    expect(RUNNER).toContain("...identity.brandVariants");
    expect(RUNNER).toContain("...(input.brandVariants ?? [])");
  });

  it("운영자 데이터룸에서 공개 리포트를 다시 열 수 있다", () => {
    expect(DATA_PANEL).toContain("공개 리포트 열기");
    expect(DATA_PANEL).toContain("/ko/audit/");
  });
});
