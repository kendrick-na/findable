import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("실측 유입이 없는 자동 손실 추정", () => {
  it("로그인 대시보드는 임의 검색량 프리셋으로 월 세션 손실을 자동 표시하지 않는다", () => {
    const page = readFileSync(
      join(process.cwd(), "app/(authenticated)/page.tsx"),
      "utf8"
    );
    expect(page).not.toContain("DashboardImpactEstimate");
  });
});
