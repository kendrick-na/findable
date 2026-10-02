import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RevenueImpactCard } from "../app/[locale]/audit/[jobId]/components/revenue-impact-card";

describe("고객 입력 기반 유입 시나리오", () => {
  it.each([
    true,
    false,
  ])("실측 손실이나 Pew의 AI 답변 클릭률로 표시하지 않는다 (한국어: %s)", (isKo) => {
    const html = renderToStaticMarkup(
      <RevenueImpactCard
        customerInput={{ monthlyAiQueries: 1000, revenuePerConversion: 50_000 }}
        isKo={isKo}
        sov={20}
      />
    );

    expect(html).toContain(
      isKo ? "가정 기반 시나리오" : "Assumption-based scenario"
    );
    expect(html).not.toContain("Pew Research 실측 8%");
    expect(html).not.toContain("8% answer CTR (Pew)");
    expect(html).not.toContain("회복 가능 매출");
    expect(html).not.toContain("Recoverable revenue");
  });
});
