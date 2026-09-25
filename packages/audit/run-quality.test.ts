import { describe, expect, it } from "vitest";
import { isUsableRun, scoreOf } from "./run-quality";

const metrics = {
  averageMentionPosition: null,
  enginesCovered: ["perplexity", "gemini"],
  enginesWithMention: ["gemini"],
  sov: 50,
};

describe("run quality", () => {
  it("does not publish a score when entity verification is incomplete", () => {
    const result = { metrics: { ...metrics, unverifiedCount: 1 } };
    expect(isUsableRun(result)).toBe(false);
    expect(scoreOf(result)).toBeNull();
  });

  it("keeps fully verified measurements usable", () => {
    const result = { metrics: { ...metrics, unverifiedCount: 0 } };
    expect(isUsableRun(result)).toBe(true);
    expect(scoreOf(result)).toBeTypeOf("number");
  });

  it("does not use partially attributed citations for score comparisons or alerts", () => {
    const result = {
      metrics: {
        ...metrics,
        unverifiedCount: 0,
        citationAttribution: "partial",
        unattributedCitationCount: 1,
      },
    };
    expect(isUsableRun(result)).toBe(false);
    expect(scoreOf(result)).toBeNull();
  });

  it("recomputes legacy raw citations before using a stored run in trends", () => {
    const result = {
      domain: "indigochild.kr",
      metrics: { ...metrics, unverifiedCount: 0 },
      engineResponses: [
        {
          engineId: "gemini",
          brandMentioned: true,
          citedSources: [
            {
              domain: "indigochild.studio",
              url: "https://indigochild.studio/",
            },
          ],
        },
      ],
    };
    expect(isUsableRun(result)).toBe(false);
    expect(scoreOf(result)).toBeNull();
  });
});
