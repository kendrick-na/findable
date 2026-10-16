import type { MeasuredAccuracy } from "@repo/audit/revenue-opportunity";
import { aiRoutedRevenue } from "@repo/audit/revenue-opportunity";
import { confirmedRevenueFromValue } from "@/lib/ax-mail/sources/company-revenue";
import { normalizeBizNo } from "@/lib/ax-mail/sources/http";
import type { RevenueBlock } from "./revenue-link-apply";

/**
 * 리포트 발행 화면 「회사 카드 매출 불러오기」의 순수 규칙(DB·서버 없음 — 테스트가 쉽다).
 * 설계: docs/_적용/리포트_매출불러오기_버튼_설계안_20261016.md (대표 승인 2026-10-16).
 */

export type { RevenueBlock } from "./revenue-link-apply";

export interface RevenueFactRowLike {
  asOf: string;
  source: string;
  sourceRef: string | null;
  value: unknown;
}

export interface PickedRevenue {
  amount: number;
  basis: "business_report" | "audit_report" | "input";
  currency: string | null;
  fiscalYear: string;
  fsDiv: string | null;
  receiptNo: string | null;
  sourceNote: string | null;
}

const TEN_DIGITS_RE = /^\d{10}$/;
const FS_RANK: Record<string, number> = { CFS: 0, OFS: 1 };

function toPicked(row: RevenueFactRowLike): PickedRevenue | null {
  const v = row.value as Record<string, unknown> | null;
  if (!v || typeof v !== "object") {
    return null;
  }
  const amount = typeof v.amount === "number" ? v.amount : Number.NaN;
  const fiscalYear = typeof v.fiscalYear === "string" ? v.fiscalYear : row.asOf;
  const basis =
    v.basis === "audit_report" || v.basis === "input"
      ? v.basis
      : "business_report";
  if (!(Number.isFinite(amount) && amount > 0 && fiscalYear)) {
    return null;
  }
  return {
    amount,
    basis,
    currency: typeof v.currency === "string" ? v.currency : null,
    fiscalYear,
    fsDiv: typeof v.fsDiv === "string" ? v.fsDiv : null,
    receiptNo: typeof v.receiptNo === "string" ? v.receiptNo : null,
    sourceNote: row.source === "input" ? row.sourceRef : null,
  };
}

/**
 * 어느 매출을 쓸까 — 사업연도 최신 → 연결(CFS) 우선·없으면 별도(OFS)·그 외 → 공시가 직접 입력보다 우선.
 * (같은 해에 공시와 직접 입력이 다르면 공시를 쓴다. 화면에는 둘 다 카드에 남아 있다.)
 */
export function pickLatestRevenue(
  rows: RevenueFactRowLike[]
): PickedRevenue | null {
  const picked = rows
    .map(toPicked)
    .filter((r): r is PickedRevenue => r !== null);
  picked.sort(
    (a, b) =>
      b.fiscalYear.localeCompare(a.fiscalYear) ||
      (FS_RANK[a.fsDiv ?? ""] ?? 9) - (FS_RANK[b.fsDiv ?? ""] ?? 9) ||
      (a.basis === "input" ? 1 : 0) - (b.basis === "input" ? 1 : 0)
  );
  return picked[0] ?? null;
}

/** 회차에서 모은 사업자번호들 → 숫자 10자리로 정규화·중복 제거(체크섬 통과분만). */
export function bizNumberSet(values: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const digits = normalizeBizNo(value);
    if (digits && isValidBizNo(digits)) {
      out.add(digits);
    }
  }
  return [...out];
}

/** 국세청 사업자번호 체크섬(가중합) — 틀린 번호로 엉뚱한 회사를 잇지 않기 위함. */
export function isValidBizNo(digits: string): boolean {
  if (!TEN_DIGITS_RE.test(digits)) {
    return false;
  }
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(digits[i]) * (weights[i] ?? 0);
  }
  sum += Math.floor((Number(digits[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(digits[9]);
}

/**
 * 리포트 `copy.revenue_opportunity` 초안. 공식은 packages/audit 의 aiRoutedRevenue 하나뿐.
 * 놓치는 비율은 accuracy(사람이 검수한 판별 기준 ok_n / n)가 있을 때만.
 */
export function buildRevenueBlock(
  revenue: PickedRevenue,
  companyName: string,
  accuracy: MeasuredAccuracy | null
): RevenueBlock | null {
  const confirmed = confirmedRevenueFromValue(
    {
      amount: revenue.amount,
      basis: revenue.basis,
      currency: revenue.currency,
      fiscalYear: revenue.fiscalYear,
      fsDiv: revenue.fsDiv,
      receiptNo: revenue.receiptNo,
    },
    companyName,
    revenue.sourceNote
  );
  const block = aiRoutedRevenue(confirmed, accuracy);
  if (!block) {
    return null;
  }
  return {
    ...block,
    ...(accuracy && block.miss_pct !== undefined
      ? {
          miss_den: accuracy.total,
          miss_num: accuracy.total - accuracy.accurate,
        }
      : {}),
  };
}

export interface BlockDiffRow {
  existing: string;
  field: string;
  generated: string;
  same: boolean;
}

const DIFF_FIELDS: [string, string][] = [
  ["annual_revenue", "연매출(원)"],
  ["ai_routed_annual", "AI 경유 매출(연, 원)"],
  ["missed_annual", "놓치는 매출(연, 원)"],
  ["miss_pct", "놓치는 비율(%)"],
  ["revenue_source", "매출 출처 문구"],
];

const show = (v: unknown): string =>
  v === undefined || v === null ? "—" : String(v);

/** 기존에 사람이 적은 값과 새로 만든 값을 한 줄씩 비교(덮어쓰기 전 확인용). */
export function diffRevenueBlocks(
  existing: unknown,
  generated: RevenueBlock
): BlockDiffRow[] {
  const old = (
    existing && typeof existing === "object" ? existing : {}
  ) as Record<string, unknown>;
  return DIFF_FIELDS.map(([field, label]) => ({
    existing: show(old[field]),
    field: label,
    generated: show(generated[field]),
    same: show(old[field]) === show(generated[field]),
  }));
}
