import { describe, expect, it } from "vitest";
import { MENTION_VERDICT_VERSION } from "../ai/lib/mention-verdict-version";
import { isUsableRun, scoreOf } from "./run-quality";

const metrics = {
  averageMentionPosition: null,
  enginesCovered: ["perplexity", "gemini"],
  enginesWithMention: ["gemini"],
  citationAttribution: "none_observed",
  sov: 50,
  verifiedCount: 20,
};
const metricsWithAiEvidence = (verified: number, unverified: number) => ({
  ...metrics,
  verifiedCount: verified,
  unverifiedCount: unverified,
  answerBuckets: { ai: { adjudicated: verified, unverified } },
});

describe("run quality", () => {
  it("does not publish a score when entity verification is incomplete", () => {
    const result = { metrics: { ...metrics, unverifiedCount: 1 } };
    expect(isUsableRun(result)).toBe(false);
    expect(scoreOf(result)).toBeNull();
  });

  it("keeps a run usable when a few unverified answers are excluded (<= 20%)", () => {
    const result = {
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: metricsWithAiEvidence(21, 1),
    };
    expect(isUsableRun(result)).toBe(true);
    expect(scoreOf(result)).toBeTypeOf("number");
  });

  it("keeps provisional runs out of trends and alerts", () => {
    const tooManyUnverified = {
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: metricsWithAiEvidence(15, 7),
    };
    const tooFewVerified = {
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: metricsWithAiEvidence(9, 0),
    };
    for (const result of [tooManyUnverified, tooFewVerified]) {
      expect(isUsableRun(result)).toBe(false);
      expect(scoreOf(result)).toBeNull();
    }
  });

  it("keeps fully verified measurements usable", () => {
    const result = {
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: metricsWithAiEvidence(20, 0),
    };
    expect(isUsableRun(result)).toBe(true);
    expect(scoreOf(result)).toBeTypeOf("number");
  });

  it("still scores a run whose external citations are only partially attributed", () => {
    const result = {
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: {
        ...metricsWithAiEvidence(20, 0),
        citationAttribution: "partial",
        unattributedCitationCount: 1,
      },
    };
    expect(isUsableRun(result)).toBe(true);
    expect(scoreOf(result)).toBeTypeOf("number");
  });

  it("does not use legacy runs without current entity verdicts for trends or alerts", () => {
    const result = { metrics: { ...metrics, unverifiedCount: 0 } };
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
