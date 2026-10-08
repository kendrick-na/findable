import "server-only";

import type { Industry, Prisma, PrismaClient } from "@repo/database";
import { normalizeCorpName } from "../sources/http";
import { classifySubIndustries, subTag } from "./sub-industry";
import {
  audienceTags,
  classifyIndustry,
  type IndustryBasis,
  type IndustryId,
  normalizeHomepage,
  normalizeTags,
} from "./taxonomy";
import type { DiscoveredCompany } from "./types";

/**
 * 발굴 적재 — 소스 1페이지(배치) → Company upsert + CompanyFact(출처·기준일) 누적.
 *
 * 원칙(2026-10-07):
 *  - **멱등**: 같은 배치를 다시 넣어도 회사·사실 행이 늘지 않는다.
 *      회사 = 사업자번호(우선) 또는 정규화 이름+지역, 사실 = (회사, field, 원천, 기준일) 유니크.
 *  - **덮어쓰지 않는 근거**: Company 칸은 필터용 사본, 근거는 CompanyFact 에 원천별로 남는다.
 *  - **모르면 합치지 않는다**: 이름+지역 후보가 2곳 이상이면 어느 쪽인지 정하지 않고 ambiguous 로 센다(동명 회사 오병합 방지).
 *  - 사람이 정한 업종(industrySource=manual)은 자동 적재가 덮지 않는다.
 *  - DB 접근은 CompanyStore 포트로만 — 테스트는 메모리 구현, 운영은 prismaCompanyStore.
 */

export interface CompanyRecord {
  businessNumber: string | null;
  corpRegNo: string | null;
  dartCorpCode: string | null;
  domain: string | null;
  employeeAsOf: string | null;
  employeeCount: number | null;
  employeeGrowth: number | null;
  foundedYear: number | null;
  id: string;
  industry: IndustryId | null;
  industryCode: string | null;
  industryName: string | null;
  industrySource: string | null;
  legalName: string;
  matchConfidence: string;
  normalizedName: string;
  region: string | null;
  sources: string[];
  tags: string[];
}

export type CompanyData = Omit<CompanyRecord, "id">;

export type FactValue =
  | string
  | number
  | boolean
  | null
  | FactValue[]
  | { [key: string]: FactValue };

export interface FactInput {
  /** 원천 기준일 — 모르면 "" */
  asOf: string;
  fetchedAt: Date;
  field: string;
  source: string;
  sourceRef: string | null;
  value: FactValue;
}

export interface CompanyStore {
  create(data: CompanyData, fetchedAt: Date): Promise<CompanyRecord>;
  findByBusinessNumber(businessNumber: string): Promise<CompanyRecord | null>;
  findByNameRegion(
    normalizedName: string,
    region: string | null
  ): Promise<CompanyRecord[]>;
  /** 같은 회사·field·원천의 사실들(기준일 오름차순) */
  listFacts(
    companyId: string,
    field: string,
    source: string
  ): Promise<{ asOf: string; value: unknown }[]>;
  update(
    id: string,
    data: Partial<CompanyData>,
    fetchedAt: Date
  ): Promise<CompanyRecord>;
  upsertFact(
    companyId: string,
    fact: FactInput
  ): Promise<"created" | "updated">;
}

export interface IngestResult {
  /** 이름+지역 후보가 여럿이라 붙이지 않은 행 */
  ambiguous: number;
  created: number;
  factsCreated: number;
  factsUpdated: number;
  /** 이름이 비어 정규화 후 남는 게 없는 행 */
  skipped: number;
  updated: number;
}

// ── 순수 함수: 매칭 · 병합 · 사실 ─────────────────────────────────────────────

const BASIS_RANK: Record<string, number> = {
  manual: 99,
  ksic: 3,
  name: 2,
  products: 1,
};

function basisRank(basis: string | null | undefined): number {
  return basis ? (BASIS_RANK[basis] ?? 0) : 0;
}

