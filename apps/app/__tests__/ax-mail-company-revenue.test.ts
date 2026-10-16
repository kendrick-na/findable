/** @vitest-environment node */
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@repo/database", () => ({ database: {} }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));

const {
  confirmedRevenueFromCard,
  disclosedRevenueRow,
  parseManualRevenue,
  revenueOpportunityFromCard,
} = await import("@/lib/ax-mail/sources/company-revenue");
const { factText, latestFacts } = await import(
  "@/lib/ax-mail/discovery/screen"
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

describe("직접 입력(parseManualRevenue)", () => {
  const ok = {
    amount: 12.5,
    fiscalYear: 2025,
    source: "NICE평가정보 2025",
    unit: "eok" as const,
  };
  const now = new Date("2026-10-16T00:00:00Z");

  test("억 원 → 원 환산, 출처·연도·입력 표시가 값에 남는다", () => {
    const out = parseManualRevenue(ok, now);
    expect(out).toMatchObject({
      ok: true,
      row: {
        asOf: "2025",
        source: "input",
        sourceRef: "NICE평가정보 2025",
        value: {
          amount: 1_250_000_000,
          basis: "input",
          fiscalYear: "2025",
          receiptNo: null,
        },
      },
    });
  });

  test("출처·연도·금액 중 하나라도 이상하면 저장 안 함(추정 금지)", () => {
    expect(parseManualRevenue({ ...ok, source: " " }, now)).toEqual({
      ok: false,
      reason: "source",
    });
    expect(parseManualRevenue({ ...ok, fiscalYear: 2027 }, now)).toEqual({
      ok: false,
      reason: "year",
    });
    expect(parseManualRevenue({ ...ok, fiscalYear: 2025.5 }, now)).toEqual({
      ok: false,
      reason: "year",
    });
    expect(parseManualRevenue({ ...ok, amount: 0 }, now)).toEqual({
      ok: false,
      reason: "amount",
    });
    expect(parseManualRevenue({ ...ok, amount: Number.NaN }, now)).toEqual({
      ok: false,
      reason: "amount",
    });
    expect(
      parseManualRevenue({ ...ok, amount: 1e20, unit: "won" }, now)
    ).toEqual({ ok: false, reason: "amount" });
  });
});

describe("공시 값 저장 행·화면 표기", () => {
  const dart = disclosedRevenueRow({
    amount: 324_958_207_706,
    basis: "audit_report",
    fiscalYear: "2025",
    fsDiv: "CFS",
    receiptNo: "20260331002615",
  });

  test("공시 값은 opendart·접수번호·사업연도 키로 저장", () => {
    expect(dart).toMatchObject({
      asOf: "2025",
      field: "revenue",
      source: "opendart",
      sourceRef: "20260331002615",
    });
  });

  test("카드에는 「약 3,249.6억 원 · 2025 연결 · 공시 기준」", () => {
    expect(factText("revenue", dart.value)).toBe(
      "약 3,249.6억 원 · 2025 연결 · 공시 기준"
    );
  });

  test("직접 입력은 「직접 입력」, 1억 미만은 만 원 단위", () => {
    const manual = parseManualRevenue(
      {
        amount: 5000,
        fiscalYear: 2025,
        source: "홈페이지 회사소개",
        unit: "won",
      },
      new Date("2026-10-16")
    );
    expect(manual.ok && factText("revenue", manual.row.value)).toBe(
      "약 1만 원 · 2025 · 직접 입력"
    );
    const v = { amount: 52_000_000, basis: "input", fiscalYear: "2025" };
    expect(factText("revenue", v)).toBe("약 5,200만 원 · 2025 · 직접 입력");
  });

  test("공시 값과 직접 입력 값이 다르면 두 줄로 나란히(어느 쪽이 맞는지 정하지 않음)", () => {
    const at = new Date("2026-10-16T00:00:00Z");
    const lines = latestFacts([
      {
        asOf: "2025",
        fetchedAt: at,
        field: "revenue",
        source: "opendart",
        value: dart.value,
      },
      {
        asOf: "2025",
        fetchedAt: at,
        field: "revenue",
        source: "input",
        value: { amount: 300_000_000_000, basis: "input", fiscalYear: "2025" },
      },
    ]);
    expect(lines.map((l) => l.sources[0]?.source).sort()).toEqual([
      "input",
      "opendart",
    ]);
  });
});
