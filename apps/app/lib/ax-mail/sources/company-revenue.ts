import {
  type AiRoutedRevenue,
  aiRoutedRevenue,
  type ConfirmedRevenue,
  type MeasuredAccuracy,
} from "@repo/audit/revenue-opportunity";
import type { CompanyCard } from "./company-card";

/**
 * 회사 카드의 확인된 매출 → 리포트 `revenue_opportunity`.
 * 공식(연매출 × 7% × (1 − 정확 노출률))은 packages/audit/revenue-opportunity.ts 가 단일 출처 — 여기서 다시 계산하지 않는다.
 * 카드에 매출이 없으면 null: 숫자를 만들지 않는다(대표 규칙).
 */

const FS_LABEL = { CFS: "연결", OFS: "별도" } as const;

export function revenueSourceLabel(
  revenue: NonNullable<CompanyCard["revenue"]>["value"],
  companyName: string
): string {
  const kind = revenue.basis === "audit_report" ? "감사보고서" : "사업보고서";
  const fs =
    revenue.fsDiv === "CFS" || revenue.fsDiv === "OFS"
      ? FS_LABEL[revenue.fsDiv]
      : "";
  const receipt = revenue.receiptNo ? `, 접수번호 ${revenue.receiptNo}` : "";
  return `금융감독원 전자공시(DART) ${companyName} ${fs}${kind}(${revenue.fiscalYear}.12)${receipt} · 공시 원문 기준`;
}

export function confirmedRevenueFromCard(
  card: Pick<CompanyCard, "revenue">,
  companyName: string
): ConfirmedRevenue | null {
  const fact = card.revenue;
  const year = fact ? Number(fact.value.fiscalYear) : Number.NaN;
  if (!(fact && Number.isInteger(year) && fact.value.amount > 0)) {
    return null;
  }
  return {
    annual: fact.value.amount,
    source: revenueSourceLabel(fact.value, companyName),
    year,
  };
}

export function revenueOpportunityFromCard(
  card: Pick<CompanyCard, "revenue">,
  companyName: string,
  accuracy?: MeasuredAccuracy | null
): AiRoutedRevenue | null {
  return aiRoutedRevenue(confirmedRevenueFromCard(card, companyName), accuracy);
}

// ── 회사 카드 입력·저장(CompanyFact field="revenue") ───────────────────────────

/** 한 칸 = 한 사실. 유니크 키 [회사, field, source, asOf(사업연도)] 라 같은 연도 재조회·재입력은 덮어쓴다. */
export interface RevenueFactValue {
  amount: number;
  basis: "business_report" | "audit_report" | "input";
  currency: "KRW";
  fiscalYear: string;
  fsDiv: "CFS" | "OFS" | null;
  /** 공시 접수번호 — 직접 입력이면 null */
  receiptNo: string | null;
}

export interface RevenueFactRow {
  asOf: string;
  field: "revenue";
  source: "opendart" | "input";
  sourceRef: string | null;
  value: RevenueFactValue;
}

/** 공시(사업·감사보고서)에서 읽은 매출 → 저장 행. */
export function disclosedRevenueRow(revenue: {
  amount: number;
  basis?: "business_report" | "audit_report";
  fiscalYear: string;
  fsDiv: string | null;
  receiptNo: string | null;
}): RevenueFactRow {
  return {
    asOf: revenue.fiscalYear,
    field: "revenue",
    source: "opendart",
    sourceRef: revenue.receiptNo,
    value: {
      amount: revenue.amount,
      basis: revenue.basis ?? "business_report",
      currency: "KRW",
      fiscalYear: revenue.fiscalYear,
      fsDiv:
        revenue.fsDiv === "CFS" || revenue.fsDiv === "OFS"
          ? revenue.fsDiv
          : null,
      receiptNo: revenue.receiptNo,
    },
  };
}

export const MANUAL_REVENUE_UNITS = { eok: 100_000_000, won: 1 } as const;
export type ManualRevenueUnit = keyof typeof MANUAL_REVENUE_UNITS;

export type ManualRevenueResult =
  | { ok: true; row: RevenueFactRow }
  | { ok: false; reason: "amount" | "year" | "source" };

const MAX_REVENUE_WON = 1e15;

/**
 * 직접 입력 — 금액·출처·사업연도가 **셋 다** 있어야 저장한다(추정 금지 규칙: 출처 없는 숫자는 받지 않는다).
 * 입력 칸은 소수 허용(예: 12.5억 원).
 */
export function parseManualRevenue(
  input: {
    amount: number;
    fiscalYear: number;
    source: string;
    unit: ManualRevenueUnit;
  },
  now: Date = new Date()
): ManualRevenueResult {
  const won = Math.round(input.amount * MANUAL_REVENUE_UNITS[input.unit]);
  if (!(Number.isFinite(won) && won > 0 && won < MAX_REVENUE_WON)) {
    return { ok: false, reason: "amount" };
  }
  if (
    !(
      Number.isInteger(input.fiscalYear) &&
      input.fiscalYear >= 2000 &&
      input.fiscalYear <= now.getFullYear()
    )
  ) {
    return { ok: false, reason: "year" };
  }
  const source = input.source.trim();
  if (source.length < 2 || source.length > 80) {
    return { ok: false, reason: "source" };
  }
  const year = String(input.fiscalYear);
  return {
    ok: true,
    row: {
      asOf: year,
      field: "revenue",
      source: "input",
      sourceRef: source,
      value: {
        amount: won,
        basis: "input",
        currency: "KRW",
        fiscalYear: year,
        fsDiv: null,
        receiptNo: null,
      },
    },
  };
}