function yearOf(date: string | null): number | null {
  const y = Number((date ?? "").slice(0, 4));
  return Number.isInteger(y) && y >= 1900 && y <= 2100 ? y : null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 이 행에서 정할 수 있는 업종 판정 */
export function verdictFor(item: DiscoveredCompany): {
  basis: IndustryBasis | null;
  industry: IndustryId | null;
} {
  return classifyIndustry({
    industryCode: item.industryCode,
    industryName: item.industryName,
    products: item.products,
  });
}

/** 이 행이 붙여 주는 태그(원천 태그 + 고객 유형 추정) */
export function tagsFor(
  item: DiscoveredCompany,
  industry: IndustryId | null
): string[] {
  return normalizeTags([
    ...item.tags,
    // 세부 분야(sub:fintech …) — Industry enum 은 그대로, 태그로만 더 나눈다.
    ...classifySubIndustries(item).map((v) => subTag(v.id)),
    ...audienceTags({
      industry,
      industryCode: item.industryCode,
      industryName: item.industryName,
      isMailOrderSeller: item.source === "ftc_mail_order",
    }),
  ]);
}

/** 업종 — 근거가 더 강할 때만 교체, 사람이 정한 값(manual)은 유지 */
function industryPatch(
  existing: CompanyRecord | null,
  item: DiscoveredCompany,
  verdict: { basis: IndustryBasis | null; industry: IndustryId | null }
): Partial<CompanyData> {
  if (!verdict.industry || existing?.industrySource === "manual") {
    return {};
  }
  if (
    existing?.industry &&
    basisRank(verdict.basis) <= basisRank(existing.industrySource)
  ) {
    return {};
  }
  return {
    industry: verdict.industry,
    industryCode: item.industryCode,
    industryName: item.industryName ?? item.products,
    industrySource: verdict.basis,
  };
}

/**
 * 직원수 — 기준일이 더 최근이면 교체. 같은 기준일에 값이 둘 이상(국민연금 지점 여러 곳 등)이면 큰 값
 * → 처리 순서와 무관하게 같은 결과(재적재 멱등).
 */
function employeePatch(
  existing: CompanyRecord | null,
  item: DiscoveredCompany,
  fetchedAt: Date
): Partial<CompanyData> {
  if (item.employees === null) {
    return {};
  }
  const asOf = item.asOf ?? isoDate(fetchedAt);
  const prevAsOf = existing?.employeeAsOf ?? null;
  const newer = prevAsOf === null || asOf > prevAsOf;
  const sameDayLarger =
    asOf === prevAsOf &&
    item.employees > (existing?.employeeCount ?? Number.NEGATIVE_INFINITY);
  return newer || sameDayLarger
    ? { employeeAsOf: asOf, employeeCount: item.employees }
    : {};
}

/**
 * 기존 회사(없으면 null) + 새 행 → 바꿀 칸만. 기존 값이 있으면 대부분 유지(빈 칸만 채움).
 * 예외: 업종은 근거가 더 강하면 교체, 직원수는 기준일이 같거나 더 최근이면 교체.
 */
export function mergeCompany(
  existing: CompanyRecord | null,
  item: DiscoveredCompany,
  fetchedAt: Date
): Partial<CompanyData> {
  const verdict = verdictFor(item);
  const { domain } = normalizeHomepage(item.homepage);
  const patch: Partial<CompanyData> = {};
  const fill = <K extends keyof CompanyData>(key: K, value: CompanyData[K]) => {
    if (
      value !== null &&
      value !== undefined &&
      (existing?.[key] ?? null) === null
    ) {
      patch[key] = value;
    }
  };
  if (!existing) {
    patch.legalName = item.name.trim();
    patch.normalizedName = normalizeCorpName(item.name);
  }
  fill("businessNumber", item.businessNumber);
  fill("corpRegNo", item.corpRegNo);
  fill("dartCorpCode", item.dartCorpCode);
  fill("domain", domain);
  fill("region", item.region);
  fill("foundedYear", yearOf(item.foundedOn));
  Object.assign(
    patch,
    industryPatch(existing, item, verdict),
    employeePatch(existing, item, fetchedAt)
  );

  const tags = normalizeTags([
    ...(existing?.tags ?? []),
    ...tagsFor(item, patch.industry ?? existing?.industry ?? null),
  ]);
  if (!existing || tags.join() !== normalizeTags(existing.tags).join()) {
    patch.tags = tags;
  }
  const sources = [
    ...new Set([...(existing?.sources ?? []), item.source]),
  ].sort();
  if (!existing || sources.join() !== [...existing.sources].sort().join()) {
    patch.sources = sources;
  }
  const businessNumber =
    patch.businessNumber ?? existing?.businessNumber ?? null;
  const confidence = businessNumber ? "exact" : "name_only";
  if (existing?.matchConfidence !== confidence) {
    patch.matchConfidence = confidence;
  }
  return patch;
}

/** 새 행 → 남길 사실들(출처·기준일 포함). 대표자 이름·연락처는 원천 파서에서 이미 빠져 있다. */
export function factsFor(
  item: DiscoveredCompany,
  fetchedAt: Date
): FactInput[] {
  const base = {
    asOf: item.asOf ?? "",
    fetchedAt,
    source: item.source,
    sourceRef: item.sourceRef,
  };
  const facts: FactInput[] = [
    { ...base, field: "legalName", value: item.name.trim() },
    {
      ...base,
      field: "sourceRecord",
      value: { extra: item.extra, sourceRef: item.sourceRef, tags: item.tags },
    },
  ];
  if (item.businessNumber) {
    facts.push({
      ...base,
      field: "businessNumber",
      value: item.businessNumber,
    });
  }
  if (item.industryCode || item.industryName) {
    const verdict = verdictFor(item);
    facts.push({
      ...base,
      field: "industry",
      value: {
        basis: verdict.basis,
        code: item.industryCode,
        industry: verdict.industry,
        name: item.industryName,
      },
    });
  }
  const subs = classifySubIndustries(item);
  if (subs.length) {
    facts.push({
      ...base,
      field: "subIndustry",
      value: subs.map((v) => ({ basis: v.basis, id: v.id })),
    });
  }
  if (item.address) {
    facts.push({ ...base, field: "address", value: item.address });
  }
  if (item.homepage) {
    const { domain, storeUrl } = normalizeHomepage(item.homepage);
    facts.push({
      ...base,
      field: storeUrl ? "storeUrl" : "homepage",
      value: { domain, raw: item.homepage, storeUrl },
    });
  }
  if (item.employees !== null) {
    facts.push({
      ...base,
      field: "employeeCount",
      value: {
        count: item.employees,
        lost: (item.extra.lost as number | null | undefined) ?? null,
        newlyEnrolled:
          (item.extra.newlyEnrolled as number | null | undefined) ?? null,
      },
    });
  }
  if (item.foundedOn) {
    facts.push({ ...base, field: "foundedOn", value: item.foundedOn });
  }
  if (item.products) {
    facts.push({ ...base, field: "products", value: item.products });
  }
  return facts;
}

/** 국민연금 가입자수 사실들 → 변화율. 최근 6개 시점 중 처음 대비 마지막. 2개 미만·처음 0 이하 → null. */
export function employeeGrowthFrom(
  points: { asOf: string; value: unknown }[]
): number | null {
  const counts = points
    .filter((p) => p.asOf)
    .map((p) => ({
      asOf: p.asOf,
      count:
        typeof p.value === "object" && p.value !== null && "count" in p.value
          ? Number((p.value as { count: unknown }).count)
          : Number.NaN,
    }))
    .filter((p) => Number.isFinite(p.count))
    .sort((a, b) => a.asOf.localeCompare(b.asOf))
    .slice(-6);
  const first = counts[0];
  const last = counts.at(-1);
  if (!(first && last) || counts.length < 2 || first.count <= 0) {
    return null;
  }
  return Math.round(((last.count - first.count) / first.count) * 1000) / 1000;
}

/** 매칭 — 사업자번호 → (앞6자리) → 이름+지역. undefined = 새 회사, "ambiguous" = 붙이지 않음. */
export async function resolveCompany(
  store: CompanyStore,
  item: DiscoveredCompany
): Promise<CompanyRecord | "ambiguous" | undefined> {
  const normalizedName = normalizeCorpName(item.name);
  if (item.businessNumber) {
    const exact = await store.findByBusinessNumber(item.businessNumber);
    if (exact) {
      return exact;
    }
    // 이름만으로 먼저 들어온 같은 회사(벤처명단 등)에 번호를 붙인다 — 번호 없는 후보가 정확히 1곳일 때만.
    const loose = (
      await store.findByNameRegion(normalizedName, item.region)
    ).filter((c) => c.businessNumber === null);
    return loose.length === 1 ? loose[0] : undefined;
  }
  const candidates = await store.findByNameRegion(normalizedName, item.region);
  if (item.bizNoPrefix) {
    const prefix = item.bizNoPrefix;
    const sameNumber = candidates.filter((c) =>
      c.businessNumber?.startsWith(prefix)
    );
    if (sameNumber.length === 1) {
      return sameNumber[0];
    }
    if (sameNumber.length > 1) {
      return "ambiguous";
    }
    const unnumbered = candidates.filter((c) => c.businessNumber === null);
    if (unnumbered.length === 1) {
      return unnumbered[0];
    }
    return unnumbered.length > 1 ? "ambiguous" : undefined;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  return candidates.length > 1 ? "ambiguous" : undefined;
}

/** 배치 적재. 순서대로 처리해 같은 배치 안 중복도 한 회사로 모인다. */
export async function ingestCompanies(
  store: CompanyStore,
  batch: DiscoveredCompany[],
  options: { fetchedAt?: Date } = {}
): Promise<IngestResult> {
  const fetchedAt = options.fetchedAt ?? new Date();
  const result: IngestResult = {
    ambiguous: 0,
    created: 0,
    factsCreated: 0,
    factsUpdated: 0,
    skipped: 0,
    updated: 0,
  };
  for (const item of batch) {
    if (!normalizeCorpName(item.name)) {
      result.skipped++;
      continue;
    }
    const found = await resolveCompany(store, item);
    if (found === "ambiguous") {
      result.ambiguous++;
      continue;
    }
    const company = await upsertCompany(store, found, item, fetchedAt, result);
    for (const fact of factsFor(item, fetchedAt)) {
      const outcome = await store.upsertFact(company.id, fact);
      if (outcome === "created") {
        result.factsCreated++;
      } else {
        result.factsUpdated++;
      }
    }
    if (item.source === "nps" && item.employees !== null) {
      await refreshEmployeeGrowth(store, company, fetchedAt);
    }
  }
  return result;
}

const EMPTY_COMPANY: Omit<CompanyData, "legalName" | "normalizedName"> = {
  businessNumber: null,
  corpRegNo: null,
  dartCorpCode: null,
  domain: null,
  employeeAsOf: null,
  employeeCount: null,
  employeeGrowth: null,
  foundedYear: null,
  industry: null,
  industryCode: null,
  industryName: null,
  industrySource: null,
  matchConfidence: "name_only",
  region: null,
  sources: [],
  tags: [],
};

async function upsertCompany(
  store: CompanyStore,
  found: CompanyRecord | undefined,
  item: DiscoveredCompany,
  fetchedAt: Date,
  result: IngestResult
): Promise<CompanyRecord> {
  if (!found) {
    const created = await store.create(
      {
        ...EMPTY_COMPANY,
        legalName: item.name.trim(),
        normalizedName: normalizeCorpName(item.name),
        ...mergeCompany(null, item, fetchedAt),
      },
      fetchedAt
    );
    result.created++;
    return created;
  }
  const patch = mergeCompany(found, item, fetchedAt);
  if (Object.keys(patch).length === 0) {
    return found;
  }
  result.updated++;
  return await store.update(found.id, patch, fetchedAt);
}

async function refreshEmployeeGrowth(
  store: CompanyStore,
  company: CompanyRecord,
  fetchedAt: Date
): Promise<void> {
  const growth = employeeGrowthFrom(
    await store.listFacts(company.id, "employeeCount", "nps")
  );
  if (growth !== company.employeeGrowth) {
    await store.update(company.id, { employeeGrowth: growth }, fetchedAt);
  }
}

// ── Prisma 구현 ─────────────────────────────────────────────────────────────

type DiscoveryDb = Pick<PrismaClient, "company" | "companyFact">;

const COMPANY_SELECT = {
  businessNumber: true,
  corpRegNo: true,
  dartCorpCode: true,
  domain: true,
  employeeAsOf: true,
  employeeCount: true,
  employeeGrowth: true,
  foundedYear: true,
  id: true,
  industry: true,
  industryCode: true,
  industryName: true,
  industrySource: true,
  legalName: true,
  matchConfidence: true,
  normalizedName: true,
  region: true,
  sources: true,
  tags: true,
} satisfies Prisma.CompanySelect;

function toRecord(
  row: Prisma.CompanyGetPayload<{ select: typeof COMPANY_SELECT }>
): CompanyRecord {
  return { ...row, industry: row.industry as IndustryId | null };
}

function toDbData(
  data: Partial<CompanyData>
): Prisma.CompanyUncheckedUpdateInput {
  const { industry, ...rest } = data;
  return industry === undefined
    ? rest
    : { ...rest, industry: industry as Industry | null };
}

/**
 * 운영용 저장소. ⚠️ migration 20261007_sales_discovery 적용 전에는 테이블이 없다 —
 * 호출하는 쪽(크론·관리 화면)은 적용 확인 뒤에만 연결할 것.
 */
export function prismaCompanyStore(db: DiscoveryDb): CompanyStore {
  return {
    async create(data, fetchedAt) {
      const row = await db.company.create({
        data: {
          ...(toDbData(data) as Prisma.CompanyUncheckedCreateInput),
          legalName: data.legalName,
          normalizedName: data.normalizedName,
          lastEnrichedAt: fetchedAt,
        },
        select: COMPANY_SELECT,
      });
      return toRecord(row);
    },
    async findByBusinessNumber(businessNumber) {
      const row = await db.company.findUnique({
        where: { businessNumber },
        select: COMPANY_SELECT,
      });
      return row ? toRecord(row) : null;
    },
    async findByNameRegion(normalizedName, region) {
      const rows = await db.company.findMany({
        where: { normalizedName, region },
        select: COMPANY_SELECT,
        take: 10,
      });
      return rows.map(toRecord);
    },
    async listFacts(companyId, field, source) {
      return await db.companyFact.findMany({
        where: { companyId, field, source },
        select: { asOf: true, value: true },
        orderBy: { asOf: "asc" },
      });
    },
    async update(id, data, fetchedAt) {
      const row = await db.company.update({
        where: { id },
        data: { ...toDbData(data), lastEnrichedAt: fetchedAt },
        select: COMPANY_SELECT,
      });
      return toRecord(row);
    },
    async upsertFact(companyId, fact) {
      const key = {
        asOf: fact.asOf,
        companyId,
        field: fact.field,
        source: fact.source,
      };
      const existing = await db.companyFact.findUnique({
        where: { companyId_field_source_asOf: key },
        select: { id: true },
      });
      const value = fact.value as Prisma.InputJsonValue;
      if (existing) {
        await db.companyFact.update({
          where: { id: existing.id },
          data: { fetchedAt: fact.fetchedAt, sourceRef: fact.sourceRef, value },
        });
        return "updated";
      }
      await db.companyFact.create({
        data: {
          ...key,
          fetchedAt: fact.fetchedAt,
          sourceRef: fact.sourceRef,
          value,
        },
      });
      return "created";
    },
  };
}
