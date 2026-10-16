/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));

const db = {
  auditJob: { findUnique: vi.fn() },
  brand: { findUnique: vi.fn() },
  company: { findMany: vi.fn() },
  companyFact: { findMany: vi.fn() },
};
vi.mock("@repo/database", () => ({ database: db }));

const loadReportSource = vi.fn();
const issueClientReport = vi.fn();
vi.mock("@/lib/client-report/admin", () => ({
  bareDomain: (d: string) => d.replace(/^www\./, ""),
  issueClientReport: (...a: unknown[]) => issueClientReport(...a),
  loadReportSource: (...a: unknown[]) => loadReportSource(...a),
}));

const core = await import("@/lib/client-report/revenue-link-core");
const apply = await import("@/lib/client-report/revenue-link-apply");
const link = await import("@/lib/client-report/revenue-link");

// 체크섬을 통과하는 실제 사업자번호(공시 회사): 비나우 833-87-01017
const NUMBUZIN = "8338701017";
const JOB = "11111111-1111-4111-8111-111111111111";

describe("사업자번호 체크섬·정규화", () => {
  test("비나우 번호는 통과, 한 자리만 틀려도 걸러낸다", () => {
    expect(core.isValidBizNo(NUMBUZIN)).toBe(true);
    expect(core.isValidBizNo("8338701018")).toBe(false);
    expect(
      core.bizNumberSet(["833-87-01017", "8338701017", null, "123"])
    ).toEqual([NUMBUZIN]);
  });
});

describe("pickLatestRevenue — 최신 연도 → 연결 우선 → 공시 우선", () => {
  const row = (asOf: string, source: string, value: object) => ({
    asOf,
    source,
    sourceRef: source === "input" ? "NICE 2025" : "R1",
    value: { currency: "KRW", fiscalYear: asOf, ...value },
  });
  test("같은 해엔 연결이 별도보다, 공시가 직접 입력보다 앞선다", () => {
    const picked = core.pickLatestRevenue([
      row("2024", "opendart", {
        amount: 266,
        basis: "audit_report",
        fsDiv: "CFS",
      }),
      row("2025", "input", { amount: 999, basis: "input", fsDiv: null }),
      row("2025", "opendart", {
        amount: 316,
        basis: "audit_report",
        fsDiv: "OFS",
      }),
      row("2025", "opendart", {
        amount: 324,
        basis: "audit_report",
        fsDiv: "CFS",
      }),
    ]);
    expect(picked).toMatchObject({
      amount: 324,
      fsDiv: "CFS",
      fiscalYear: "2025",
    });
  });
  test("공시가 없으면 직접 입력(출처 문구 포함), 아무것도 없으면 null", () => {
    expect(
      core.pickLatestRevenue([
        row("2025", "input", { amount: 5, basis: "input" }),
      ])
    ).toMatchObject({ basis: "input", sourceNote: "NICE 2025" });
    expect(core.pickLatestRevenue([])).toBeNull();
  });
});

describe("buildRevenueBlock — 넘버즈인 일치 시험", () => {
  const rev = {
    amount: 324_958_207_706,
    basis: "audit_report" as const,
    currency: "KRW",
    fiscalYear: "2025",
    fsDiv: "CFS",
    receiptNo: "20260331002615",
    sourceNote: null,
  };
  test("수기 초안과 같은 숫자 + 놓치는 비율 47/56", () => {
    const b = core.buildRevenueBlock(rev, "(주)비나우", {
      accurate: 9,
      total: 56,
    });
    expect(b).toMatchObject({
      ai_routed_annual: 22_747_074_539,
      annual_revenue: 324_958_207_706,
      miss_den: 56,
      miss_num: 47,
      miss_pct: 84,
      missed_monthly: 1_590_941_225,
      monthly: 1_895_589_545,
    });
  });
  test("판별이 없으면 놓치는 비율을 만들지 않는다", () => {
    const b = core.buildRevenueBlock(rev, "(주)비나우", null);
    expect(b?.miss_pct).toBeUndefined();
    expect(b?.missed_annual).toBeUndefined();
    expect(b?.miss_den).toBeUndefined();
  });
  test("applyRevenueBlock 은 copy.revenue_opportunity 만 바꾼다", () => {
    const block = core.buildRevenueBlock(rev, "(주)비나우", null);
    if (!block) {
      throw new Error("block");
    }
    const out = apply.applyRevenueBlock(
      JSON.stringify({
        copy: { keep: "그대로", revenue_opportunity: { old: 1 } },
        status: "approved",
      }),
      block
    );
    const parsed = JSON.parse(out ?? "{}");
    expect(parsed.status).toBe("approved");
    expect(parsed.copy.keep).toBe("그대로");
    expect(parsed.copy.revenue_opportunity.annual_revenue).toBe(
      324_958_207_706
    );
    expect(apply.applyRevenueBlock("not json", block)).toBeNull();
    expect(apply.applyRevenueBlock("[1]", block)).toBeNull();
  });
  test("기존 수기 값과 비교표: 같은 칸은 same, 다른 칸은 표시", () => {
    const block = core.buildRevenueBlock(rev, "(주)비나우", {
      accurate: 9,
      total: 56,
    });
    if (!block) {
      throw new Error("block");
    }
    const diff = core.diffRevenueBlocks(
      {
        ai_routed_annual: 22_747_074_539,
        annual_revenue: 1,
        missed_annual: 19_091_294_703,
      },
      block
    );
    const by = Object.fromEntries(diff.map((d) => [d.field, d]));
    expect(by["AI 경유 매출(연, 원)"]?.same).toBe(true);
    expect(by["연매출(원)"]?.same).toBe(false);
    expect(by["놓치는 매출(연, 원)"]?.same).toBe(false); // 1원 차이도 보여 준다
  });
});

