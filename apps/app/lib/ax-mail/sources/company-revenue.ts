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
