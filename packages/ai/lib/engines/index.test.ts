import { describe, expect, it } from "vitest";
import { partitionCitedSources } from "./aggregate";
import { aggregateAudit } from "./index";
import type { EngineResponse } from "./types";

const response = (brandMentioned: boolean, domain: string): EngineResponse => ({
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
  it("does not credit a same-name site from a mixed confirmed answer as the brand's citation", () => {
    const metrics = aggregateAudit(
      [
        {
          ...response(true, "indigochild.kr"),
          citedSources: [
            { domain: "indigochild.kr", url: "https://indigochild.kr/" },
            {
              domain: "indigochild.studio",
              url: "https://indigochild.studio/",
            },
          ],
        },
      ],
      "indigochild.kr"
    );

    expect(metrics.topCitedDomains).toEqual([
      { domain: "indigochild.kr", count: 1 },
    ]);
    expect(metrics.unattributedCitationCount).toBe(1);
  });

  it("keeps different-entity links out of attribution without calling unknown zero", () => {
    const raw = [
      {
        ...response(false, "indigochild.studio"),
        mentionQuality: "different_entity" as const,
      },
      response(true, "third-party.example"),
    ];
    const metrics = aggregateAudit(raw, "indigochild.kr");

    expect(metrics.topCitedDomains).toEqual([]);
    expect(metrics.unattributedCitationCount).toBe(1);
    expect(metrics.citationAttribution).toBe("unverified_external");
    const attribution = partitionCitedSources(raw, "indigochild.kr");
    expect(
      attribution.attributedResponses.every(
        (row) => row.citedSources.length === 0
      )
    ).toBe(true);
    expect(raw[0]?.citedSources).toHaveLength(1);
  });

  it("trusts the citation URL rather than a spoofed domain field", () => {
    const metrics = aggregateAudit(
      [
        {
          ...response(true, "indigochild.kr"),
          citedSources: [
            {
              domain: "indigochild.kr",
              url: "https://indigochild.kr.evil.example/article",
            },
            {
              domain: "another.example",
              url: "https://WWW.indigochild.kr/about",
            },
          ],
        },
      ],
      "indigochild.kr"
    );

    expect(metrics.topCitedDomains).toEqual([
      { domain: "indigochild.kr", count: 1 },
    ]);
    expect(metrics.unattributedCitationCount).toBe(1);
  });

  it("uses Gemini's source domain for its exact grounding redirect", () => {
    const metrics = aggregateAudit(
      [
        {
          ...response(true, "indigochild.kr"),
          engineId: "gemini",
          citedSources: [
            {
              domain: "indigochild.kr",
              url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/token",
            },
            {
              domain: "namu.wiki",
              url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/another",
            },
          ],
        },
      ],
      "indigochild.kr"
    );

    expect(metrics.topCitedDomains).toEqual([
      { domain: "indigochild.kr", count: 1 },
    ]);
    expect(metrics.unattributedCitationCount).toBe(1);
    expect(metrics.citationAttribution).toBe("partial");
  });

  it("does not present search links from a non-mention response as brand citations", () => {
    const metrics = aggregateAudit(
      [
        response(true, "official.example"),
        response(false, "same-name-company.example"),
      ],
      "official.example"
    );

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
