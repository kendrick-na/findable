import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RevenueImpactOptIn } from "../app/[locale]/audit/[jobId]/components/answer-buckets";
import {
  initialRevenueAssumptions,
  RevenueImpactCard,
  revenueImpactCopy,
} from "../app/[locale]/audit/[jobId]/components/revenue-impact-card";

describe("고객 입력 기반 유입 시나리오", () => {
  it("기본값 복원에도 고객이 입력한 월 노출 수와 객단가를 보존한다", () => {
    const assumptions = initialRevenueAssumptions("small", {
      monthlyAiQueries: 1234,
      revenuePerConversion: 91_000,
    });

    expect(assumptions.monthlyAiQueries).toBe(1234);
    expect(assumptions.revenuePerConversion).toBe(91_000);
    const source = readFileSync(
      join(
        process.cwd(),
        "app/[locale]/audit/[jobId]/components/revenue-impact-card.tsx"
      ),
      "utf8"
    );
    expect(source).toContain(
      "setAssumptions(initialRevenueAssumptions(defaultSizeKey, customerInput))"
    );
  });

  it.each([
    true,
    false,
  ])("접힌 패널의 문구도 손실 실측·회복 약속을 하지 않는다 (한국어: %s)", (isKo) => {
    const copy = Object.values(revenueImpactCopy(isKo)).join(" ");

    expect(copy).not.toContain("Pew Research 실측 8%");
    expect(copy).not.toContain("8% answer CTR (Pew)");
    expect(copy).not.toContain("회복 가능 매출");
    expect(copy).not.toContain("Recoverable revenue");
    expect(copy).not.toContain("/ 월 (추정)");
    expect(copy).not.toContain("/ mo (est.)");
    expect(copy).toContain(isKo ? "임의 시작값" : "arbitrary starting value");
  });

  it.each([
    true,
    false,
  ])("입력 전 안내는 가정이며 계산 카드는 숨긴다 (한국어: %s)", (isKo) => {
    const html = renderToStaticMarkup(
      <RevenueImpactOptIn
        attemptedEngines={3}
        isKo={isKo}
        measuredEngines={3}
        sov={20}
      />
    );

    expect(html).toContain(
      isKo
        ? "클릭률·전환율 등은 기본 가정이 남으며"
        : "Click and conversion rates still use editable defaults"
    );
    expect(html).toContain(
      isKo ? "실제 손실 측정값은 아닙니다" : "This is not measured loss"
    );
    expect(html).not.toContain("놓치는 유입이 궁금하다면");
    expect(html).not.toContain("가정 기반 시나리오");
    expect(html).not.toContain("Assumption-based scenario");
  });

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
