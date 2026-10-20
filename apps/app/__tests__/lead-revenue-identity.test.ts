/** @vitest-environment node */
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const leads = await import("@/lib/ax-mail/leads");
type Lead = import("@/lib/ax-mail/leads").Lead;

function lead(patch: Partial<Lead>): Lead {
  return {
    annualRevenue: { krw: 12_152_511_976, source: "DART 감사보고서(2025)" },
    brand: "(주)파이온텍",
    brandEn: null,
    company: "(주)파이온텍",
    ...patch,
  } as Lead;
}

describe("매출 동일성 규칙 — DART 매출은 confirmed 일 때만 문장에 쓴다", () => {
  test("DART 매출 + confirmed → 월 매출 문장 나온다", () => {
    const l = lead({ revenueIdentity: "confirmed" });
    expect(leads.leadRevenueAllowed(l)).toBe(true);
    expect(leads.monthlyAiInfluencedRevenue(l)).not.toBeNull();
  });
  test("DART 매출 + name_only/probable/mismatch/미지정 → 문장 막힘", () => {
    for (const level of [
      "name_only",
      "probable",
      "mismatch",
      null,
      undefined,
    ] as const) {
      const l = lead({ revenueIdentity: level });
      expect(leads.leadRevenueAllowed(l)).toBe(false);
      expect(leads.monthlyAiInfluencedRevenue(l)).toBeNull();
    }
  });
  test("대표 확정 출처(NICE 등)는 동일성 등급과 무관하게 허용(기존 동작 유지)", () => {
    const l = lead({
      annualRevenue: { krw: 7_260_000_000, source: "NICE평가정보 2025" },
      revenueIdentity: null,
    });
    expect(leads.leadRevenueAllowed(l)).toBe(true);
    expect(leads.monthlyAiInfluencedRevenue(l)).not.toBeNull();
  });
  test("연매출이 없으면 null(추정 금지)", () => {
    expect(
      leads.monthlyAiInfluencedRevenue(lead({ annualRevenue: null }))
    ).toBeNull();
  });
});
