/**
 * 자동 재측정 cron 의 "유료" 판정은 화면 게이트(getCurrentPlan → resolveEffectivePlan)와 같아야 한다.
 *
 * 결제 권한은 Clerk publicMetadata.plan + 비공개 결제 출처(findablePaymentId)에만 기록되고
 * Organization.plan 에는 쓰이지 않는다. cron 이 DB plan 만 보면 돈을 낸 고객이 자동 측정에서 빠진다.
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeOrg {
  brands: Array<{
    domain: string;
    entityVariants: unknown;
    id: string;
    name: string;
  }>;
  id: string;
  ownerId: string;
  plan: string;
  planExpiresAt: Date | null;
  users: Array<{ id: string }>;
}

interface FakeClerkUser {
  id: string;
  privateMetadata: Record<string, unknown>;
  publicMetadata: Record<string, unknown>;
}

const state = vi.hoisted(() => ({
  orgs: [] as FakeOrg[],
  clerkUsers: [] as FakeClerkUser[],
  inviteUserIds: [] as string[],
  approvedPartnerIds: [] as string[],
  clerkFails: false,
}));

const mocks = vi.hoisted(() => ({
  runAuditJob: vi.fn(),
  getUserList: vi.fn(),
  auditJobCreate: vi.fn(),
}));

/** Prisma where 의 이 테스트가 쓰는 부분만 흉내 낸다(필터를 무시하면 RED 가 거짓이 된다). */
function matchesOrgWhere(org: FakeOrg, where: Record<string, unknown>) {
  const plan = where.plan as { in?: string[] } | undefined;
  if (plan?.in && !plan.in.includes(org.plan)) {
    return false;
  }
  const brands = where.brands as { some?: unknown } | undefined;
  if (brands?.some !== undefined && org.brands.length === 0) {
    return false;
  }
  return true;
}

vi.mock("@repo/database", () => ({
  database: {
    organization: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async (args: { where?: Record<string, unknown> }) =>
        state.orgs.filter((org) => matchesOrgWhere(org, args.where ?? {}))
      ),
      findUnique: vi.fn(async () => null),
    },
    auditJob: {
      // 측정 이력 없음 → 모든 브랜드가 즉시 대상. 진행 중/최근 실패도 없음.
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: mocks.auditJobCreate,
      findUnique: vi.fn(async () => ({ status: "completed" })),
    },
    inviteRedemption: {
      findMany: vi.fn(async () =>
        state.inviteUserIds.map((userId) => ({ userId }))
      ),
    },
    partnerApplication: {
      findMany: vi.fn(async () =>
        state.approvedPartnerIds.map((userId) => ({ userId }))
      ),
    },
    user: { findUnique: vi.fn(async () => null) },
  },
}));

vi.mock("@repo/auth/server", () => ({
  clerkClient: vi.fn(async () => ({
    users: { getUserList: mocks.getUserList },
  })),
}));

vi.mock("@repo/audit/runner", () => ({ runAuditJob: mocks.runAuditJob }));
vi.mock("@repo/email", () => ({ resend: null }));
vi.mock("@repo/email/templates/tracking-digest", () => ({
  TrackingDigestEmail: vi.fn(),
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@repo/security/cron", () => ({ denyIfNotCron: () => null }));
vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/lib/billing/renewal-grace", () => ({
  expireLapsedRenewalGrants: vi.fn(async () => ({
    expired: 0,
    scanned: 0,
    failed: 0,
  })),
}));
vi.mock("@/lib/billing/period-end-expiry", () => ({
  expireCancelledSubscriptions: vi.fn(async () => ({
    expired: 0,
    scanned: 0,
    failed: 0,
  })),
  expireOneOffPaymentGrants: vi.fn(async () => ({
    expired: 0,
    scanned: 0,
    failed: 0,
  })),
}));

const { GET } = await import("../app/api/cron/auto-refresh-tracking/route");

