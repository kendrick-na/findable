import "server-only";

import { database } from "@repo/database";
import {
  IDENTITY_FIELD,
  type IdentityState,
  identityStateOf,
} from "@/lib/ax-mail/discovery/identity-check";
import { bareDomain, issueClientReport, loadReportSource } from "./admin";
import {
  type BlockDiffRow,
  bizNumberSet,
  buildRevenueBlock,
  diffRevenueBlocks,
  type PickedRevenue,
  pickLatestRevenue,
  type RevenueBlock,
} from "./revenue-link-core";

/**
 * 「회사 카드 매출 불러오기」 — 측정 회차 ↔ 회사 카드를 잇고 revenue_opportunity 초안을 만든다.
 * 🔒 읽기 전용(DB 쓰기 0). 값을 리포트에 넣는 것은 사람이 화면에서 「JSON에 넣기」를 눌렀을 때뿐이다.
 * 연결 규칙(대표 승인): 사업자번호 우선 → 번호가 없거나 둘 이상이면 도메인 후보를 목록으로 보여 주고 사람이 고른다.
 */

export interface CompanyCandidate {
  businessNumber: string | null;
  domain: string | null;
  id: string;
  legalName: string;
  matchedBy: "business_number" | "domain";
}

export type RevenueLinkResult =
  | { state: "invalid_job" }
  | {
      state: "choose";
      candidates: CompanyCandidate[];
      reason: "no_number" | "many_numbers" | "number_not_in_cards";
    }
  | { state: "no_company"; domain: string; numbers: string[] }
  | {
      state: "no_revenue";
      company: CompanyCandidate;
    }
  | {
      /** DART 출처 매출인데 동일성 확정(confirmed)이 아니면 리포트에 넣지 않는다. 직접 입력(input)은 제외. */
      state: "identity_unconfirmed";
      company: CompanyCandidate;
      identity: IdentityState;
    }
  | {
      state: "ready";
      accuracy: { accurate: number; total: number } | null;
      accuracyNote: "no_review" | "review_rejected" | null;
      block: RevenueBlock;
      company: CompanyCandidate;
      diff: BlockDiffRow[] | null;
      existing: boolean;
      revenue: PickedRevenue;
    };

const COMPANY_SELECT = {
  businessNumber: true,
  domain: true,
  id: true,
  legalName: true,
} as const;

