import { describe, expect, it } from "vitest";
import { parseKeywordTool, signNaverSearchAd } from "./naver-keywords";
import {
  aiRoutedRevenue,
  estimateRevenueOpportunity,
} from "./revenue-opportunity";

describe("revenue opportunity v2", () => {
  it("refuses to invent a number without measured demand or order value", () => {
    const base = { currentMentionRate: 0.25 };
    expect(
      estimateRevenueOpportunity({
        ...base,
        monthlyDemand: null,
        averageOrderValue: 30_000,
      })
    ).toBeNull();
    expect(
      estimateRevenueOpportunity({
        ...base,
        monthlyDemand: 10_000,
        averageOrderValue: null,
      })
    ).toBeNull();
  });

  it("computes low/base/high from disclosed assumptions", () => {
    const result = estimateRevenueOpportunity({
      monthlyDemand: 10_000,
      averageOrderValue: 30_000,
      currentMentionRate: 0.25,
    });
    // base = 10,000 × 0.205 × 0.2 × 0.0207 × 0.0293 × 30,000
    expect(result?.base.monthlyRevenue).toBe(
      Math.round(10_000 * 0.205 * 0.2 * 0.0207 * 0.0293 * 30_000)
    );
    expect(result?.low.monthlyRevenue).toBeLessThan(
      result?.base.monthlyRevenue ?? 0
    );
    expect(result?.high.monthlyRevenue).toBeGreaterThan(
      result?.base.monthlyRevenue ?? 0
    );
    expect(result?.assumptions.every((a) => a.source.length > 0)).toBe(true);
  });

  it("uses the measured gap to a target and the customer's conversion rate", () => {
    const result = estimateRevenueOpportunity({
      monthlyDemand: 10_000,
      averageOrderValue: 30_000,
      currentMentionRate: 0.25,
      targetMentionRate: 0.6,
      customerConversionRate: 0.02,
    });
    expect(result?.base.monthlyRevenue).toBe(
      Math.round(10_000 * 0.205 * 0.35 * 0.0207 * 0.02 * 30_000)
    );
    expect(
      estimateRevenueOpportunity({
        monthlyDemand: 10_000,
        averageOrderValue: 30_000,
        currentMentionRate: 0.7,
        targetMentionRate: 0.6,
      })?.base.monthlyRevenue
    ).toBe(0);
  });
});

describe("naver keyword tool client", () => {
  it("signs requests like the official sample (base64 HMAC-SHA256 of ts.method.uri)", () => {
    expect(
      signNaverSearchAd("1700000000000", "GET", "/keywordstool", "test-secret")
    ).toBe("pLnZJtUUxfdXitHXWo/EvKzookF5hlb/Rs2Fuw1W4js=");
  });

  it("parses monthly volumes and approximates '< 10'", () => {
    expect(
      parseKeywordTool({
        keywordList: [
          {
            relKeyword: "프란츠앰플",
            monthlyPcQcCnt: 120,
            monthlyMobileQcCnt: 880,
            compIdx: "중간",
          },
          {
            relKeyword: "프란츠pdrn",
            monthlyPcQcCnt: "< 10",
            monthlyMobileQcCnt: 40,
          },
          { foo: "bar" },
        ],
      })
    ).toEqual([
      {
        keyword: "프란츠앰플",
        pc: 120,
        mobile: 880,
        total: 1000,
        lowVolume: false,
        competition: "중간",
      },
      {
        keyword: "프란츠pdrn",
        pc: 5,
        mobile: 40,
        total: 45,
        lowVolume: true,
        competition: null,
      },
    ]);
    expect(parseKeywordTool({})).toEqual([]);
  });
});

describe("aiRoutedRevenue — 헤드라인(연매출 × 7% ÷ 12)", () => {
  it("프란츠 2025 연매출 72억 6,272만 원 → 월 약 4,237만 원", () => {
    const r = aiRoutedRevenue({
      annual: 7_262_720_000,
      source: "NICE평가정보(사람인 기업정보)",
      year: 2025,
    });
    expect(r?.monthly).toBe(42_365_867);
    expect(r?.ai_share_pct).toBe(7);
    expect(r?.revenue_source).toBe("NICE평가정보(사람인 기업정보), 2025년");
  });

  it("확인된 매출이 없으면 숫자를 만들지 않는다", () => {
    expect(aiRoutedRevenue(null)).toBeNull();
    expect(aiRoutedRevenue({ annual: 0, source: "x", year: 2025 })).toBeNull();
    expect(
      aiRoutedRevenue({ annual: 1_000_000_000, source: " ", year: 2025 })
    ).toBeNull();
  });
});
