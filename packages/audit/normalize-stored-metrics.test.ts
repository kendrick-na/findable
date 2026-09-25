import { describe, expect, it } from "vitest";
import { countMeasurementCoverage } from "./measurement-coverage";
import {
  hasStaleAuditPdf,
  withRecomputedAuditMetrics,
} from "./normalize-stored-metrics";

describe("saved audit metric normalization", () => {
  it("recovers old skipped-verdict rows as unverified rather than confirmed absences", () => {
    const normalized = withRecomputedAuditMetrics({
      metrics: { sov: 0 },
      engineResponses: [
        {
          engineId: "perplexity",
          brandMentioned: false,
          mentionQuality: "unknown_brand",
          verdictVia: "skipped",
          errorMessage: null,
          isStub: false,
        },
        { engineId: "gemini", brandMentioned: false },
      ],
    });
    expect(normalized).toMatchObject({
      metrics: { sov: 0, verifiedCount: 1, unverifiedCount: 1 },
    });
    expect(hasStaleAuditPdf({ metrics: { sov: 0 } }, normalized)).toBe(true);
  });

  it("keeps Naver Briefing separate and repairs legacy sentiment", () => {
    const result = {
      metrics: {
        sov: 50,
        sentimentDistribution: { positive: 0, neutral: 3, negative: 0 },
      },
      regions: [{ region: "korea", score: 99 }],
      engineResponses: [
        {
          engineId: "chatgpt",
          brandMentioned: true,
          sentiment: "positive",
          mentionPosition: 2,
          mentionListSize: 5,
          citedSources: [
            { domain: "official.example", url: "https://official.example" },
          ],
        },
        {
          engineId: "gemini",
          brandMentioned: false,
          sentiment: "negative",
          mentionPosition: 1,
          mentionListSize: 2,
          citedSources: [
            { domain: "unrelated.example", url: "https://unrelated.example" },
          ],
        },
        {
          engineId: "naver-briefing",
          brandMentioned: false,
          sentiment: "neutral",
        },
      ],
    };
    const normalized = withRecomputedAuditMetrics(result);

    expect(normalized.metrics.sov).toBe(50);
    expect(normalized.metrics).toMatchObject({
      averageMentionPosition: 2,
      sentimentDistribution: { positive: 1, neutral: 0, negative: 0 },
      topCitedDomains: [
        { domain: "official.example", count: 1 },
      ],
      enginesCovered: ["chatgpt", "gemini"],
    });
    expect(normalized).toMatchObject({ regionScoresOutdated: true });
    expect(normalized.regions).toBeUndefined();
    expect(hasStaleAuditPdf(result, normalized)).toBe(true);
  });

  it("matches a 22-response core run even when a separate briefing is saved", () => {
    const core = Array.from({ length: 22 }, (_, index) => ({
      engineId: [
        "chatgpt",
        "claude",
        "gemini",
        "perplexity",
        "hyperclova",
        "naver",
        "daum",
      ][index % 7],
      brandMentioned: index < 18,
      sentiment: index < 17 ? "neutral" : null,
      mentionPosition: index < 5 ? 2 : null,
      mentionListSize: index < 5 ? 4 : null,
      citedSources: [],
    }));
    const result = withRecomputedAuditMetrics({
      metrics: {
        sov: 78,
        sentimentDistribution: { positive: 0, neutral: 21, negative: 0 },
      },
      engineResponses: [
        ...core,
        { engineId: "naver-briefing", brandMentioned: false, sentiment: null },
      ],
    });
    expect(result.metrics.sov).toBe(82);
    expect(result.metrics.sentimentDistribution).toEqual({
      positive: 0,
      neutral: 17,
      negative: 0,
    });
    expect(
      countMeasurementCoverage(
        result.engineResponses.filter((r) => r.engineId !== "naver-briefing")
      )
    ).toEqual({ attempted: 7, measured: 7 });
    expect(hasStaleAuditPdf({ metrics: result.metrics }, result)).toBe(false);
  });

  it("does not mark a fresh PDF or market score stale because JSON keys were reordered", () => {
    const original = {
      metrics: {
        sov: 0,
        enginesCovered: ["chatgpt"],
        enginesWithMention: [],
        sentimentDistribution: { neutral: 0, negative: 0, positive: 0 },
        topCitedDomains: [],
        stubCount: 0,
        averageMentionPosition: null,
      },
      regions: [{ region: "korea", score: 0 }],
      engineResponses: [{ engineId: "chatgpt", brandMentioned: false }],
    };
    const corrected = withRecomputedAuditMetrics(original);
    expect(hasStaleAuditPdf(original, corrected)).toBe(false);
    expect(corrected.regions).toEqual(original.regions);
    expect(corrected).not.toHaveProperty("regionScoresOutdated");
  });
});