const OWNER = "user_owner";
const brand = {
  domain: "acme.co.kr",
  entityVariants: [],
  id: "brand_1",
  name: "Acme",
};

function org(overrides: Partial<FakeOrg> = {}): FakeOrg {
  return {
    id: "org_1",
    ownerId: OWNER,
    plan: "free",
    planExpiresAt: null,
    users: [{ id: OWNER }],
    brands: [brand],
    ...overrides,
  };
}

/** 실제 grantPlanFromPayment 결과 형태(현재 결제 출처가 비공개 메타데이터에 있다). */
function payingUser(plan: string, id = OWNER): FakeClerkUser {
  return {
    id,
    publicMetadata: { plan },
    privateMetadata: {
      findablePaymentId: `fdbl-${plan}-x-1`,
      findablePaymentGrantStack: [
        { paymentId: `fdbl-${plan}-x-1`, plan },
        { paymentId: null, plan: "free" },
      ],
    },
  };
}

async function runCron() {
  const response = await GET(
    new Request("https://app.test/api/cron/auto-refresh-tracking") as never
  );
  return (await response.json()) as { dueCount: number; triggered: number };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FINDABLE_AUTO_MEASUREMENT_ENABLED = "true";
  state.orgs = [];
  state.clerkUsers = [];
  state.inviteUserIds = [];
  state.approvedPartnerIds = [];
  state.clerkFails = false;
  mocks.auditJobCreate.mockResolvedValue({ id: "job_1" });
  mocks.runAuditJob.mockResolvedValue(undefined);
  mocks.getUserList.mockImplementation((params: { userId?: string[] }) => {
    if (state.clerkFails) {
      return Promise.reject(new Error("clerk down"));
    }
    const data = state.clerkUsers.filter((u) =>
      (params.userId ?? []).includes(u.id)
    );
    return Promise.resolve({ data, totalCount: data.length });
  });
});

