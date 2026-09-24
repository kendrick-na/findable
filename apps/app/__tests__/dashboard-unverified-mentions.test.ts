import { describe, expect, it } from "vitest";
import {
  buildTrackingDashboardData,
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
