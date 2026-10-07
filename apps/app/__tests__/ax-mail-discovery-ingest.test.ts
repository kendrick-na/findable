/** @vitest-environment node */
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ingest = await import("@/lib/ax-mail/discovery/ingest");
const { emptyDiscovered } = await import("@/lib/ax-mail/discovery/types");

type Store = import("@/lib/ax-mail/discovery/ingest").CompanyStore;
type CompanyRecord = import("@/lib/ax-mail/discovery/ingest").CompanyRecord;
type FactInput = import("@/lib/ax-mail/discovery/ingest").FactInput;
type Discovered = import("@/lib/ax-mail/discovery/types").DiscoveredCompany;

/** 메모리 저장소 — Prisma 구현과 같은 계약(사업자번호 unique, 사실 (회사,field,원천,기준일) unique). */
function memoryStore() {
  const companies = new Map<string, CompanyRecord>();
  const facts = new Map<string, FactInput & { companyId: string }>();
  let seq = 0;
  const store: Store = {
    create(data) {
      if (
        data.businessNumber &&
        [...companies.values()].some(
          (c) => c.businessNumber === data.businessNumber
        )
      ) {
        return Promise.reject(new Error("unique businessNumber"));
      }
      seq++;
      const row = { ...data, id: `c${seq}` };
      companies.set(row.id, row);
      return Promise.resolve(row);
    },
    findByBusinessNumber(bn) {
      return Promise.resolve(
        [...companies.values()].find((c) => c.businessNumber === bn) ?? null
      );
    },
    findByNameRegion(name, region) {
      return Promise.resolve(
        [...companies.values()].filter(
          (c) => c.normalizedName === name && c.region === region
        )
      );
    },
    listFacts(companyId, field, source) {
      return Promise.resolve(
        [...facts.values()]
          .filter(
            (f) =>
              f.companyId === companyId &&
              f.field === field &&
              f.source === source
          )
          .sort((a, b) => a.asOf.localeCompare(b.asOf))
          .map((f) => ({ asOf: f.asOf, value: f.value }))
      );
    },
    update(id, data) {
      const prev = companies.get(id);
      if (!prev) {
        return Promise.reject(new Error("missing"));
      }
      const next = { ...prev, ...data };
      companies.set(id, next);
      return Promise.resolve(next);
    },
    upsertFact(companyId, fact) {
      const key = [companyId, fact.field, fact.source, fact.asOf].join("|");
      const had = facts.has(key);
      facts.set(key, { ...fact, companyId });
      return Promise.resolve(had ? "updated" : "created");
    },
  };
  return { companies, facts, store };
}

function d(
  source: Discovered["source"],
  name: string,
  patch: Partial<Discovered> = {}
): Discovered {
  return { ...emptyDiscovered(source, name), ...patch };
}

const AT = new Date("2026-10-07T00:00:00Z");

