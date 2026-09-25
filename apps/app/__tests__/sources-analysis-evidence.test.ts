import { describe, expect, it } from "vitest";
import {
  type AnalysisRowInput,
  buildSourcesAnalysis,
} from "../app/(authenticated)/lib/analysis-data";

const brand = {
  name: "인디고차일드",
  domain: "indigochild.kr",
  entityVariants: [],
};

function row(overrides: Partial<AnalysisRowInput> = {}): AnalysisRowInput {
  return {
    brand,
    brandId: "brand-1",
    brandMentioned: false,
    citedSources: [],
    engineId: "gemini",
    rawResponse: "다른 회사를 설명합니다.",
    trackedAt: new Date("2026-09-26T00:00:00Z"),
    ...overrides,
  };
}

describe("출처 분석의 브랜드 증거 경계", () => {
  it("브랜드 미언급 답변에 붙은 동명 검색 링크를 브랜드 인용으로 세지 않는다", () => {
    const analysis = buildSourcesAnalysis([
      row({
        citedSources: [
          {
            domain: "indigochild.studio",
            title: "Indigochild Studio",
            url: "https://indigochild.studio/",
          },
        ],
      }),
    ]);
    expect(analysis?.ownedCitations).toEqual({ owned: 0, total: 0 });
    expect(analysis?.domains).toEqual([]);
    expect(analysis?.engines[0]?.citations).toBe(0);
  });

  it("엔진 실패는 언급률 분모와 인용 집계에서 제외한다", () => {
    const analysis = buildSourcesAnalysis([
      row({ errorMessage: "quota exceeded", rawResponse: "" }),
      row({
        brandMentioned: true,
        rawResponse: "인디고차일드는 마케팅 회사입니다.",
        citedSources: [
          {
            domain: "indigochild.kr",
            title: "공식 사이트",
            url: "https://indigochild.kr/",
          },
        ],
      }),
    ]);
    expect(analysis?.mentionRate).toEqual({ mentioned: 1, total: 1 });
    expect(analysis?.ownedCitations).toEqual({ owned: 1, total: 1 });
    expect(analysis?.engines[0]?.total).toBe(1);
  });
});
