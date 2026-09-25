/**
 * 자동 재측정은 고객 데이터의 신선도를 지키는 운영 기능이다.
 *
 * 코드가 다른 앱(`apps/web`)에만 존재하면 app.findable.co.kr에서는 조용히 404가 난다.
 * 실제 배포 루트의 라우트·스케줄을 함께 검사해 그 배포 경계 누락을 막는다.
 *
 * @vitest-environment node
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const APP_ROUTE = join(
  process.cwd(),
  "app/api/cron/auto-refresh-tracking/route.ts"
);
const DEPLOY_CONFIG = join(process.cwd(), "vercel.json");
const PUBLIC_WEB_DEPLOY_CONFIG = join(process.cwd(), "../web/vercel.json");

describe("자동 재측정 cron은 운영 앱에 배포된다", () => {
  test("🔴 app.findable.co.kr 배포본에 인증된 자동 재측정 route가 있다", () => {
    expect(existsSync(APP_ROUTE)).toBe(true);
    const route = readFileSync(APP_ROUTE, "utf8");
    expect(route).toContain("denyIfNotCron");
    expect(route).toContain("MAX_TRIGGERS_PER_RUN");
  });

  test("🔴 유료 운영의 자동 재측정은 30분마다 한 브랜드만 실행한다", () => {
    const config = JSON.parse(readFileSync(DEPLOY_CONFIG, "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
      functions?: Record<string, { maxDuration?: number }>;
    };
    const cron = config.crons?.find(
      (item) => item.path === "/api/cron/auto-refresh-tracking"
    );
    expect(cron?.schedule).toBe("*/30 * * * *");
    const route = readFileSync(APP_ROUTE, "utf8");
    expect(route).toMatch(/MAX_TRIGGERS_PER_RUN\s*=\s*1\b/);
    expect(
      config.functions?.["app/api/cron/auto-refresh-tracking/route.ts"]
        ?.maxDuration
    ).toBe(300);
  });

  test("자동 재측정은 공개 랜딩 프로젝트에서 중복 예약하지 않는다", () => {
    const publicWebConfig = JSON.parse(
      readFileSync(PUBLIC_WEB_DEPLOY_CONFIG, "utf8")
    ) as { crons?: Array<{ path: string }> };

    expect(
      publicWebConfig.crons?.some(
        (item) => item.path === "/api/cron/auto-refresh-tracking"
      )
    ).toBe(false);
    expect(
      publicWebConfig.crons?.find(
        (item) => item.path === "/api/cron/sweep-stuck-jobs"
      )
    ).toMatchObject({ schedule: "*/15 * * * *" });
  });

  test("실패한 브랜드도 재시도 간격을 적용해 다른 브랜드를 굶기지 않는다", () => {
    const route = readFileSync(APP_ROUTE, "utf8");
    const collector = route.split("async function collectDueBrands")[1]?.split("type DigestByOrg")[0];
    expect(collector).toBeDefined();
    expect(collector).not.toContain('status: "completed"');
    expect(collector).toContain('orderBy: { createdAt: "desc" }');
  });

});
