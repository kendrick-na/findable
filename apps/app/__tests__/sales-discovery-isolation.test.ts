/** @vitest-environment node */
/**
 * 🔴 영업 화면 ↔ 고객 측정 섞임 차단(독립 검수 P0-1, 2026-10-07).
 *
 * 같은 도메인을 고객사가 이미 측정·리포트 발행했어도, 「회사 찾기」는 그걸 영업 대상 측정으로 쓰면 안 된다.
 *   - 단계 자동 이동: 고객 회차로 found → measured/reported 가 되면 안 된다.
 *   - 회사 카드: 고객 브랜드·고객 회차·고객 리포트가 [측정]/[리포트] 버튼에 나오면 안 된다.
 * 영업 전용 내부 조직(SALES_INTERNAL_ORG_ID)의 브랜드·측정·리포트만 쓴다.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const SALES = "f1dab1e0-5a1e-4000-8000-00000000a001";
const REPORT_CUSTOMER = `https://www.findable.co.kr/r/${"C".repeat(43)}`;
const REPORT_SALES = `https://www.findable.co.kr/r/${"S".repeat(43)}`;

type Row = Record<string, unknown>;

/** 아주 작은 where 판정기 — 이 테스트가 쓰는 연산자만. 모르는 연산자는 던진다(조용히 통과 금지). */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) {
    return true;
  }
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") {
      return (cond as Row[]).some((w) => matches(row, w));
    }
    if (key === "AND") {
      return (cond as Row[]).every((w) => matches(row, w));
    }
    const value = row[key];
    if (cond === null || typeof cond !== "object" || cond instanceof Date) {
      return value === cond;
    }
    const c = cond as Row;
    if ("in" in c) {
      return (c.in as unknown[]).includes(value);
    }
    if ("notIn" in c) {
      return value !== null && !(c.notIn as unknown[]).includes(value);
    }
    if ("not" in c) {
      return value !== c.not;
    }
    throw new Error(`unsupported where: ${key}`);
  });
}

const tables = {
  auditJob: [] as Row[],
  brand: [] as Row[],
  salesLead: [] as Row[],
};
const updates: Row[] = [];