describe("자동 재측정 cron — 유료 판정", () => {
  it("🔴 결제한 고객(Clerk growth + 결제 출처)은 DB plan 이 free 여도 측정된다", async () => {
    state.orgs = [org()];
    state.clerkUsers = [payingUser("growth")];

    const result = await runCron();

    expect(result.dueCount).toBe(1);
    expect(mocks.runAuditJob).toHaveBeenCalledTimes(1);
    expect(mocks.runAuditJob.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org_1",
      brandId: "brand_1",
    });
  });

  it("past_due(유예 중)는 결제 출처가 남아 있으므로 계속 측정한다", async () => {
    // 유예 중에는 expireLapsedRenewalGrants 가 Clerk 출처를 지우지 않는다.
    state.orgs = [org()];
    state.clerkUsers = [payingUser("starter")];

    const result = await runCron();

    expect(result.dueCount).toBe(1);
    expect(mocks.runAuditJob).toHaveBeenCalledTimes(1);
  });

  it("유예 만료(expired) 뒤에는 Clerk 가 free 로 내려가 측정하지 않는다", async () => {
    // expirePaymentGrants 결과 형태: plan=free, 결제 출처 비움.
    state.orgs = [org()];
    state.clerkUsers = [
      {
        id: OWNER,
        publicMetadata: { plan: "free" },
        privateMetadata: {
          findablePaymentId: null,
          findablePaymentGrantStack: null,
        },
      },
    ];

    const result = await runCron();

    expect(result.dueCount).toBe(0);
    expect(mocks.runAuditJob).not.toHaveBeenCalled();
  });

  it("초대 이력이 있고 결제 출처가 없으면 남은 Clerk 캐시만으로는 측정하지 않는다", async () => {
    state.orgs = [org()];
    state.clerkUsers = [
      { id: OWNER, publicMetadata: { plan: "growth" }, privateMetadata: {} },
    ];
    state.inviteUserIds = [OWNER];

    const result = await runCron();

    expect(result.dueCount).toBe(0);
    expect(mocks.runAuditJob).not.toHaveBeenCalled();
  });

  it("관리자 기간 부여(DB growth, 만료 전)는 Clerk 가 free 여도 측정한다", async () => {
    state.orgs = [
      org({
        plan: "growth",
        planExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      }),
    ];
    state.clerkUsers = [
      { id: OWNER, publicMetadata: { plan: "free" }, privateMetadata: {} },
    ];

    const result = await runCron();

    expect(result.dueCount).toBe(1);
    expect(mocks.runAuditJob).toHaveBeenCalledTimes(1);
  });

  it("승인 파트너(DB approved)는 growth 로 측정한다", async () => {
    state.orgs = [org()];
    state.clerkUsers = [
      { id: OWNER, publicMetadata: { plan: "free" }, privateMetadata: {} },
    ];
    state.approvedPartnerIds = [OWNER];

    const result = await runCron();

    expect(result.dueCount).toBe(1);
  });

  it("무료 조직은 측정하지 않는다", async () => {
    state.orgs = [org()];
    state.clerkUsers = [{ id: OWNER, publicMetadata: {}, privateMetadata: {} }];

    const result = await runCron();

    expect(result.dueCount).toBe(0);
    expect(mocks.runAuditJob).not.toHaveBeenCalled();
  });

  it("Clerk 조회가 실패하면 DB 권한만으로 판정한다(원가 쪽으로 열지 않는다)", async () => {
    state.orgs = [
      org(),
      org({
        id: "org_2",
        ownerId: "user_2",
        users: [],
        plan: "growth",
        brands: [{ ...brand, id: "brand_2", domain: "b.co.kr" }],
      }),
    ];
    state.clerkUsers = [payingUser("growth")];
    state.clerkFails = true;

    const result = await runCron();

    expect(result.dueCount).toBe(1);
    expect(mocks.runAuditJob.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org_2",
    });
  });

  it("유료 조직이 늘어도 한 실행에서 한 브랜드만 측정한다(기존 상한 유지)", async () => {
    state.orgs = [
      org(),
      org({
        id: "org_2",
        ownerId: "user_2",
        users: [{ id: "user_2" }],
        brands: [{ ...brand, id: "brand_2", domain: "b.co.kr" }],
      }),
    ];
    state.clerkUsers = [payingUser("growth"), payingUser("scale", "user_2")];

    const result = await runCron();

    expect(result.dueCount).toBe(2);
    expect(mocks.runAuditJob).toHaveBeenCalledTimes(1);
  });
});

describe("자동 측정 전체 스위치", () => {
  it("스위치가 꺼져 있으면 결제한 조직도 측정하지 않는다(기본값)", async () => {
    // biome-ignore lint/performance/noDelete: the switch reads absence as "off".
    delete process.env.FINDABLE_AUTO_MEASUREMENT_ENABLED;
    state.orgs = [org()];
    state.clerkUsers = [payingUser("growth")];

    const result = await runCron();

    expect(result).toMatchObject({ dueCount: 0, triggered: 0 });
    expect(mocks.runAuditJob).not.toHaveBeenCalled();
    expect(mocks.auditJobCreate).not.toHaveBeenCalled();
    // Billing safety still runs while measurement is paused.
    const { expireLapsedRenewalGrants } = await import(
      "@/lib/billing/renewal-grace"
    );
    const { expireCancelledSubscriptions, expireOneOffPaymentGrants } =
      await import("@/lib/billing/period-end-expiry");
    expect(expireLapsedRenewalGrants).toHaveBeenCalledTimes(1);
    expect(expireCancelledSubscriptions).toHaveBeenCalledTimes(1);
    expect(expireOneOffPaymentGrants).toHaveBeenCalledTimes(1);
  });

  it('"true"가 아닌 값은 꺼짐으로 본다', async () => {
    process.env.FINDABLE_AUTO_MEASUREMENT_ENABLED = "1";
    state.orgs = [org()];
    state.clerkUsers = [payingUser("growth")];

    await runCron();

    expect(mocks.runAuditJob).not.toHaveBeenCalled();
  });
});
