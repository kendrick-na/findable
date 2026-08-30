import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const orchestrator = readFileSync(
  join(process.cwd(), "../../packages/ai/lib/crew/orchestrator.ts"),
  "utf8"
);
const resultView = readFileSync(
  join(
    process.cwd(),
    "../web/app/[locale]/audit/[jobId]/components/audit-result.tsx"
  ),
  "utf8"
);

describe("심층 분석 개별 응답 복구", () => {
  it("SDK object가 비어도 JSON 텍스트 응답을 스키마로 복구한다", () => {
    expect(orchestrator).toContain("function parseAnalystOutput");
    expect(orchestrator).toContain("analystOutputSchema.safeParse(JSON.parse(json))");
    expect(orchestrator).toContain("parseAnalystOutput(r.object, r.text)");
  });

  it("개별 분석 결과가 없으면 접힌 카드 안에 숨기지 않는다", () => {
    expect(resultView).toContain(
      "useState(() => !report.output || Boolean(report.errorMessage))"
    );
    expect(resultView).toContain('isKo ? "결과 없음" : "No result"');
  });
});
