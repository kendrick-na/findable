import "server-only";

import { database, type Prisma } from "@repo/database";
import {
  approvedReportUrlByDomain,
  bareDomain,
  listIssuedReports,
} from "@/lib/client-report/admin";
import type { ContactBasis } from "../contact-basis";
import {
  type ContactEmailCandidate,
  compareCandidates,
  pickSalesContact,
  publicContactBasis,
} from "../sources/contact-email";
import { composeCompanyDraft } from "./draft";
import { parseSegmentFilter, querySegment } from "./segment-query";
import {
  type ContactRoleLabel,
  contactRoleLabel,
  type DiscoverParams,
  filterFromParams,
  PAGE_SIZE,
  pipelineCounts,
  type SalesLeadStatusId,
  statusesOf,
} from "./view";

/**
 * 「회사 찾기」 화면 데이터 — 서버 컴포넌트가 부른다. 이 파일은 읽기만 한다.
 * ⚠️ migration 적용 전에는 테이블이 없어 P2021 을 던진다 → 호출부가 guard.withDiscovery 로 감싼다.
 */

export interface SegmentChip {
  companyCount: number | null;
  filter: unknown;
  id: string;
  name: string;
}

export interface CompanyRow {
  domain: string | null;
  employeeCount: number | null;
  employeeGrowth: number | null;
  id: string;
  industry: string | null;
  industrySource: string | null;
  legalName: string;
  region: string | null;
  sources: string[];
  status: SalesLeadStatusId | null;
  tags: string[];
}

export interface DiscoverScreen {
  companies: CompanyRow[];
  pipeline: ReturnType<typeof pipelineCounts>;
  segmentFilter: unknown;
  segmentInvalid: boolean;
  segments: SegmentChip[];
  total: number;
}

export async function loadDiscoverScreen(
  params: DiscoverParams
): Promise<DiscoverScreen> {
  const segments = await database.segment.findMany({
    orderBy: { createdAt: "asc" },
    select: { companyCount: true, filter: true, id: true, name: true },
    take: 50,
  });
  const active = params.segmentId
    ? segments.find((s) => s.id === params.segmentId)
    : undefined;
  const segmentFilter = active ? parseSegmentFilter(active.filter) : null;
  const filter = filterFromParams(params, segmentFilter);
  const stageWhere: Prisma.CompanyWhereInput | undefined = params.stage
    ? { leads: { some: { status: { in: statusesOf(params.stage) } } } }
    : undefined;
  const [{ companies, total }, grouped] = await Promise.all([
    querySegment(database, filter, {
      orderBy: params.sort,
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      where: stageWhere,
    }),
    database.salesLead.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const leads = companies.length
    ? await database.salesLead.findMany({
        where: { companyId: { in: companies.map((c) => c.id) } },
        select: { companyId: true, status: true },
      })
    : [];
  const statusByCompany = new Map(leads.map((l) => [l.companyId, l.status]));
  return {
    companies: companies.map((c) => ({
      domain: c.domain,
      employeeCount: c.employeeCount,
      employeeGrowth: c.employeeGrowth,
      id: c.id,
      industry: c.industry,
      industrySource: c.industrySource,
      legalName: c.legalName,
      region: c.region,
      sources: c.sources,
      status: statusByCompany.get(c.id) ?? null,
      tags: c.tags,
    })),
    pipeline: pipelineCounts(
      Object.fromEntries(grouped.map((g) => [g.status, g._count._all]))
    ),
    segmentFilter: active?.filter ?? null,
    segmentInvalid: Boolean(active && !segmentFilter),
    segments: segments.map((s) => ({
      companyCount: s.companyCount,
      filter: s.filter,
      id: s.id,
      name: s.name,
    })),
    total,
  };
}

// ── 회사 카드 ───────────────────────────────────────────────────────────────

export interface FactView {
  asOf: string;
  fetchedAt: string;
  field: string;
  source: string;
  value: string;
}

export interface ContactView {
  basis: ContactBasis;
  confidence: string;
  email: string;
  fetchedAt: string;
  label: string;
  personalName: boolean;
  role: string;
  roleLabel: ContactRoleLabel;
  sourceUrl: string;
}

export interface CompanyCardData {
  brand: { id: string; name: string } | null;
  company: CompanyRow & {
    employeeAsOf: string | null;
    foundedYear: number | null;
    industryCode: string | null;
    industryName: string | null;
    matchConfidence: string;
  };
  contacts: ContactView[];
  defaultRecipients: string[];
  draft: { body: string; recipient: string; subject: string };
  facts: FactView[];
  lastJob: {
    createdAt: string;
    id: string;
    status: string;
  } | null;
  lead: { id: string; status: SalesLeadStatusId } | null;
  reportUrl: string | null;
}

function objectFactText(
  field: string,
  v: Record<string, unknown>
): string | null {
  switch (field) {
    case "industry":
      return [v.name, v.code ? `(${String(v.code)})` : null]
        .filter(Boolean)
        .join(" ");
    case "homepage":
    case "storeUrl":
      return String(v.domain ?? v.storeUrl ?? v.raw ?? "—");
    case "employeeCount":
      return String(v.count ?? "—");
    default:
      return null;
  }
}

/** 사실 값(JSON) → 한 줄 글자. 모르는 모양은 JSON 그대로(지어내지 않는다). */
export function factText(field: string, value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "Y" : "N";
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const text = objectFactText(field, value as Record<string, unknown>);
    if (text !== null) {
      return text;
    }
  }
  return JSON.stringify(value);
}

/** 화면에 보일 사실 — 같은 (field, 원천)은 기준일 가장 최근 것 1개. 내부용 sourceRecord 는 뺀다. */
export function latestFacts(
  facts: {
    asOf: string;
    fetchedAt: Date;
    field: string;
    source: string;
    value: unknown;
  }[]
): FactView[] {
  const sorted = [...facts].sort(
    (a, b) =>
      b.asOf.localeCompare(a.asOf) ||
      b.fetchedAt.getTime() - a.fetchedAt.getTime()
  );
  const seen = new Set<string>();
  const out: FactView[] = [];
  for (const f of sorted) {
    const key = `${f.field}|${f.source}`;
    if (f.field === "sourceRecord" || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      asOf: f.asOf,
      field: f.field,
      fetchedAt: f.fetchedAt.toISOString(),
      source: f.source,
      value: factText(f.field, f.value),
    });
  }
  return out;
}

