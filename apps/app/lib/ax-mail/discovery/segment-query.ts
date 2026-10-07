import "server-only";

import type { Industry, Prisma, PrismaClient } from "@repo/database";
import { z } from "zod";
import type { CompanyRecord } from "./ingest";
import {
  INDUSTRIES,
  REGIONS,
  SIZE_BUCKET_RANGES,
  SIZE_BUCKETS,
  sizeBucket,
} from "./taxonomy";
import { DISCOVERY_SOURCES } from "./types";

/**
 * 세그먼트 = 저장된 필터 조합(THE VC 「스마트 컬렉션」 아이디어). 회사 목록을 저장하지 않고 조건을 저장해
 * 새 회사가 적재되면 다시 돌려 채운다(refreshSegmentCompanies).
 *
 * 필터: 업종 · 태그(모두/하나라도/제외) · 지역 · 규모 구간 · 설립연도 · 직원 증가율 · 웹사이트/메일 유무 ·
 *       측정 점수 범위 · 원천 · 이름 검색.
 * buildCompanyWhere(Prisma where)와 matchesSegment(메모리 판정)는 **같은 규칙**이다 — 테스트가 둘을 같이 묶는다.
 */

const tagList = z.array(z.string().trim().min(1).max(40)).max(20);

export const segmentFilterSchema = z
  .object({
    employeeGrowthMax: z.number().min(-1).max(100).optional(),
    /** 0.1 = 비교 구간 +10% 이상 */
    employeeGrowthMin: z.number().min(-1).max(100).optional(),
    excludeTags: tagList.optional(),
    foundedFrom: z.number().int().min(1900).max(2100).optional(),
    foundedTo: z.number().int().min(1900).max(2100).optional(),
    /** true = 사람 이름이 아닌 공개 연락 메일이 1개 이상 */
    hasEmail: z.boolean().optional(),
    /** true = 자체 사이트 도메인이 있음 */
    hasWebsite: z.boolean().optional(),
    industries: z.array(z.enum(INDUSTRIES)).max(INDUSTRIES.length).optional(),
    nameContains: z.string().trim().min(1).max(100).optional(),
    regions: z.array(z.enum(REGIONS)).max(REGIONS.length).optional(),
    scoreMax: z.number().min(0).max(100).optional(),
    scoreMin: z.number().min(0).max(100).optional(),
    sizes: z.array(z.enum(SIZE_BUCKETS)).max(SIZE_BUCKETS.length).optional(),
    sources: z.array(z.enum(DISCOVERY_SOURCES)).optional(),
    /** 모두 가진 회사 */
    tagsAll: tagList.optional(),
    /** 하나라도 가진 회사 */
    tagsAny: tagList.optional(),
  })
  .strict();

export type SegmentFilter = z.infer<typeof segmentFilterSchema>;

