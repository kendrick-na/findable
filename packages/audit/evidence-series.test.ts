import { describe, expect, it } from "vitest";
import { buildBeforeAfterRow } from "./before-after";
import { completionMentionRate, mentionRateSeries } from "./evidence-series";

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n));

describe("admin evidence measurement units", () => {
  it("converts a stored 0–100 completion snapshot into a 0–1 rate", () => {
    expect(completionMentionRate(50)).toBe(0.5);
    expect(completionMentionRate(1)).toBe(0.01);
    expect(completionMentionRate(0)).toBe(0);
    expect(completionMentionRate(101)).toBeNull();
  });

  it("groups answer rows by run instead of treating each answer as a new measurement", () => {
    const series = mentionRateSeries([
      { trackedAt: day(2), brandMentioned: true },
      { trackedAt: day(2), brandMentioned: false },
      { trackedAt: day(3), brandMentioned: true },
    ]);
    expect(series).toEqual([
      { measuredAt: day(2), sov: 0.5 },
      { measuredAt: day(3), sov: 1 },
    ]);
  });

  it("reports +10pp, not a false −59.5 percentage-point change", () => {
    const row = buildBeforeAfterRow(
      {
        completedAt: day(0),
        kind: "prompt_gap",
        target: "x",
        recognitionAtCompletion: null,
        sovAtCompletion: completionMentionRate(40),
      },
      mentionRateSeries([
        { trackedAt: day(2), brandMentioned: true },
        { trackedAt: day(2), brandMentioned: false },
      ])
    );
    expect(row.beforeSov).toBe(0.4);
    expect(row.afterSov).toBe(0.5);
    expect(row.deltaSov).toBeCloseTo(0.1);
  });
});
