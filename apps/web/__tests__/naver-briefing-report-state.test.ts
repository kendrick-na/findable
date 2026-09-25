import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const report = readFileSync(
  join(
    process.cwd(),
    "app/[locale]/audit/[jobId]/components/audit-result.tsx"
  ),
  "utf8"
);

describe("Naver AI Briefing report", () => {
  it("shows the stored state instead of promising automatic measurement", () => {
    expect(report).toContain("briefingStateMessage(briefingStatus, isKo)");
    expect(report).toContain("이번 회차에서는 네이버 AI 브리핑을 측정하지 않았습니다.");
    expect(report).toContain("이번 회차의 네이버 AI 브리핑 측정은 실패했습니다.");
    expect(report).not.toContain("로그인 후 브랜드 측정에서는 자동으로 확인하고");
  });

  it("labels the market mention percentage as response-based", () => {
    expect(report).toContain("응답 기준 등장률 ${r.mentionRate}%");
    expect(report).not.toContain("AI ${r.enginesMeasured}개 중 언급");
  });
});