describe("적재 — 멱등·병합·출처", () => {
  test("같은 배치를 두 번 넣어도 회사·사실이 늘지 않는다", async () => {
    const { companies, facts, store } = memoryStore();
    const batch = [
      d("innobiz", "(주) 알파칩스", {
        businessNumber: "1358158772",
        homepage: "www.alphachips.co.kr",
        products: "반도체설계",
        region: "경기",
        tags: ["innobiz"],
      }),
      d("venture", "㈜트루퍼스아시아", {
        asOf: "2026-05-21",
        industryName: "화장품 제조업",
        region: "서울",
        tags: ["venture", "vc_invested"],
      }),
    ];
    const first = await ingest.ingestCompanies(store, batch, { fetchedAt: AT });
    expect(first).toMatchObject({
      ambiguous: 0,
      created: 2,
      updated: 0,
      skipped: 0,
    });
    const factCount = facts.size;
    const second = await ingest.ingestCompanies(store, batch, {
      fetchedAt: AT,
    });
    expect(second).toMatchObject({ created: 0, updated: 0, factsCreated: 0 });
    expect(second.factsUpdated).toBe(factCount);
    expect(companies.size).toBe(2);
    expect(facts.size).toBe(factCount);
  });

  test("이름만 있던 회사(벤처명단)에 사업자번호 원천이 오면 같은 회사로 붙고 exact 로 올라간다", async () => {
    const { companies, store } = memoryStore();
    await ingest.ingestCompanies(
      store,
      [
        d("venture", "주식회사 그린팩", {
          industryName: "플라스틱 제품 제조업",
          region: "경기",
          tags: ["venture"],
        }),
      ],
      { fetchedAt: AT }
    );
    await ingest.ingestCompanies(
      store,
      [
        d("innobiz", "(주)그린팩", {
          businessNumber: "1278642366",
          products: "플라스틱 화장품 용기",
          region: "경기",
          tags: ["innobiz"],
        }),
      ],
      { fetchedAt: AT }
    );
    expect(companies.size).toBe(1);
    const c = [...companies.values()][0];
    expect(c).toMatchObject({
      businessNumber: "1278642366",
      industry: "manufacturing", // 이름 근거(name)가 품목 근거(products)보다 강해 유지
      industrySource: "name",
      matchConfidence: "exact",
      sources: ["innobiz", "venture"],
    });
    expect(c?.tags).toEqual(
      expect.arrayContaining(["innobiz", "venture", "b2b"])
    );
  });

  test("동명 회사가 같은 지역에 2곳이면 붙이지 않는다(ambiguous)", async () => {
    const { companies, store } = memoryStore();
    await ingest.ingestCompanies(
      store,
      [
        d("innobiz", "한빛", { businessNumber: "1111111111", region: "서울" }),
        d("mainbiz", "한빛", { businessNumber: "2222222222", region: "서울" }),
      ],
      { fetchedAt: AT }
    );
    const r = await ingest.ingestCompanies(
      store,
      [d("venture", "한빛", { region: "서울" })],
      { fetchedAt: AT }
    );
    expect(r.ambiguous).toBe(1);
    expect(companies.size).toBe(2);
  });

  test("국민연금 앞6자리로 붙이고, 달이 쌓이면 증가율을 계산한다", async () => {
    const { companies, store } = memoryStore();
    await ingest.ingestCompanies(
      store,
      [
        d("fsc", "바이오센서연구소", {
          businessNumber: "1198672928",
          region: "서울",
          employees: 20,
          asOf: "2026-06-30",
        }),
      ],
      { fetchedAt: AT }
    );
    const months = [
      ["2026-03", 10],
      ["2026-05", 11],
      ["2026-08", 13],
    ] as const;
    for (const [asOf, n] of months) {
      await ingest.ingestCompanies(
        store,
        [
          d("nps", "바이오센서연구소(주)", {
            asOf,
            bizNoPrefix: "119867",
            employees: n,
            industryName: "화장품 제조업",
            region: "서울",
          }),
        ],
        { fetchedAt: AT }
      );
    }
    expect(companies.size).toBe(1);
    const c = [...companies.values()][0];
    expect(c?.employeeGrowth).toBe(0.3);
    // 기준일 비교: fsc 2026-06-30 > nps 2026-05 였다가 nps 2026-08 이 더 최근 → 13
    expect(c?.employeeCount).toBe(13);
    expect(c?.employeeAsOf).toBe("2026-08");
    // 업종은 이름 근거로 채워짐(fsc 행엔 업종이 없었음)
    expect(c?.industry).toBe("beauty");
  });

  test("앞6자리가 다른 동명 회사는 같은 회사로 보지 않는다", async () => {
    const { companies, store } = memoryStore();
    await ingest.ingestCompanies(
      store,
      [d("innobiz", "대성", { businessNumber: "1234567890", region: "부산" })],
      { fetchedAt: AT }
    );
    await ingest.ingestCompanies(
      store,
      [
        d("nps", "대성", {
          bizNoPrefix: "999999",
          region: "부산",
          employees: 5,
        }),
      ],
      { fetchedAt: AT }
    );
    expect(companies.size).toBe(2);
  });

  test("사람이 정한 업종(manual)은 덮지 않는다 · 입점몰 주소는 도메인이 아니다", async () => {
    const { companies, facts, store } = memoryStore();
    const created = await store.create(
      {
        businessNumber: "7658601639",
        corpRegNo: null,
        dartCorpCode: null,
        domain: null,
        employeeAsOf: null,
        employeeCount: null,
        employeeGrowth: null,
        foundedYear: null,
        industry: "other",
        industryCode: null,
        industryName: null,
        industrySource: "manual",
        legalName: "더호",
        matchConfidence: "exact",
        normalizedName: "더호",
        region: "서울",
        sources: [],
        tags: [],
      },
      AT
    );
    await ingest.ingestCompanies(
      store,
      [
        d("ftc_mail_order", "더호", {
          businessNumber: "7658601639",
          homepage: "https://smartstore.naver.com/x",
          products: "건강/식품",
          region: "서울",
          tags: ["commerce"],
        }),
      ],
      { fetchedAt: AT }
    );
    const c = companies.get(created.id);
    expect(c).toMatchObject({
      domain: null,
      industry: "other",
      industrySource: "manual",
    });
    expect(c?.tags).toEqual(["b2c", "commerce"]);
    expect([...facts.values()].some((f) => f.field === "storeUrl")).toBe(true);
  });

  test("사실에는 원천·기준일·원천ID가 남고, 이름이 비면 건너뛴다", async () => {
    const { facts, store } = memoryStore();
    const r = await ingest.ingestCompanies(
      store,
      [
        d("ftc_mail_order", "(주)", {}),
        d("ftc_mail_order", "테스트몰", {
          asOf: "2026-01-05",
          businessNumber: "1234567890",
          sourceRef: "2026-서울강동-0001",
          tags: ["commerce"],
        }),
      ],
      { fetchedAt: AT }
    );
    expect(r.skipped).toBe(1);
    const legal = [...facts.values()].find((f) => f.field === "legalName");
    expect(legal).toMatchObject({
      asOf: "2026-01-05",
      source: "ftc_mail_order",
      sourceRef: "2026-서울강동-0001",
      value: "테스트몰",
    });
  });
});

describe("순수 함수", () => {
  test("증가율 — 2개 미만·첫값 0 → null, 최근 6개 시점", () => {
    expect(
      ingest.employeeGrowthFrom([{ asOf: "2026-01", value: { count: 10 } }])
    ).toBeNull();
    expect(
      ingest.employeeGrowthFrom([
        { asOf: "2026-01", value: { count: 0 } },
        { asOf: "2026-02", value: { count: 3 } },
      ])
    ).toBeNull();
    const points = Array.from({ length: 8 }, (_, i) => ({
      asOf: `2026-0${i + 1}`,
      value: { count: i + 1 },
    }));
    // 최근 6개 = 3..8 → (8-3)/3
    expect(ingest.employeeGrowthFrom(points)).toBe(1.667);
  });
  test("병합 — 새 회사는 이름·정규화 이름·출처를 갖는다", () => {
    const patch = ingest.mergeCompany(
      null,
      d("venture", "㈜트루퍼스아시아", {
        industryName: "화장품 제조업",
        tags: ["venture"],
      }),
      AT
    );
    expect(patch).toMatchObject({
      industry: "beauty",
      industrySource: "name",
      legalName: "㈜트루퍼스아시아",
      matchConfidence: "name_only",
      normalizedName: "트루퍼스아시아",
      sources: ["venture"],
    });
  });
});
