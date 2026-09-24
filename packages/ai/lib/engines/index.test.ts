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
});
