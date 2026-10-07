/** @vitest-environment node */
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const seg = await import("@/lib/ax-mail/discovery/segment-query");
type Candidate =
  import("@/lib/ax-mail/discovery/segment-query").SegmentCandidate;

function company(patch: Partial<Candidate>): Candidate {
  return {
    businessNumber: null,
    corpRegNo: null,
    dartCorpCode: null,
    domain: null,
    employeeAsOf: null,
    employeeCount: null,
    employeeGrowth: null,
    foundedYear: null,
    hasPublicEmail: false,
    id: "x",
    industry: null,
    industryCode: null,
    industryName: null,
    industrySource: null,
    lastMeasuredScore: null,
    legalName: "회사",
    matchConfidence: "name_only",
    normalizedName: "회사",
    region: null,
    sources: [],
    tags: [],
    ...patch,
  };
}

const BEAUTY_SEOUL = company({
  domain: "franz.com",
  employeeCount: 21,
  employeeGrowth: 0.3,
  foundedYear: 2013,
  hasPublicEmail: true,
  id: "a",
  industry: "beauty",
  lastMeasuredScore: 34,
  legalName: "바이오센서연구소",
  region: "서울",
  sources: ["nps", "mfds"],
  tags: ["b2c", "commerce", "venture", "vc_invested"],
});
const SAAS_GYEONGGI = company({
  employeeCount: 120,
  foundedYear: 2019,
  id: "b",
  industry: "b2b_saas",
  legalName: "알파소프트",
  region: "경기",
  sources: ["innobiz"],
  tags: ["b2b", "innobiz"],
});

describe("필터 스키마", () => {
  test("모양이 틀리면 null(전체 조회로 새지 않음)", () => {
    expect(
      seg.parseSegmentFilter({ industries: ["beauty"], sizes: ["10-49"] })
    ).toEqual({ industries: ["beauty"], sizes: ["10-49"] });
    expect(seg.parseSegmentFilter({ industries: ["cosmetics"] })).toBeNull();
    expect(seg.parseSegmentFilter({ unknown: 1 })).toBeNull();
    expect(seg.parseSegmentFilter({ regions: ["서울특별시"] })).toBeNull();
    expect(seg.parseSegmentFilter("x")).toBeNull();
    expect(seg.parseSegmentFilter({})).toEqual({});
  });
});

describe("Prisma where 빌더", () => {
  test("빈 필터 = 전체", () => {
    expect(seg.buildCompanyWhere({})).toEqual({});
  });
  test("모든 조건이 AND 로 묶인다", () => {
    const where = seg.buildCompanyWhere({
      employeeGrowthMin: 0.1,
      excludeTags: ["Listed"],
      foundedFrom: 2015,
      hasEmail: true,
      hasWebsite: true,
      industries: ["beauty", "food"],
      nameContains: "바이오",
      regions: ["서울"],
      scoreMax: 50,
      sizes: ["10-49", "500+"],
      sources: ["venture"],
      tagsAll: ["commerce"],
      tagsAny: ["venture", "innobiz"],
    });
    expect(where.AND).toEqual([
      { industry: { in: ["beauty", "food"] } },
      { tags: { hasEvery: ["commerce"] } },
      { tags: { hasSome: ["venture", "innobiz"] } },
      { NOT: { tags: { hasSome: ["listed"] } } },
      { region: { in: ["서울"] } },
      {
        OR: [
          { employeeCount: { gte: 10, lt: 50 } },
          { employeeCount: { gte: 500 } },
        ],
      },
      { foundedYear: { gte: 2015, lte: undefined } },
      { employeeGrowth: { gte: 0.1, lte: undefined } },
      { domain: { not: null } },
      { contacts: { some: { personalName: false } } },
      { lastMeasuredScore: { gte: undefined, lte: 50 } },
      { sources: { hasSome: ["venture"] } },
      { legalName: { contains: "바이오", mode: "insensitive" } },
    ]);
  });
  test("웹사이트·메일 없음 조건", () => {
    expect(
      seg.buildCompanyWhere({ hasEmail: false, hasWebsite: false }).AND
    ).toEqual([
      { domain: null },
      { contacts: { none: { personalName: false } } },
    ]);
  });
});