/** 저장된 JSON → 필터. 모양이 틀리면 null(조용히 전체 조회가 되지 않도록). */
export function parseSegmentFilter(value: unknown): SegmentFilter | null {
  const parsed = segmentFilterSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function lowerTags(tags: string[] | undefined): string[] | undefined {
  return tags?.map((t) => t.trim().toLowerCase());
}

function tagClauses(filter: SegmentFilter): Prisma.CompanyWhereInput[] {
  const out: Prisma.CompanyWhereInput[] = [];
  const tagsAll = lowerTags(filter.tagsAll);
  if (tagsAll?.length) {
    out.push({ tags: { hasEvery: tagsAll } });
  }
  const tagsAny = lowerTags(filter.tagsAny);
  if (tagsAny?.length) {
    out.push({ tags: { hasSome: tagsAny } });
  }
  const excludeTags = lowerTags(filter.excludeTags);
  if (excludeTags?.length) {
    out.push({ NOT: { tags: { hasSome: excludeTags } } });
  }
  return out;
}

/** 필터 → Prisma where. 빈 필터 = 전체. */
export function buildCompanyWhere(
  filter: SegmentFilter
): Prisma.CompanyWhereInput {
  const and: Prisma.CompanyWhereInput[] = [];
  if (filter.industries?.length) {
    and.push({ industry: { in: filter.industries as Industry[] } });
  }
  and.push(...tagClauses(filter));
  if (filter.regions?.length) {
    and.push({ region: { in: filter.regions } });
  }
  if (filter.sizes?.length) {
    and.push({
      OR: filter.sizes.map((bucket) => {
        const { min, max } = SIZE_BUCKET_RANGES[bucket];
        return {
          employeeCount: max === null ? { gte: min } : { gte: min, lt: max },
        };
      }),
    });
  }
  if (filter.foundedFrom !== undefined || filter.foundedTo !== undefined) {
    and.push({
      foundedYear: { gte: filter.foundedFrom, lte: filter.foundedTo },
    });
  }
  if (
    filter.employeeGrowthMin !== undefined ||
    filter.employeeGrowthMax !== undefined
  ) {
    and.push({
      employeeGrowth: {
        gte: filter.employeeGrowthMin,
        lte: filter.employeeGrowthMax,
      },
    });
  }
  if (filter.hasWebsite !== undefined) {
    and.push({ domain: filter.hasWebsite ? { not: null } : null });
  }
  if (filter.hasEmail !== undefined) {
    and.push(
      filter.hasEmail
        ? { contacts: { some: { personalName: false } } }
        : { contacts: { none: { personalName: false } } }
    );
  }
  if (filter.scoreMin !== undefined || filter.scoreMax !== undefined) {
    and.push({
      lastMeasuredScore: { gte: filter.scoreMin, lte: filter.scoreMax },
    });
  }
  if (filter.sources?.length) {
    and.push({ sources: { hasSome: filter.sources } });
  }
  if (filter.nameContains) {
    and.push({
      legalName: { contains: filter.nameContains, mode: "insensitive" },
    });
  }
  return and.length > 0 ? { AND: and } : {};
}

/** 메모리 판정용 회사 모양 — CompanyRecord + 측정 점수 + 공개 메일 유무 */
export interface SegmentCandidate extends CompanyRecord {
  hasPublicEmail: boolean;
  lastMeasuredScore: number | null;
}

function inRange(value: number | null, min?: number, max?: number): boolean {
  if (min === undefined && max === undefined) {
    return true;
  }
  if (value === null) {
    return false;
  }
  return (
    (min === undefined || value >= min) && (max === undefined || value <= max)
  );
}

/** buildCompanyWhere 와 같은 규칙의 메모리 판정(테스트·미리보기용). */
export function matchesSegment(
  company: SegmentCandidate,
  filter: SegmentFilter
): boolean {
  const tags = new Set(company.tags.map((t) => t.toLowerCase()));
  const tagsAll = lowerTags(filter.tagsAll);
  const tagsAny = lowerTags(filter.tagsAny);
  const excludeTags = lowerTags(filter.excludeTags);
  const bucket = sizeBucket(company.employeeCount);
  const checks = [
    !filter.industries?.length ||
      (company.industry !== null &&
        filter.industries.includes(company.industry)),
    !tagsAll?.length || tagsAll.every((t) => tags.has(t)),
    !tagsAny?.length || tagsAny.some((t) => tags.has(t)),
    !(excludeTags?.length && excludeTags.some((t) => tags.has(t))),
    !filter.regions?.length ||
      (company.region !== null &&
        (filter.regions as readonly string[]).includes(company.region)),
    !filter.sizes?.length || (bucket !== null && filter.sizes.includes(bucket)),
    inRange(company.foundedYear, filter.foundedFrom, filter.foundedTo),
    inRange(
      company.employeeGrowth,
      filter.employeeGrowthMin,
      filter.employeeGrowthMax
    ),
    filter.hasWebsite === undefined ||
      filter.hasWebsite === (company.domain !== null),
    filter.hasEmail === undefined || filter.hasEmail === company.hasPublicEmail,
    inRange(company.lastMeasuredScore, filter.scoreMin, filter.scoreMax),
    !filter.sources?.length ||
      filter.sources.some((s) => company.sources.includes(s)),
    !filter.nameContains ||
      company.legalName
        .toLowerCase()
        .includes(filter.nameContains.toLowerCase()),
  ];
  return checks.every(Boolean);
}

type SegmentDb = Pick<PrismaClient, "company" | "segment" | "segmentCompany">;

export interface SegmentQueryOptions {
  /** 기본: 직원수 많은 순 → 이름 */
  orderBy?: "employees" | "growth" | "recent";
  skip?: number;
  take?: number;
}

const ORDER: Record<
  NonNullable<SegmentQueryOptions["orderBy"]>,
  Prisma.CompanyOrderByWithRelationInput[]
> = {
  employees: [
    { employeeCount: { sort: "desc", nulls: "last" } },
    { legalName: "asc" },
  ],
  growth: [
    { employeeGrowth: { sort: "desc", nulls: "last" } },
    { legalName: "asc" },
  ],
  recent: [{ createdAt: "desc" }],
};

/** 필터에 맞는 회사 목록 + 전체 수. */
export async function querySegment(
  db: Pick<SegmentDb, "company">,
  filter: SegmentFilter,
  options: SegmentQueryOptions = {}
) {
  const where = buildCompanyWhere(filter);
  const [total, companies] = await Promise.all([
    db.company.count({ where }),
    db.company.findMany({
      where,
      orderBy: ORDER[options.orderBy ?? "employees"],
      skip: options.skip ?? 0,
      take: Math.min(options.take ?? 50, 500),
    }),
  ]);
  return { companies, total };
}

/**
 * 저장된 세그먼트를 다시 돌려 SegmentCompany 를 채운다(추가만 — 조건에서 빠진 회사는 지우지 않고 남긴다:
 * 이미 영업이 진행 중일 수 있어서). 필터 JSON 이 틀리면 아무것도 하지 않고 null.
 */
export async function refreshSegmentCompanies(
  db: SegmentDb,
  segmentId: string,
  options: { limit?: number; now?: Date } = {}
): Promise<{ added: number; matched: number } | null> {
  const segment = await db.segment.findUnique({
    where: { id: segmentId },
    select: { filter: true },
  });
  const filter = segment ? parseSegmentFilter(segment.filter) : null;
  if (!filter) {
    return null;
  }
  const where = buildCompanyWhere(filter);
  const ids = await db.company.findMany({
    where,
    select: { id: true },
    take: options.limit ?? 5000,
  });
  const created = await db.segmentCompany.createMany({
    data: ids.map(({ id }) => ({ companyId: id, segmentId })),
    skipDuplicates: true,
  });
  const matched = await db.company.count({ where });
  await db.segment.update({
    where: { id: segmentId },
    data: { companyCount: matched, lastRefreshedAt: options.now ?? new Date() },
  });
  return { added: created.count, matched };
}
