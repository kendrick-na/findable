import "server-only";

import { database, type Prisma } from "@repo/database";
import { SALES_INTERNAL_ORG_ID } from "@repo/database/internal-orgs";
import { log } from "@repo/observability/log";
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
import { isMissingTableError } from "./guard";
import { syncLeadStages } from "./pipeline";
import { parseSegmentFilter, querySegment } from "./segment-query";
import {
  SUB_INDUSTRIES,
  type SubIndustryBasis,
  type SubIndustryId,
  subIndustriesFromTags,
} from "./sub-industry";
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
  /** 영업 내부 조직의 마지막 완료 측정(ISO) — 없으면 null */
  lastSalesMeasuredAt: string | null;
  legalName: string;
  region: string | null;
  sources: string[];
  status: SalesLeadStatusId | null;
  subs: SubIndustryId[];
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

/**
 * 화면 열 때 영업 단계 자동 이동(측정 완료 → measured, 리포트 발송 승인 → reported, 앞으로만).
 * 테이블 없음은 위로(「DB 준비 전」), 그 밖의 실패는 화면을 막지 않고 0건으로 본다.
 */
export async function syncStagesForScreen(
  webUrl: string
): Promise<{ measured: number; reported: number }> {
  try {
    const issued = await listIssuedReports(webUrl).catch(() => []);
    // 영업 회차로 발행한 리포트만 — 같은 도메인의 고객 리포트는 쓰지 않는다.
    return await syncLeadStages(database, (salesJobIds) =>
      approvedReportUrlByDomain(
        issued.filter((v) => salesJobIds.has(v.auditJobId))
      )
    );
  } catch (error) {
    if (isMissingTableError(error)) {
      throw error;
    }
    log.warn("ax_mail.discovery.sync_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { measured: 0, reported: 0 };
  }
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
  // [측정] 확인 창의 「N일 전 측정 있음」 — 영업 내부 조직의 완료 측정만(고객 회차는 보지 않는다).
  const pageDomains = companies
    .map((c) => c.domain)
    .filter((d): d is string => Boolean(d));
  const salesDone = pageDomains.length
    ? await database.auditJob.findMany({
        where: {
          domain: { in: pageDomains },
          organizationId: SALES_INTERNAL_ORG_ID,
          status: "completed",
        },
        select: { completedAt: true, createdAt: true, domain: true },
      })
    : [];
  const lastMeasuredByDomain = new Map<string, string>();
  for (const job of salesDone) {
    const at = (job.completedAt ?? job.createdAt).toISOString();
    const prev = lastMeasuredByDomain.get(job.domain);
    if (!prev || at > prev) {
      lastMeasuredByDomain.set(job.domain, at);
    }
  }
  return {
    companies: companies.map((c) => ({
      domain: c.domain,
      employeeCount: c.employeeCount,
      employeeGrowth: c.employeeGrowth,
      id: c.id,
      industry: c.industry,
      industrySource: c.industrySource,
      lastSalesMeasuredAt: c.domain
        ? (lastMeasuredByDomain.get(c.domain) ?? null)
        : null,
      legalName: c.legalName,
      region: c.region,
      sources: c.sources,
      status: statusByCompany.get(c.id) ?? null,
      subs: subIndustriesFromTags(c.tags),
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

export interface FactSourceView {
  asOf: string;
  fetchedAt: string;
  source: string;
}

/** 값 1개 = 1줄. 같은 값을 준 원천이 여럿이면 sources 에 함께 담는다. */
export interface FactView {
  field: string;
  sources: FactSourceView[];
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
    completedAt: string | null;
    createdAt: string;
    id: string;
    status: string;
  } | null;
  lead: { id: string; status: SalesLeadStatusId } | null;
  reportUrl: string | null;
  subIndustries: {
    basis: SubIndustryBasis;
    id: SubIndustryId;
    source: string;
  }[];
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

interface RawFact {
  asOf: string;
  fetchedAt: Date;
  field: string;
  source: string;
  value: unknown;
}

/** 표에 따로 보여 주는 내부 기록 — 기본 정보 목록에서는 뺀다. */
const HIDDEN_FIELDS = new Set(["sourceRecord", "subIndustry"]);

/**
 * 화면에 보일 사실 — (field, 원천)마다 기준일 가장 최근 것 1개를 고른 뒤,
 * **값이 같은 줄은 하나로 합치고 출처를 여러 개 함께** 단다(회사명·업종이 원천마다 반복되던 문제).
 * 값이 다르면 줄을 나눠 그대로 둔다(어느 쪽이 맞는지 정하지 않는다).
 */
export function latestFacts(facts: RawFact[]): FactView[] {
  const sorted = [...facts].sort(
    (a, b) =>
      b.asOf.localeCompare(a.asOf) ||
      b.fetchedAt.getTime() - a.fetchedAt.getTime()
  );
  const seen = new Set<string>();
  const byValue = new Map<string, FactView>();
  for (const f of sorted) {
    const key = `${f.field}|${f.source}`;
    if (HIDDEN_FIELDS.has(f.field) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const value = factText(f.field, f.value);
    const lineKey = `${f.field}|${value.trim().toLowerCase()}`;
    const line = byValue.get(lineKey) ?? { field: f.field, sources: [], value };
    line.sources.push({
      asOf: f.asOf,
      fetchedAt: f.fetchedAt.toISOString(),
      source: f.source,
    });
    byValue.set(lineKey, line);
  }
  return [...byValue.values()];
}

/** 세부 분야 사실들 → 분야별 가장 강한 근거 1개(KSIC > 업종명 > 취급품목). */
export function subIndustryViews(
  facts: RawFact[]
): { basis: SubIndustryBasis; id: SubIndustryId; source: string }[] {
  const rank: Record<SubIndustryBasis, number> = {
    ksic: 3,
    name: 2,
    products: 1,
  };
  const best = new Map<
    SubIndustryId,
    { basis: SubIndustryBasis; id: SubIndustryId; source: string }
  >();
  for (const f of facts) {
    if (f.field !== "subIndustry" || !Array.isArray(f.value)) {
      continue;
    }
    for (const entry of f.value as { basis?: unknown; id?: unknown }[]) {
      const id = entry?.id as SubIndustryId;
      const basis = entry?.basis as SubIndustryBasis;
      if (!(SUB_INDUSTRIES.includes(id) && basis in rank)) {
        continue;
      }
      const prev = best.get(id);
      if (!prev || rank[basis] > rank[prev.basis]) {
        best.set(id, { basis, id, source: f.source });
      }
    }
  }
  return SUB_INDUSTRIES.filter((id) => best.has(id)).map(
    (id) =>
      best.get(id) as {
        basis: SubIndustryBasis;
        id: SubIndustryId;
        source: string;
      }
  );
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
  // 🔴 브랜드·측정·리포트는 **영업 내부 조직 것만** 본다(독립 검수 P0-1).
  //   같은 도메인의 고객 브랜드·고객 회차·무료 진단·고객 리포트는 영업 카드에 쓰지 않는다.
  const domains = domain ? [domain, `www.${domain}`] : [];
  const salesWhere = {
    domain: { in: domains },
    organizationId: SALES_INTERNAL_ORG_ID,
  };
  const [brand, issued, lastJob, salesJobs] = domain
    ? await Promise.all([
        database.brand.findFirst({
          where: salesWhere,
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true },
        }),
        listIssuedReports(webUrl).catch(() => []),
        database.auditJob.findFirst({
          where: salesWhere,
          orderBy: { createdAt: "desc" },
          select: {
            completedAt: true,
            createdAt: true,
            id: true,
            status: true,
          },
        }),
        database.auditJob.findMany({
          where: { ...salesWhere, status: "completed" },
          select: { id: true },
        }),
      ])
    : [null, [], null, []];
  const salesJobIds = new Set(salesJobs.map((j) => j.id));
  const lead = company.leads[0] ?? null;
  const reportUrl =
    lead?.reportUrl ??
    (domain
      ? (approvedReportUrlByDomain(
          issued.filter((v) => salesJobIds.has(v.auditJobId))
        ).get(bareDomain(domain)) ?? null)
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
      lastSalesMeasuredAt:
        lastJob?.status === "completed"
          ? (lastJob.completedAt ?? lastJob.createdAt).toISOString()
          : null,
      legalName: company.legalName,
      matchConfidence: company.matchConfidence,
      region: company.region,
      sources: company.sources,
      status: lead?.status ?? null,
      subs: subIndustriesFromTags(company.tags),
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
    subIndustries: subIndustryViews(company.facts),
    lastJob: lastJob
      ? {
          completedAt: lastJob.completedAt?.toISOString() ?? null,
          createdAt: lastJob.createdAt.toISOString(),
          id: lastJob.id,
          status: lastJob.status,
        }
      : null,
    lead: lead ? { id: lead.id, status: lead.status } : null,
    reportUrl,
  };
}
