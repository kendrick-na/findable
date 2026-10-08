import { MENTION_VERDICT_VERSION } from "@repo/ai/lib/mention-verdict-version";
import { describe, expect, it } from "vitest";
import { canShowLatestAnalysis } from "@/lib/content/analysis-publication";

const createdAt = new Date("2026-09-26T00:00:00.000Z");
const aiEvidence = (verified: number, unverified: number) => ({
  verifiedCount: verified,
  unverifiedCount: unverified,
  answerBuckets: { ai: { adjudicated: verified, unverified } },
});
const publishableResult = {
  mentionVerdictVersion: MENTION_VERDICT_VERSION,
  metrics: {
    ...aiEvidence(12, 0),
    citationAttribution: "none_observed",
  },
};

describe("latest analysis publication", () => {
  it("rejects a previous Tracking snapshot even when the new job completed", () => {
    expect(
      canShowLatestAnalysis({
        createdAt,
        result: publishableResult,
        status: "completed",
        trackedAt: new Date("2026-09-25T23:59:59.000Z"),
      })
    ).toBe(false);
  });

  it("rejects an unverified run even when Tracking rows exist", () => {
    expect(
      canShowLatestAnalysis({
        createdAt,
        result: {
          ...publishableResult,
          // 3/12 = 25% > 20% → provisional.
          metrics: aiEvidence(9, 3),
        },
        status: "completed",
        trackedAt: new Date("2026-09-26T00:01:00.000Z"),
      })
    ).toBe(false);
  });

  it("does not block the latest analysis just because some external citations are unattributed", () => {
    expect(
      canShowLatestAnalysis({
        createdAt,
        result: {
          ...publishableResult,
          metrics: {
            ...aiEvidence(12, 0),
            citationAttribution: "partial",
            unattributedCitationCount: 1,
          },
        },
        status: "completed",
        trackedAt: new Date("2026-09-26T00:01:00.000Z"),
      })
    ).toBe(true);
  });

  it("keeps a citation-based source analysis closed while citations are partially attributed", () => {
    const partial = {
      ...publishableResult,
      metrics: {
        ...aiEvidence(12, 0),
        citationAttribution: "partial",
        unattributedCitationCount: 1,
      },
    };
    const input = {
      createdAt,
      status: "completed",
      trackedAt: new Date("2026-09-26T00:01:00.000Z"),
    };
    expect(
      canShowLatestAnalysis({ ...input, citationBased: true, result: partial })
    ).toBe(false);
    expect(
      canShowLatestAnalysis({
        ...input,
        citationBased: true,
        result: publishableResult,
      })
    ).toBe(true);
  });

  it("allows only a current, completed, verified run", () => {
    expect(
      canShowLatestAnalysis({
        createdAt,
        result: publishableResult,
        status: "completed",
        trackedAt: new Date("2026-09-26T00:01:00.000Z"),
      })
    ).toBe(true);
  });
});
