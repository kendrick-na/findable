import { describe, expect, it } from "vitest";
import {
  buildCompetitorAnalysis,
  type AnalysisRowInput,
} from "../app/(authenticated)/lib/analysis-data";

const baseRow: AnalysisRowInput = {
  brand: {
    name: "Findable OAuth Verification",
    domain: "findable.co.kr",
    entityVariants: [],
  },
  brandId: "brand-id",
  brandMentioned: false,
  citedSources: [],
  engineId: "chatgpt",
  rawResponse: "1. Findable OAuth Verification\n2. Another brand",
  trackedAt: new Date("2026-09-25T00:00:00.000Z"),
};

describe("competitor analysis entity verification", () => {
  it("does not mistake a prompted name in a list for a verified brand mention", () => {
    expect(buildCompetitorAnalysis([baseRow])).toBeNull();
  });

  it("does not use Naver briefing to validate the core comparison", () => {
    expect(
      buildCompetitorAnalysis([
        baseRow,
        { ...baseRow, engineId: "naver-briefing", brandMentioned: true },
      ])
    ).toBeNull();
  });
});
