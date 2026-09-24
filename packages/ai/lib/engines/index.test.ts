import { describe, expect, it } from "vitest";
import { aggregateAudit } from "./index";
import type { EngineResponse } from "./types";

const response = (
  brandMentioned: boolean,
  domain: string
): EngineResponse => ({
  brandMentioned,
  citedSources: [{ domain, url: `https://${domain}` }],
  durationMs: 1,
  engineId: "chatgpt",
  errorMessage: null,
  isStub: false,
  mentionListSize: null,
  mentionPosition: null,
  rawResponse: "",
  sentiment: null,
  shareOfVoice: null,
});

describe("aggregateAudit citation metrics", () => {
  it("does not present search links from a non-mention response as brand citations", () => {
    const metrics = aggregateAudit([
      response(true, "official.example"),
      response(false, "same-name-company.example"),
    ]);

    expect(metrics.topCitedDomains).toEqual([
      { domain: "official.example", count: 1 },
    ]);
  });

  it("excludes unverified brand matches from rank and sentiment", () => {
    const verified = {
      ...response(true, "official.example"),
      mentionPosition: 2,
      mentionListSize: 5,
      sentiment: "positive" as const,
    };
    const unrelated = {
      ...response(false, "same-name-company.example"),
      mentionPosition: 1,
      mentionListSize: 2,
      sentiment: "negative" as const,
    };

    const metrics = aggregateAudit([verified, unrelated]);

    expect(metrics.enginesWithMention).toEqual(["chatgpt"]);
    expect(metrics.averageMentionPosition).toBe(2);
    expect(metrics.averageMentionListSize).toBe(5);
    expect(metrics.averageRelativePosition).toBe(0.25);
    expect(metrics.sentimentDistribution).toEqual({
      positive: 1,
      neutral: 0,
      negative: 0,
    });
  });

  it("counts an errored stub only once in the appearance denominator", () => {
    const metrics = aggregateAudit([
      response(true, "official.example"),
      {
        ...response(false, "error.example"),
        isStub: true,
        errorMessage: "unavailable",
      },
    ]);

    expect(metrics.sov).toBe(100);
  });
});