const db = {
  auditJob: {
    findFirst: vi.fn((args: { where?: Row }) =>
      Promise.resolve(
        tables.auditJob
          .filter((r) => matches(r, args.where))
          .sort(
            (a, b) =>
              (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime()
          )[0] ?? null
      )
    ),
    findMany: vi.fn((args: { where?: Row }) =>
      Promise.resolve(tables.auditJob.filter((r) => matches(r, args.where)))
    ),
  },
  brand: {
    findFirst: vi.fn((args: { where?: Row }) =>
      Promise.resolve(tables.brand.find((r) => matches(r, args.where)) ?? null)
    ),
  },
  company: {
    findUnique: vi.fn(() =>
      Promise.resolve({
        businessNumber: null,
        contacts: [],
        corpRegNo: null,
        dartCorpCode: null,
        domain: "both.example",
        employeeAsOf: null,
        employeeCount: null,
        employeeGrowth: null,
        facts: [],
        foundedYear: null,
        id: "11111111-1111-4111-8111-111111111111",
        industry: null,
        industryCode: null,
        industryName: null,
        industrySource: null,
        leads: [{ id: "lead-1", reportUrl: null, status: "found" }],
        legalName: "예시상사",
        matchConfidence: "exact",
        region: null,
        sources: [],
        tags: [],
      })
    ),
  },
  salesLead: {
    findMany: vi.fn(() => Promise.resolve(tables.salesLead)),
    update: vi.fn((args: Row) => {
      updates.push(args);
      return Promise.resolve({});
    }),
    updateMany: vi.fn((args: Row) => {
      updates.push(args);
      return Promise.resolve({ count: 1 });
    }),
  },
};
vi.mock("@repo/database", () => ({ database: db }));

let issued: Row[] = [];
vi.mock("@/lib/client-report/admin", () => ({
  approvedReportUrlByDomain: (views: Row[]) =>
    new Map(
      views
        .filter((v) => v.state === "live" && v.url && v.sendApproval)
        .map((v) => [String(v.domain), String(v.url)])
    ),
  bareDomain: (d: string) => d.toLowerCase().replace(/^www\./, ""),
  listIssuedReports: () => Promise.resolve(issued),
}));

const screen = await import("@/lib/ax-mail/discovery/screen");

function customerFixtures() {
  tables.brand = [
    {
      createdAt: new Date("2026-01-01"),
      domain: "both.example",
      id: "brand-customer",
      name: "고객 브랜드",
      organizationId: "org_customer",
    },
  ];
  tables.auditJob = [
    {
      brandId: "brand-customer",
      createdAt: new Date("2026-10-01"),
      domain: "both.example",
      email: "org:org_customer",
      id: "job-customer",
      organizationId: "org_customer",
      status: "completed",
    },
    {
      // 무료 진단(조직 없음)도 영업 측정이 아니다
      brandId: null,
      createdAt: new Date("2026-10-02"),
      domain: "both.example",
      email: "someone@example.com",
      id: "job-free",
      organizationId: null,
      status: "completed",
    },
  ];
  issued = [
    {
      auditJobId: "job-customer",
      domain: "both.example",
      issuedAt: "2026-10-03T00:00:00Z",
      sendApproval: { approvedAt: "2026-10-03T00:00:00Z" },
      state: "live",
      url: REPORT_CUSTOMER,
      version: 1,
    },
  ];
  tables.salesLead = [
    { company: { domain: "both.example" }, id: "lead-1", status: "found" },
  ];
}

beforeEach(() => {
  updates.length = 0;
  for (const group of Object.values(db)) {
    for (const fn of Object.values(group)) {
      fn.mockClear();
    }
  }
  customerFixtures();
});

describe("고객사 측정·리포트는 영업 단계·카드에 쓰지 않는다", () => {
  test("같은 도메인 고객 측정·발송 승인 리포트가 있어도 found 그대로", async () => {
    const moved = await screen.syncStagesForScreen(
      "https://www.findable.co.kr"
    );
    expect(moved).toEqual({ measured: 0, reported: 0 });
    expect(updates).toEqual([]);
  });

  test("카드에 고객 브랜드·고객 회차·고객 리포트가 나오지 않는다", async () => {
    const card = await screen.loadCompanyCard(
      "11111111-1111-4111-8111-111111111111",
      "https://www.findable.co.kr"
    );
    expect(card?.brand).toBeNull();
    expect(card?.lastJob).toBeNull();
    expect(card?.reportUrl).toBeNull();
  });
});

describe("영업 내부 조직의 측정·리포트만 쓴다", () => {
  beforeEach(() => {
    tables.brand.push({
      createdAt: new Date("2026-10-05"),
      domain: "both.example",
      id: "brand-sales",
      name: "예시상사",
      organizationId: SALES,
    });
    tables.auditJob.push({
      brandId: "brand-sales",
      createdAt: new Date("2026-10-06"),
      domain: "both.example",
      email: `org:${SALES}`,
      id: "job-sales",
      organizationId: SALES,
      status: "completed",
    });
  });

  test("영업 측정 완료 → measured", async () => {
    const moved = await screen.syncStagesForScreen(
      "https://www.findable.co.kr"
    );
    expect(moved).toEqual({ measured: 1, reported: 0 });
  });

  test("영업 회차로 발행·승인된 리포트 → reported", async () => {
    issued.push({
      auditJobId: "job-sales",
      domain: "both.example",
      issuedAt: "2026-10-06T00:00:00Z",
      sendApproval: { approvedAt: "2026-10-06T00:00:00Z" },
      state: "live",
      url: REPORT_SALES,
      version: 1,
    });
    const moved = await screen.syncStagesForScreen(
      "https://www.findable.co.kr"
    );
    expect(moved).toEqual({ measured: 0, reported: 1 });
    expect(updates[0]).toMatchObject({
      data: { reportUrl: REPORT_SALES, status: "reported" },
    });
  });

  test("카드는 영업 브랜드·영업 회차·영업 리포트만", async () => {
    issued.push({
      auditJobId: "job-sales",
      domain: "both.example",
      issuedAt: "2026-10-06T00:00:00Z",
      sendApproval: { approvedAt: "2026-10-06T00:00:00Z" },
      state: "live",
      url: REPORT_SALES,
      version: 1,
    });
    const card = await screen.loadCompanyCard(
      "11111111-1111-4111-8111-111111111111",
      "https://www.findable.co.kr"
    );
    expect(card?.brand?.id).toBe("brand-sales");
    expect(card?.lastJob?.id).toBe("job-sales");
    expect(card?.reportUrl).toBe(REPORT_SALES);
  });
});
