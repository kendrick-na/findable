/** @vitest-environment node */
/**
 * 내부 조직(영업 전용 — packages/database/internal-orgs.ts)이 고객용 자동 작업에 걸리지 않는가 — 2026-10-07.
 *
 * 🔴 걸리면 생기는 일: 정기 자동 측정으로 영업 브랜드가 매일 재측정(원가), 결제·요금제 만료 스캔·안내 메일 대상,
 *   관리자 고객 목록·통계에 「고객」으로 섞임.
 *
 * 전수 확인(grep: organization.findMany/count/updateMany · brand.findMany/count · apps/web/app/api/cron/* ·
 *   apps/app/app/api/cron/* · apps/app/app/webhooks/*) 결과 중 **조직·브랜드를 고르는 곳**을 아래 표로 묶는다.
 *   여기 있는 파일은 모두 internal-orgs 의 제외 조각을 where 에 넣어야 한다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = {
  brand: { create: vi.fn(), findFirst: vi.fn() },
  organization: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
};
vi.mock("@repo/database", () => ({ database: db }));

const internal = await import("@repo/database/internal-orgs");

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** [파일(apps/app 기준), 반드시 들어 있어야 하는 제외 조각, 무엇을 막나] */
const GUARDED: [string, string, string][] = [
  [
    "lib/billing/auto-refresh-eligibility.ts",
    "...notInternalOrg",
    "정기 자동 측정(30분 크론) 대상 조직 + 측정 알림 메일",
  ],
  [
    "app/api/cron/auto-refresh-tracking/route.ts",
    "...notInternalOrg",
    "기간제 요금제 만료 강등",
  ],
  [
    "lib/billing/renewal-notice.ts",
    "...notInternalOrg",
    "정기결제 갱신 안내 메일",
  ],
  ["lib/billing/renewal-grace.ts", "...notInternalOrg", "갱신 실패 유예 만료"],
  [
    "lib/billing/period-end-expiry.ts",
    "...notInternalOrg",
    "해지·1회 결제 기간 만료",
  ],
  [
    "app/actions/admin/orgs.ts",
    "where: notInternalOrg",
    "관리자 고객(가입 조직) 목록·요금제 지표",
  ],
  [
    "app/actions/admin/billing.ts",
    "...notInternalOrg",
    "관리자 결제 멈춤 목록",
  ],
  [
    "app/(authenticated)/admin/ops/page.tsx",
    "brandNotInInternalOrg",
    "관리자 운영 통계의 브랜드 수",
  ],
  [
    "../../packages/audit/aeo-google-aio-pilot.ts",
    "...brandNotInInternalOrg",
    "Google AI 개요 정기 파일럿(크론) 브랜드",
  ],
];

describe("내부 조직 상수", () => {
  test("고정 id · 이름 · 제외 조각", () => {
    expect(internal.SALES_INTERNAL_ORG_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(internal.SALES_INTERNAL_ORG_NAME).toBe("Findable 영업(내부)");
    expect(internal.isInternalOrgId(internal.SALES_INTERNAL_ORG_ID)).toBe(true);
    expect(internal.isInternalOrgId("org_abc")).toBe(false);
    expect(internal.notInternalOrg).toEqual({
      id: { notIn: [internal.SALES_INTERNAL_ORG_ID] },
    });
    expect(internal.brandNotInInternalOrg).toEqual({
      organizationId: { notIn: [internal.SALES_INTERNAL_ORG_ID] },
    });
  });
});

describe("고객용 자동 작업·목록에서 내부 조직을 뺀다", () => {
  test.each(GUARDED)("%s — %s (%s)", (file, piece) => {
    const source = read(file);
    expect(source).toContain('from "@repo/database/internal-orgs"');
    expect(source).toContain(piece);
  });

  test("기간 만료 강등 updateMany 에 제외 조각이 붙어 있다(다른 updateMany 와 헷갈리지 않게)", () => {
    const source = read("app/api/cron/auto-refresh-tracking/route.ts");
    const at = source.indexOf("database.organization.updateMany({");
    expect(source.slice(at, at + 200)).toContain("...notInternalOrg");
  });

  test("기간 만료·결제 스캔 findMany 가 모두 제외 조각을 갖는다", () => {
    for (const file of [
      "lib/billing/period-end-expiry.ts",
      "lib/billing/renewal-grace.ts",
      "lib/billing/renewal-notice.ts",
      "lib/billing/auto-refresh-eligibility.ts",
    ]) {
      const source = read(file);
      const finds = source.split("database.organization.findMany({").slice(1);
      expect(finds.length, file).toBeGreaterThan(0);
      for (const chunk of finds) {
        expect(chunk.slice(0, 260), file).toMatch(/notInternalOrg/);
      }
    }
  });

  test("정기 자동 측정 대상 조회에 실제로 제외 조건이 들어간다", async () => {
    db.organization.findMany.mockResolvedValue([]);
    const { loadAutoRefreshOrganizations } = await import(
      "@/lib/billing/auto-refresh-eligibility"
    );
    await loadAutoRefreshOrganizations(new Date("2026-10-07T00:00:00Z"), "all");
    expect(db.organization.findMany.mock.calls[0][0].where).toMatchObject({
      id: { notIn: [internal.SALES_INTERNAL_ORG_ID] },
    });
  });
});

describe("영업 내부 조직 find-or-create (Clerk 없음)", () => {
  beforeEach(() => {
    for (const group of Object.values(db)) {
      for (const fn of Object.values(group)) {
        fn.mockReset();
      }
    }
  });

  test("없으면 고정 id·이름·누른 관리자 ownerId 로 만든다", async () => {
    db.organization.findUnique.mockResolvedValue(null);
    db.organization.upsert.mockResolvedValue({});
    const { ensureSalesOrg } = await import(
      "@/lib/ax-mail/discovery/sales-org"
    );
    expect(await ensureSalesOrg("user_admin1")).toBe(
      internal.SALES_INTERNAL_ORG_ID
    );
    expect(db.organization.upsert.mock.calls[0][0]).toEqual({
      create: {
        id: internal.SALES_INTERNAL_ORG_ID,
        name: internal.SALES_INTERNAL_ORG_NAME,
        ownerId: "user_admin1",
      },
      update: {},
      where: { id: internal.SALES_INTERNAL_ORG_ID },
    });
  });

  test("있으면 그대로(ownerId 를 덮지 않는다)", async () => {
    db.organization.findUnique.mockResolvedValue({
      id: internal.SALES_INTERNAL_ORG_ID,
    });
    const { ensureSalesOrg } = await import(
      "@/lib/ax-mail/discovery/sales-org"
    );
    expect(await ensureSalesOrg("user_admin2")).toBe(
      internal.SALES_INTERNAL_ORG_ID
    );
    expect(db.organization.upsert).not.toHaveBeenCalled();
  });

  test("브랜드는 내부 조직 안에서만 찾고 없으면 만든다", async () => {
    db.brand.findFirst.mockResolvedValue(null);
    db.brand.create.mockResolvedValue({ id: "b1" });
    const { ensureSalesBrand } = await import(
      "@/lib/ax-mail/discovery/sales-org"
    );
    expect(
      await ensureSalesBrand({
        domain: "example.com",
        industry: null,
        name: "예시",
        orgId: internal.SALES_INTERNAL_ORG_ID,
      })
    ).toEqual({ created: true, id: "b1" });
    expect(db.brand.findFirst.mock.calls[0][0].where).toEqual({
      domain: "example.com",
      organizationId: internal.SALES_INTERNAL_ORG_ID,
    });
  });
});
