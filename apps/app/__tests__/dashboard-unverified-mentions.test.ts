import { describe, expect, it } from "vitest";
import {
  buildTrackingDashboardData,
  invalidTrackingRunTimes,
  summarizeSentiment,
  type TrackingRowInput,
} from "../app/(authenticated)/lib/dashboard-data";

const measuredAt = new Date("2026-09-25T00:00:00.000Z");
const base: TrackingRowInput = {
  brand: { name: "Findable", domain: "findable.co.kr" },
  brandId: "brand-1",
  brandMentioned: true,
  engineId: "chatgpt",
  mentionListSize: 5,
  mentionPosition: 2,
  prompt: { text: "AI 검색 도구 추천" },
  sentiment: "positive",
  trackedAt: measuredAt,
};

describe("dashboard verified brand metrics", () => {
  it("excludes a provisional prior run from comparison and trend", () => {
    const previousAt = new Date("2026-09-24T00:00:00.000Z");
    const invalid = invalidTrackingRunTimes([
      {
        completedAt: previousAt,
        result: {
          metrics: { enginesCovered: ["chatgpt"], unverifiedCount: 1 },
        },
      },
    ]);
    const rows = [
      { ...base, trackedAt: previousAt, brandMentioned: false },
      base,
    ].filter((row) => !invalid.has(row.trackedAt.getTime()));

    expect(invalid.has(previousAt.getTime())).toBe(true);
    expect(buildTrackingDashboardData(rows)).toMatchObject({
      latestSov: 100,
      sovDeltaPoints: null,
      totalCount: 1,
    });
  });

  it("does not count unrelated answers as brand rank or sentiment", () => {
    const rows: TrackingRowInput[] = [
      base,
      {
        ...base,
        engineId: "claude",
        mentionListSize: 12,
        mentionPosition: null,
        sentiment: "neutral",
      },
      {
        ...base,
        brandMentioned: false,
        engineId: "gemini",
        mentionListSize: 2,
        mentionPosition: 1,
        sentiment: "negative",
      },
      {
        ...base,
        brandMentioned: false,
        engineId: "naver-briefing",
        mentionPosition: null,
        mentionListSize: null,
      },
    ];
    const dashboard = buildTrackingDashboardData(rows);

    expect(dashboard?.latestSov).toBe(67);
    expect(dashboard?.averageMentionPosition).toBe(2);
    expect(dashboard?.averageMentionListSize).toBe(5);
    expect(dashboard?.positionSampleCount).toBe(1);
    expect(dashboard?.promptScores[0]).toMatchObject({ hit: 2, position: 2 });
    expect(summarizeSentiment(rows)).toEqual({
      positive: 1,
      neutral: 1,
      negative: 0,
      total: 2,
    });
  });
});