const CONFIDENCES = new Set(["high", "medium", "low"]);
const ROLES = new Set([
  "partnership",
  "general",
  "press",
  "cs",
  "other",
  "privacy",
]);

/** 저장된 연락처 행 + 방금 찾은 후보 → 하나의 정렬된 후보 목록(같은 주소는 새로 찾은 쪽). */
export function mergeContacts(
  stored: {
    confidence: string | null;
    email: string;
    fetchedAt: Date;
    label: string | null;
    personalName: boolean;
    role: string;
    sourceUrl: string;
  }[],
  found: ContactEmailCandidate[]
): ContactEmailCandidate[] {
  const byEmail = new Map<string, ContactEmailCandidate>();
  for (const row of stored) {
    byEmail.set(row.email.toLowerCase(), {
      confidence: (CONFIDENCES.has(row.confidence ?? "")
        ? row.confidence
        : "low") as ContactEmailCandidate["confidence"],
      email: row.email,
      fetchedAt: row.fetchedAt.toISOString(),
      label: row.label ?? "",
      personalName: row.personalName,
      role: (ROLES.has(row.role)
        ? row.role
        : "other") as ContactEmailCandidate["role"],
      sameDomain: false,
      sourceUrl: row.sourceUrl,
    });
  }
  for (const c of found) {
    byEmail.set(c.email.toLowerCase(), c);
  }
  return [...byEmail.values()].sort(compareCandidates);
}

export function contactViews(candidates: ContactEmailCandidate[]): {
  contacts: ContactView[];
  defaultRecipients: string[];
} {
  const pick = pickSalesContact(candidates);
  return {
    contacts: candidates.map((c) => ({
      basis: publicContactBasis(c),
      confidence: c.confidence,
      email: c.email,
      fetchedAt: c.fetchedAt,
      label: c.label,
      personalName: c.personalName,
      role: c.role,
      roleLabel: contactRoleLabel(c.role, c.label, c.email),
      sourceUrl: c.sourceUrl,
    })),
    defaultRecipients: pick ? [pick.email] : [],
  };
}

export async function loadCompanyCard(
  companyId: string,
  webUrl: string
): Promise<CompanyCardData | null> {
  const company = await database.company.findUnique({
    where: { id: companyId },
    include: {
      contacts: true,
      facts: {
        orderBy: { fetchedAt: "desc" },
        select: {
          asOf: true,
          fetchedAt: true,
          field: true,
          source: true,
          value: true,
        },
        take: 200,
      },
      leads: { select: { id: true, reportUrl: true, status: true }, take: 1 },
    },
  });
  if (!company) {
    return null;
  }
  const domain = company.domain;
  const [brand, issued] = await Promise.all([
    domain
      ? database.brand.findFirst({
          where: { domain: { in: [domain, `www.${domain}`] } },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true },
        })
      : null,
    domain ? listIssuedReports(webUrl).catch(() => []) : [],
  ]);
  // 측정 이력은 브랜드가 없어도 도메인으로 남는다(무료 진단·과거 측정) → 도메인 기준으로 본다.
  const lastJob = domain
    ? await database.auditJob.findFirst({
        where: {
          OR: [
            { domain: { in: [domain, `www.${domain}`] } },
            ...(brand ? [{ brandId: brand.id }] : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, id: true, status: true },
      })
    : null;
  const lead = company.leads[0] ?? null;
  const reportUrl =
    lead?.reportUrl ??
    (domain
      ? (approvedReportUrlByDomain(issued).get(bareDomain(domain)) ?? null)
      : null);
  const { contacts, defaultRecipients } = contactViews(
    mergeContacts(company.contacts, [])
  );
  return {
    brand,
    company: {
      domain,
      employeeAsOf: company.employeeAsOf,
      employeeCount: company.employeeCount,
      employeeGrowth: company.employeeGrowth,
      foundedYear: company.foundedYear,
      id: company.id,
      industry: company.industry,
      industryCode: company.industryCode,
      industryName: company.industryName,
      industrySource: company.industrySource,
      legalName: company.legalName,
      matchConfidence: company.matchConfidence,
      region: company.region,
      sources: company.sources,
      status: lead?.status ?? null,
      tags: company.tags,
    },
    contacts,
    defaultRecipients,
    draft: composeCompanyDraft({
      companyName: company.legalName,
      recipient: defaultRecipients[0] ?? "",
      reportUrl,
    }),
    facts: latestFacts(company.facts),
    lastJob: lastJob
      ? {
          createdAt: lastJob.createdAt.toISOString(),
          id: lastJob.id,
          status: lastJob.status,
        }
      : null,
    lead: lead ? { id: lead.id, status: lead.status } : null,
    reportUrl,
  };
}