describe("메모리 판정(빌더와 같은 규칙)", () => {
  test.each([
    [{}, ["a", "b"]],
    [{ industries: ["beauty"] }, ["a"]],
    [{ regions: ["경기"] }, ["b"]],
    [{ sizes: ["10-49"] }, ["a"]],
    [{ sizes: ["100-499", "500+"] }, ["b"]],
    [{ tagsAll: ["commerce", "vc_invested"] }, ["a"]],
    [{ tagsAny: ["innobiz", "tips"] }, ["b"]],
    [{ excludeTags: ["b2b"] }, ["a"]],
    [{ foundedFrom: 2015 }, ["b"]],
    [{ employeeGrowthMin: 0.1 }, ["a"]],
    [{ hasWebsite: true }, ["a"]],
    [{ hasWebsite: false }, ["b"]],
    [{ hasEmail: true }, ["a"]],
    [{ scoreMin: 0, scoreMax: 50 }, ["a"]],
    [{ sources: ["innobiz"] }, ["b"]],
    [{ nameContains: "소프트" }, ["b"]],
    [{ industries: ["beauty"], regions: ["경기"] }, []],
  ] as const)("%j → %j", (filter, ids) => {
    const parsed = seg.parseSegmentFilter(filter);
    if (!parsed) {
      throw new Error("invalid fixture");
    }
    expect(
      [BEAUTY_SEOUL, SAAS_GYEONGGI]
        .filter((c) => seg.matchesSegment(c, parsed))
        .map((c) => c.id)
    ).toEqual(ids);
  });
});

describe("DB 호출(모의 Prisma)", () => {
  test("querySegment — where·정렬·take 상한", async () => {
    const db = {
      company: {
        count: vi.fn(async () => 2),
        findMany: vi.fn(async () => [{ id: "a" }, { id: "b" }]),
      },
    };
    const res = await seg.querySegment(
      db as never,
      { industries: ["beauty"] },
      { take: 9999, orderBy: "growth" }
    );
    expect(res.total).toBe(2);
    expect(db.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { employeeGrowth: { sort: "desc", nulls: "last" } },
          { legalName: "asc" },
        ],
        take: 500,
        where: { AND: [{ industry: { in: ["beauty"] } }] },
      })
    );
  });
  test("refreshSegmentCompanies — 추가만(skipDuplicates), 개수·시각 갱신, 틀린 필터는 아무것도 안 함", async () => {
    const now = new Date("2026-10-07T00:00:00Z");
    const db = {
      company: {
        count: vi.fn(async () => 2),
        findMany: vi.fn(async () => [{ id: "a" }, { id: "b" }]),
      },
      segment: {
        findUnique: vi.fn(
          async (): Promise<{ filter: unknown }> => ({
            filter: { tagsAny: ["venture"] },
          })
        ),
        update: vi.fn(async () => ({})),
      },
      segmentCompany: { createMany: vi.fn(async () => ({ count: 1 })) },
    };
    expect(
      await seg.refreshSegmentCompanies(db as never, "s1", { now })
    ).toEqual({ added: 1, matched: 2 });
    expect(db.segmentCompany.createMany).toHaveBeenCalledWith({
      data: [
        { companyId: "a", segmentId: "s1" },
        { companyId: "b", segmentId: "s1" },
      ],
      skipDuplicates: true,
    });
    expect(db.segment.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { companyCount: 2, lastRefreshedAt: now },
    });

    db.segment.findUnique.mockResolvedValueOnce({
      filter: { industries: ["nope"] },
    });
    db.segmentCompany.createMany.mockClear();
    expect(await seg.refreshSegmentCompanies(db as never, "s1")).toBeNull();
    expect(db.segmentCompany.createMany).not.toHaveBeenCalled();
  });
});
