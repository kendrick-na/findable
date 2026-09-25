import { MENTION_VERDICT_VERSION } from "@repo/ai/lib/mention-verdict-version";
import { describe, expect, it } from "vitest";
import { canShowLatestAnalysis } from "@/lib/content/analysis-publication";

const createdAt = new Date("2026-09-26T00:00:00.000Z");
const publishableResult = {
  mentionVerdictVersion: MENTION_VERDICT_VERSION,
  metrics: { unverifiedCount: 0 },
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
          metrics: { unverifiedCount: 2 },
        },
        status: "completed",
        trackedAt: new Date("2026-09-26T00:01:00.000Z"),
      })
    ).toBe(false);
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