describe("previewRevenueLink — 연결 규칙", () => {
  const company = (id: string, bn: string | null, domain: string | null) => ({
    businessNumber: bn,
    domain,
    id,
    legalName: `회사-${id}`,
  });
  beforeEach(() => {
    vi.clearAllMocks();
    loadReportSource.mockResolvedValue({
      job: { brandId: null, organizationId: null },
      ok: true,
      source: {
        identity: {
          identityGrounded: true,
          officialSite: { businessNumber: "833-87-01017" },
        },
      },
    });
    db.auditJob.findUnique.mockResolvedValue({
      brandId: "b1",
      domain: "www.numbuzin.com",
    });
    db.brand.findUnique.mockResolvedValue({ businessNumber: null });
    db.companyFact.findMany.mockResolvedValue([
      {
        asOf: "2025",
        source: "opendart",
        sourceRef: "20260331002615",
        value: {
          amount: 324_958_207_706,
          basis: "audit_report",
          currency: "KRW",
          fiscalYear: "2025",
          fsDiv: "CFS",
          receiptNo: "20260331002615",
        },
      },
    ]);
  });

  test("번호 하나 + 같은 번호의 회사 하나 → 자동 확정, 미리보기까지", async () => {
    db.company.findMany.mockResolvedValue([
      company("c1", NUMBUZIN, "numbuzin.com"),
    ]);
    const out = await link.previewRevenueLink({ auditJobId: JOB });
    expect(out.state).toBe("ready");
    if (out.state === "ready") {
      expect(out.company.matchedBy).toBe("business_number");
      expect(out.block.annual_revenue).toBe(324_958_207_706);
      expect(out.accuracyNote).toBe("no_review");
    }
  });

  test("번호가 없고 도메인으로만 찾으면 자동 확정하지 않고 후보 목록", async () => {
    loadReportSource.mockResolvedValue({
      ok: true,
      source: { identity: { officialSite: null } },
    });
    db.company.findMany.mockResolvedValue([
      company("c1", null, "numbuzin.com"),
    ]);
    const out = await link.previewRevenueLink({ auditJobId: JOB });
    expect(out).toMatchObject({ reason: "no_number", state: "choose" });
  });

  test("번호가 둘이면 후보 목록(자동 선택 안 함)", async () => {
    db.brand.findUnique.mockResolvedValue({ businessNumber: "119-86-72928" });
    db.company.findMany.mockResolvedValue([
      company("c1", NUMBUZIN, "numbuzin.com"),
      company("c2", "1198672928", null),
    ]);
    const out = await link.previewRevenueLink({ auditJobId: JOB });
    expect(out).toMatchObject({ reason: "many_numbers", state: "choose" });
  });

  test("사람이 고른 회사는 후보 안에서만 허용 — 임의 ID는 no_company", async () => {
    db.company.findMany.mockResolvedValue([
      company("c1", NUMBUZIN, "numbuzin.com"),
    ]);
    const out = await link.previewRevenueLink({
      auditJobId: JOB,
      companyId: "99999999-9999-4999-8999-999999999999",
    });
    expect(out.state).toBe("no_company");
  });

  test("카드에 회사도 매출도 없으면 숫자를 만들지 않는다", async () => {
    db.company.findMany.mockResolvedValue([]);
    expect((await link.previewRevenueLink({ auditJobId: JOB })).state).toBe(
      "no_company"
    );
    db.company.findMany.mockResolvedValue([company("c1", NUMBUZIN, null)]);
    db.companyFact.findMany.mockResolvedValue([]);
    expect((await link.previewRevenueLink({ auditJobId: JOB })).state).toBe(
      "no_revenue"
    );
  });

  test("승인된 판별이 통과하면 그 ok_n/n 으로 놓치는 비율을 계산, 거부되면 계산 안 함", async () => {
    db.company.findMany.mockResolvedValue([company("c1", NUMBUZIN, null)]);
    issueClientReport.mockResolvedValue({
      data: { computed: { s: { n: 56, ok_n: 9 } } },
      kind: "preview",
    });
    const ok = await link.previewRevenueLink({
      auditJobId: JOB,
      review: { copy: {} },
    });
    expect(ok.state === "ready" && ok.block.miss_num).toBe(47);
    issueClientReport.mockResolvedValue({ errors: [], kind: "review_error" });
    const bad = await link.previewRevenueLink({
      auditJobId: JOB,
      review: { copy: {} },
    });
    expect(bad.state === "ready" && bad.accuracyNote).toBe("review_rejected");
    expect(bad.state === "ready" && bad.block.missed_annual).toBeUndefined();
  });

  test("읽기 전용 — DB 쓰기 호출이 없다", () => {
    const src = readFileSync(
      join(process.cwd(), "lib/client-report/revenue-link.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/\.(create|update|upsert|delete)(Many)?\(/);
  });
});

describe("API 게이트", () => {
  test("관리자 전용이고 쓰기 호출이 없다", () => {
    const src = readFileSync(
      join(process.cwd(), "app/api/admin/client-reports/revenue/route.ts"),
      "utf8"
    );
    expect(src).toContain("await requireAdmin()");
    expect(src).toContain("status: 403");
    expect(src).not.toMatch(/database\./);
  });
});
