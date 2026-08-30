import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const runner = readFileSync(join(root, "../../packages/audit/runner.ts"), "utf8");
const crewRunner = readFileSync(
  join(root, "../../packages/audit/crew-runner.ts"),
  "utf8"
);
const briefingRunner = readFileSync(
  join(root, "../../packages/audit/briefing-runner.ts"),
  "utf8"
);

describe("무료 리포트 심층 분석의 인용 근거", () => {
  it("빠른 측정 결과가 인용 출처 원본을 보존한다", () => {
    expect(runner).toContain("citedSources: r.citedSources");
  });

  it("심층 분석이 보존된 출처를 복원하고, 구 리포트만 빈 배열로 폴백한다", () => {
    expect(crewRunner).toContain("citedSources: r.citedSources ?? []");
    expect(crewRunner).not.toContain("citedSources: [], // 빠른 모드");
  });

  it("네이버 브리핑을 추가해도 기존 출처 원본을 버리지 않는다", () => {
    expect(briefingRunner).toContain("citedSources: r.citedSources");
  });
});