function digitsToDashed(digits: string): string {
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function officialSiteNumber(officialSite: unknown): string | null {
  const n = (officialSite as { businessNumber?: unknown } | null)
    ?.businessNumber;
  return typeof n === "string" ? n : null;
}

function existingBlock(review: unknown): unknown {
  const copy = (review as { copy?: unknown } | null)?.copy;
  return (copy as { revenue_opportunity?: unknown } | null | undefined)
    ?.revenue_opportunity;
}

async function companiesFor(
  numbers: string[],
  domain: string
): Promise<CompanyCandidate[]> {
  const rows = await database.company.findMany({
    where: {
      OR: [
        ...(numbers.length > 0 ? [{ businessNumber: { in: numbers } }] : []),
        ...(domain ? [{ domain: { in: [domain, `www.${domain}`] } }] : []),
      ],
    },
    select: COMPANY_SELECT,
    take: 10,
  });
  return rows.map((row) => ({
    ...row,
    matchedBy: numbers.includes(row.businessNumber ?? "")
      ? ("business_number" as const)
      : ("domain" as const),
  }));
}

/** 번호가 한 개이고 그 번호의 회사가 카드에 있으면 자동 확정, 아니면 사람이 고를 후보 목록. */
async function resolveCompany(
  numbers: string[],
  domain: string,
  chosenId: string | null
): Promise<
  | { kind: "company"; company: CompanyCandidate }
  | {
      kind: "choose";
      candidates: CompanyCandidate[];
      reason: "no_number" | "many_numbers" | "number_not_in_cards";
    }
  | { kind: "none" }
> {
  const candidates = await companiesFor(numbers, domain);
  if (chosenId) {
    // 화면이 보여 준 후보 안에서만 고를 수 있다(임의 회사 ID 금지).
    const picked = candidates.find((c) => c.id === chosenId);
    return picked ? { kind: "company", company: picked } : { kind: "none" };
  }
  const [onlyNumber] = numbers;
  if (numbers.length === 1 && onlyNumber) {
    const hit = candidates.filter((c) => c.businessNumber === onlyNumber);
    if (hit.length === 1 && hit[0]) {
      return { kind: "company", company: hit[0] };
    }
  }
  if (candidates.length === 0) {
    return { kind: "none" };
  }
  let reason: "no_number" | "many_numbers" | "number_not_in_cards" =
    "number_not_in_cards";
  if (numbers.length === 0) {
    reason = "no_number";
  } else if (numbers.length > 1) {
    reason = "many_numbers";
  }
  return { candidates, kind: "choose", reason };
}

async function reviewedAccuracy(
  auditJobId: string,
  review: unknown
): Promise<{
  accuracy: { accurate: number; total: number } | null;
  note: "no_review" | "review_rejected" | null;
}> {
  if (!review || typeof review !== "object") {
    return { accuracy: null, note: "no_review" };
  }
  const outcome = await issueClientReport({
    auditJobId,
    expiresInDays: 1,
    mode: "preview",
    review,
    slug: "revenue-link",
    version: 1,
  });
  if (outcome.kind !== "preview") {
    return { accuracy: null, note: "review_rejected" };
  }
  const { n, ok_n: okN } = outcome.data.computed.s;
  return n > 0
    ? { accuracy: { accurate: okN, total: n }, note: null }
    : { accuracy: null, note: "review_rejected" };
}

export async function previewRevenueLink(input: {
  auditJobId: string;
  companyId?: string | null;
  review?: unknown;
}): Promise<RevenueLinkResult> {
  const loaded = await loadReportSource(input.auditJobId);
  if (!loaded.ok) {
    return { state: "invalid_job" };
  }
  const job = await database.auditJob.findUnique({
    where: { id: input.auditJobId },
    select: { brandId: true, domain: true },
  });
  if (!job) {
    return { state: "invalid_job" };
  }
  const brand = job.brandId
    ? await database.brand.findUnique({
        where: { id: job.brandId },
        select: { businessNumber: true },
      })
    : null;
  const numbers = bizNumberSet([
    brand?.businessNumber,
    officialSiteNumber(loaded.source.identity.officialSite),
  ]);
  const domain = bareDomain(job.domain ?? "");

  const resolved = await resolveCompany(
    numbers,
    domain,
    input.companyId ?? null
  );
  if (resolved.kind === "none") {
    return {
      domain,
      numbers: numbers.map(digitsToDashed),
      state: "no_company",
    };
  }
  if (resolved.kind === "choose") {
    return {
      candidates: resolved.candidates,
      reason: resolved.reason,
      state: "choose",
    };
  }

  const { company } = resolved;
  const facts = await database.companyFact.findMany({
    where: { companyId: company.id, field: "revenue" },
    select: { asOf: true, source: true, sourceRef: true, value: true },
  });
  const revenue = pickLatestRevenue(facts);
  if (!revenue) {
    return { company, state: "no_revenue" };
  }
  if (revenue.basis !== "input") {
    const identityFacts = await database.companyFact.findMany({
      where: { companyId: company.id, field: IDENTITY_FIELD },
      select: { asOf: true, field: true, source: true, value: true },
    });
    const identity = identityStateOf(identityFacts);
    if (identity !== "confirmed") {
      return { company, identity, state: "identity_unconfirmed" };
    }
  }
  const { accuracy, note } = await reviewedAccuracy(
    input.auditJobId,
    input.review
  );
  const block = buildRevenueBlock(revenue, company.legalName, accuracy);
  if (!block) {
    return { company, state: "no_revenue" };
  }
  const existing = existingBlock(input.review);
  return {
    accuracy,
    accuracyNote: note,
    block,
    company,
    diff: existing ? diffRevenueBlocks(existing, block) : null,
    existing: Boolean(existing),
    revenue,
    state: "ready",
  };
}
