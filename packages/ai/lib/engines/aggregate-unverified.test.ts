import { describe, expect, it } from "vitest";

import { aggregateAudit } from "./aggregate";
import type { EngineResponse } from "./types";

const response = (overrides: Partial<EngineResponse> = {}): EngineResponse => ({
  engineId: "perplexity",
  rawResponse: "",
  brandMentioned: false,
  mentionPosition: null,
  mentionListSize: null,
  sentiment: null,
  citedSources: [],
  shareOfVoice: null,
  errorMessage: null,
  durationMs: 0,
  isStub: false,
  ...overrides,
});

describe("unverified brand matches", () => {
  it("excludes failed entity verification from the appearance denominator", () => {
    const metrics = aggregateAudit([
      response({ brandMentioned: true, engineId: "gemini" }),
      response({ mentionQuality: "unverified" }),
      response({ engineId: "naver" }),
    ]);

    expect(metrics.sov).toBe(50);
    expect(metrics.verifiedCount).toBe(2);
    expect(metrics.unverifiedCount).toBe(1);
  });

  it("also excludes an unverified row from the appearance numerator", () => {
    const metrics = aggregateAudit([
      response({ brandMentioned: true, mentionQuality: "unverified" }),
      response({ brandMentioned: true, engineId: "gemini" }),
      response({ engineId: "naver" }),
    ]);

    expect(metrics.sov).toBe(50);
    expect(metrics.enginesWithMention).toEqual(["gemini"]);
  });
});
