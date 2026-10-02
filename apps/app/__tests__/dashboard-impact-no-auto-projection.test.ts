import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("실측 유입이 없는 자동 손실 추정", () => {
  it("로그인 대시보드는 임의 검색량 프리셋으로 월 세션 손실을 자동 표시하지 않는다", () => {
    const appRoot = join(process.cwd(), "app");
    const sourceFiles = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          return sourceFiles(path);
        }
        return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
      });

    for (const path of sourceFiles(appRoot)) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toContain("DashboardImpactEstimate");
      expect(source, path).not.toContain("dashboard-impact-estimate");
    }
  });
});
