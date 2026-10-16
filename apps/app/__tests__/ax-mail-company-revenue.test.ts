/** @vitest-environment node */
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));

const { revenueOpportunityFromCard, confirmedRevenueFromCard } = await import(
  "@/lib/ax-mail/sources/company-revenue"
);

const card = (over: Record<string, unknown> = {}) =>
  ({
    revenue: {
      asOf: "2025",
      fetchedAt: "2026-10-16T00:00:00.000Z",
      source: "opendart",
      value: {
        amount: 324_958_207_706,
        basis: "audit_report",
        currency: "KRW",
        fiscalYear: "2025",
        fsDiv: "CFS",
        receiptNo: "20260331002615",
        ...over,
      },
    },
  }) as never;

describe("회사 카드 → revenue_opportunity", () => {
  test("넘버즈인(비나우) 시험 기준: 사람이 적은 리포트 값과 같은 숫자가 시스템에서 나온다", () => {
    const out = revenueOpportunityFromCard(card(), "(주)비나우", {
      accurate: 9,
      total: 56,
    });
    expect(out).toMatchObject({
      ai_routed_annual: 22_747_074_539,
      ai_share_pct: 7,
      annual_revenue: 324_958_207_706,
      miss_pct: 84,
      // 수기 초안은 19,091,294,703 — 1원 차이(반올림 순서). 화면은 '약 190.9억 원'이라 같다.
      missed_annual: 19_091_294_702,
      missed_monthly: 1_590_941_225,
      monthly: 1_895_589_545,
    });
    expect(out?.revenue_source).toContain("연결감사보고서(2025.12)");
    expect(out?.revenue_source).toContain("20260331002615");
  });

  test("측정이 없으면 연 매출 기준 숫자만(놓치는 매출 없음)", () => {
    const out = revenueOpportunityFromCard(card(), "(주)비나우");
    expect(out?.ai_routed_annual).toBe(22_747_074_539);
    expect(out?.missed_annual).toBeUndefined();
  });

  test("카드에 매출이 없으면 null — 숫자를 만들지 않는다", () => {
    expect(revenueOpportunityFromCard({ revenue: null }, "X")).toBeNull();
    expect(confirmedRevenueFromCard(card({ amount: 0 }), "X")).toBeNull();
    expect(
      confirmedRevenueFromCard(card({ fiscalYear: "미상" }), "X")
    ).toBeNull();
  });
});
