/**
 * Automatic measurement scope (2026-10-05 owner decision).
 *
 * `FINDABLE_AUTO_MEASUREMENT_SCOPE`:
 *   - "paid" (default when unset): only organizations whose plan comes from an
 *     actual payment (Clerk payment provenance, inside its paid period or the
 *     7-day renewal grace). Cadence and brand quota follow the paid plan.
 *   - "all": the previous behaviour (every effective paid plan, incl. admin,
 *     invite and partner grants).
 *   - "off": nothing is measured; payment-expiry steps still run.
 * Legacy `FINDABLE_AUTO_MEASUREMENT_ENABLED=true` with no scope → "all".
 *
 * @vitest-environment node
 */

import {
  type MemberPlanSignal,
  PLANS,
  resolveOrganizationPlan,
  resolveOrganizationPlanWithSource,
} from "@repo/auth/plan";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeBrand {
  createdAt: Date;
  domain: string;
  entityVariants: unknown;
  id: string;
  name: string;
}

interface FakeOrg {
  billingNextPaymentAt: Date | null;
  billingStatus: string;
  brands: FakeBrand[];
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

const NOW = new Date("2026-10-05T03:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const state = vi.hoisted(() => ({
  orgs: [] as FakeOrg[],
  clerkUsers: [] as FakeClerkUser[],
  inviteUserIds: [] as string[],
  approvedPartnerIds: [] as string[],
  // `${orgId}|${domain}` → last attempt time
  lastMeasured: new Map<string, Date>(),
}));

const mocks = vi.hoisted(() => ({
  runAuditJob: vi.fn(),
  getUserList: vi.fn(),
  auditJobCreate: vi.fn(),
  expireLapsedRenewalGrants: vi.fn(),
  expireCancelledSubscriptions: vi.fn(),
  expireOneOffPaymentGrants: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  database: {
    organization: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async (args: { where?: Record<string, unknown> }) =>
        state.orgs.filter((org) => {
          const brands = args.where?.brands as { some?: unknown } | undefined;
          return !(brands?.some !== undefined && org.brands.length === 0);
        })
      ),
      findUnique: vi.fn(async () => null),
    },
    auditJob: {
      findFirst: vi.fn(
        (args: {
          where: { email: string; domain: string; status?: unknown };
        }) => {
          if (args.where.status) {
            return Promise.resolve(null); // nothing in flight
          }
          const orgId = args.where.email.replace("org:", "");
          const at = state.lastMeasured.get(`${orgId}|${args.where.domain}`);
          return Promise.resolve(
            at ? { completedAt: at, createdAt: at } : null
          );
        }
      ),
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
  expireLapsedRenewalGrants: mocks.expireLapsedRenewalGrants,
}));
vi.mock("@/lib/billing/period-end-expiry", () => ({
  expireCancelledSubscriptions: mocks.expireCancelledSubscriptions,
  expireOneOffPaymentGrants: mocks.expireOneOffPaymentGrants,
}));

const { GET, autoMeasurementScope } = await import(
  "../app/api/cron/auto-refresh-tracking/route"
);

const OWNER = "user_owner";

function brand(n: number, createdDaysAgo = 100 - n): FakeBrand {
  return {
    id: `brand_${n}`,
    name: `Brand ${n}`,
    domain: `b${n}.co.kr`,
    entityVariants: [],
    createdAt: new Date(NOW.getTime() - createdDaysAgo * DAY_MS),
  };
}

function org(overrides: Partial<FakeOrg> = {}): FakeOrg {
  return {
    id: "org_1",
    ownerId: OWNER,
    plan: "free",
    planExpiresAt: null,
    billingStatus: "trialing",
    billingNextPaymentAt: null,
    users: [{ id: OWNER }],
    brands: [brand(1)],
    ...overrides,
  };
}

/** Same shape as `buildPaymentId`: fdbl-{plan}-{uid}-{base36 issued ms}. */
function paymentId(plan: string, userId: string, issuedDaysAgo: number) {
  const uid = userId.replace(/^user_/, "");
  const issued = NOW.getTime() - issuedDaysAgo * DAY_MS;
  return `fdbl-${plan}-${uid}-${issued.toString(36)}`;
}

/** What grantPlanFromPayment writes for a real payment. */
function payingUser(
  plan: string,
  {
    id = OWNER,
    issuedDaysAgo = 3,
  }: { id?: string; issuedDaysAgo?: number } = {}
): FakeClerkUser {
  const pid = paymentId(plan, id, issuedDaysAgo);
  return {
    id,
    publicMetadata: { plan },
    privateMetadata: {
      findablePaymentId: pid,
      findablePaymentGrantStack: [
        { paymentId: pid, plan },
        { paymentId: null, plan: "free" },
      ],
    },
  };
}

/** What grantPlan (admin / invite / partner) writes: plan without provenance. */
function grantedUser(plan: string, id = OWNER): FakeClerkUser {
  return { id, publicMetadata: { plan }, privateMetadata: {} };
}

async function runCron() {
  const response = await GET(
    new Request("https://app.test/api/cron/auto-refresh-tracking") as never
  );
  return (await response.json()) as {
    autoMeasurement: string;
    dueCount: number;
    triggered: number;
  };
}

function measuredOrgIds() {
  return mocks.runAuditJob.mock.calls.map(
    (call) => (call[0] as { organizationId: string }).organizationId
  );
}

const ZERO = { expired: 0, scanned: 0, failed: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // biome-ignore lint/performance/noDelete: absence is the default.
  delete process.env.FINDABLE_AUTO_MEASUREMENT_ENABLED;
  // biome-ignore lint/performance/noDelete: absence is the default.
  delete process.env.FINDABLE_AUTO_MEASUREMENT_SCOPE;
  state.orgs = [];
  state.clerkUsers = [];
  state.inviteUserIds = [];
  state.approvedPartnerIds = [];
  state.lastMeasured = new Map();
  mocks.auditJobCreate.mockResolvedValue({ id: "job_1" });
  mocks.runAuditJob.mockResolvedValue(undefined);
  mocks.expireLapsedRenewalGrants.mockResolvedValue(ZERO);
  mocks.expireCancelledSubscriptions.mockResolvedValue(ZERO);
  mocks.expireOneOffPaymentGrants.mockResolvedValue(ZERO);
  mocks.getUserList.mockImplementation((params: { userId?: string[] }) => {
    const data = state.clerkUsers.filter((u) =>
      (params.userId ?? []).includes(u.id)
    );
    return Promise.resolve({ data, totalCount: data.length });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scope resolution", () => {
  it.each([
    [{}, "paid"],
    [{ FINDABLE_AUTO_MEASUREMENT_SCOPE: "paid" }, "paid"],
    [{ FINDABLE_AUTO_MEASUREMENT_SCOPE: "all" }, "all"],
    [{ FINDABLE_AUTO_MEASUREMENT_SCOPE: "off" }, "off"],
    [{ FINDABLE_AUTO_MEASUREMENT_SCOPE: " ALL " }, "all"],
    [{ FINDABLE_AUTO_MEASUREMENT_SCOPE: "everything" }, "off"],
    [{ FINDABLE_AUTO_MEASUREMENT_ENABLED: "true" }, "all"],
    [{ FINDABLE_AUTO_MEASUREMENT_ENABLED: "false" }, "off"],
    [{ FINDABLE_AUTO_MEASUREMENT_ENABLED: "1" }, "paid"],
    [
      {
        FINDABLE_AUTO_MEASUREMENT_ENABLED: "true",
        FINDABLE_AUTO_MEASUREMENT_SCOPE: "paid",
      },
      "paid",
    ],
  ])("%o → %s", (envVars, expected) => {
    expect(autoMeasurementScope(envVars)).toBe(expected);
  });
});

describe('scope "paid" (default)', () => {
  it("🔴 does not measure an admin-granted growth org (DB timed grant + Clerk push)", async () => {
    state.orgs = [
      org({
        plan: "growth",
        planExpiresAt: new Date(NOW.getTime() + 5 * DAY_MS),
      }),
    ];
    state.clerkUsers = [grantedUser("growth")];

    const result = await runCron();

    expect(result.autoMeasurement).toBe("paid");
    expect(result.dueCount).toBe(0);
    expect(mocks.runAuditJob).not.toHaveBeenCalled();
    expect(mocks.auditJobCreate).not.toHaveBeenCalled();
  });

  it("does not measure invite, partner or DB-only grants", async () => {
    state.orgs = [
      org({
        id: "org_invite",
        plan: "growth",
        planExpiresAt: new Date(NOW.getTime() + 5 * DAY_MS),
      }),
      org({
        id: "org_partner",
        ownerId: "user_partner",
        users: [{ id: "user_partner" }],
      }),
      org({
        id: "org_db",
        ownerId: "user_db",
        users: [{ id: "user_db" }],
        plan: "scale",
      }),
    ];
    state.clerkUsers = [
      grantedUser("growth"),
      grantedUser("growth", "user_partner"),
    ];
    state.inviteUserIds = [OWNER];
    state.approvedPartnerIds = ["user_partner"];

    const result = await runCron();

    expect(result.dueCount).toBe(0);
    expect(mocks.runAuditJob).not.toHaveBeenCalled();
  });

  it("🔴 measures a paying growth org daily", async () => {
    state.orgs = [org()];
    state.clerkUsers = [payingUser("growth")];

    // measured 23h ago → not yet due
    state.lastMeasured.set(
      "org_1|b1.co.kr",
      new Date(NOW.getTime() - 23 * 60 * 60 * 1000)
    );
    expect((await runCron()).dueCount).toBe(0);

    // measured 25h ago → due
    state.lastMeasured.set(
      "org_1|b1.co.kr",
      new Date(NOW.getTime() - 25 * 60 * 60 * 1000)
    );
    const result = await runCron();
    expect(result.dueCount).toBe(1);
    expect(measuredOrgIds()).toEqual(["org_1"]);
  });

  it("measures a paying starter org weekly, not daily", async () => {
    state.orgs = [org()];
    state.clerkUsers = [payingUser("starter")];

    state.lastMeasured.set(
      "org_1|b1.co.kr",
      new Date(NOW.getTime() - 2 * DAY_MS)
    );
    expect((await runCron()).dueCount).toBe(0);

    state.lastMeasured.set(
      "org_1|b1.co.kr",
      new Date(NOW.getTime() - 7 * DAY_MS)
    );
    expect((await runCron()).dueCount).toBe(1);
  });

  it("uses the paid plan, not a higher admin grant, for cadence", async () => {
    // Paying starter + admin growth on top: measured as starter (weekly).
    state.orgs = [
      org({
        plan: "growth",
        planExpiresAt: new Date(NOW.getTime() + 5 * DAY_MS),
      }),
    ];
    state.clerkUsers = [payingUser("starter")];
    state.lastMeasured.set(
      "org_1|b1.co.kr",
      new Date(NOW.getTime() - 2 * DAY_MS)
    );

    expect((await runCron()).dueCount).toBe(0);
  });

  it("🔴 respects the growth brand quota (5) by measuring the oldest-created brands", async () => {
    // brand_7 is the oldest, brand_1 the newest.
    state.orgs = [
      org({
        brands: [1, 2, 3, 4, 5, 6, 7].map((n) => brand(n, n * 10)),
      }),
    ];
    state.clerkUsers = [payingUser("growth")];

    const result = await runCron();

    expect(result.dueCount).toBe(5);
    // Only one brand per run; the very first measured is from the quota set.
    const brandIds = mocks.runAuditJob.mock.calls.map(
      (call) => (call[0] as { brandId: string }).brandId
    );
    expect(brandIds).toHaveLength(1);
    expect(["brand_3", "brand_4", "brand_5", "brand_6", "brand_7"]).toContain(
      brandIds[0]
    );

    // The two newest brands are never due, even with no history.
    for (const n of [3, 4, 5, 6, 7]) {
      state.lastMeasured.set(`org_1|b${n}.co.kr`, NOW);
    }
    expect((await runCron()).dueCount).toBe(0);
  });

  it("respects the starter brand quota (3)", async () => {
    state.orgs = [org({ brands: [1, 2, 3, 4].map((n) => brand(n, n)) })];
    state.clerkUsers = [payingUser("starter")];

    expect((await runCron()).dueCount).toBe(3);
  });

  it("scale has no brand quota", async () => {
    state.orgs = [
      org({ brands: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => brand(n)) }),
    ];
    state.clerkUsers = [payingUser("scale")];

    expect((await runCron()).dueCount).toBe(8);
  });

  it("🔴 still measures past_due within the 7-day renewal grace", async () => {
    // Last payment 33 days ago (its month is over); renewal failed 2 days ago.
    state.orgs = [
      org({
        billingStatus: "past_due",
        billingNextPaymentAt: new Date(NOW.getTime() - 2 * DAY_MS),
      }),
    ];
    state.clerkUsers = [payingUser("growth", { issuedDaysAgo: 33 })];

    const result = await runCron();

    expect(result.dueCount).toBe(1);
    expect(measuredOrgIds()).toEqual(["org_1"]);
  });

  it("does not measure past_due after the grace even if the expiry step failed to clear Clerk", async () => {
    state.orgs = [
      org({
        billingStatus: "past_due",
        billingNextPaymentAt: new Date(NOW.getTime() - 8 * DAY_MS),
      }),
    ];
    state.clerkUsers = [payingUser("growth", { issuedDaysAgo: 39 })];

    expect((await runCron()).dueCount).toBe(0);
    expect(mocks.runAuditJob).not.toHaveBeenCalled();
  });

  it("🔴 does not measure an expired payment (provenance cleared)", async () => {
    state.orgs = [org({ billingStatus: "expired" })];
    state.clerkUsers = [grantedUser("free")];

    expect((await runCron()).dueCount).toBe(0);
    expect(mocks.runAuditJob).not.toHaveBeenCalled();
  });

  it("does not measure a payment whose month is over when no grace applies", async () => {
    // One-off payment 40 days ago whose provenance was not yet swept.
    state.orgs = [org()];
    state.clerkUsers = [payingUser("growth", { issuedDaysAgo: 40 })];

    expect((await runCron()).dueCount).toBe(0);
  });

  it("does not open measurement when Clerk is unavailable", async () => {
    state.orgs = [org({ plan: "growth" })];
    mocks.getUserList.mockRejectedValue(new Error("clerk down"));

    expect((await runCron()).dueCount).toBe(0);
    expect(mocks.runAuditJob).not.toHaveBeenCalled();
  });

  it("keeps MAX_TRIGGERS_PER_RUN = 1 across several paying orgs", async () => {
    state.orgs = [
      org(),
      org({
        id: "org_2",
        ownerId: "user_2",
        users: [{ id: "user_2" }],
        brands: [brand(2)],
      }),
    ];
    state.clerkUsers = [
      payingUser("growth"),
      payingUser("scale", { id: "user_2" }),
    ];

    const result = await runCron();

    expect(result.dueCount).toBe(2);
    expect(mocks.runAuditJob).toHaveBeenCalledTimes(1);
  });
});

describe('scope "all"', () => {
  it("🔴 restores the old behaviour: admin, invite-period and partner grants are measured", async () => {
    process.env.FINDABLE_AUTO_MEASUREMENT_SCOPE = "all";
    state.orgs = [
      org({
        plan: "growth",
        planExpiresAt: new Date(NOW.getTime() + 5 * DAY_MS),
      }),
      org({
        id: "org_partner",
        ownerId: "user_partner",
        users: [{ id: "user_partner" }],
        brands: [brand(2)],
      }),
    ];
    state.clerkUsers = [
      grantedUser("free"),
      grantedUser("free", "user_partner"),
    ];
    state.approvedPartnerIds = ["user_partner"];

    const result = await runCron();

    expect(result.autoMeasurement).toBe("all");
    expect(result.dueCount).toBe(2);
  });

  it("does not apply the paid brand quota", async () => {
    process.env.FINDABLE_AUTO_MEASUREMENT_SCOPE = "all";
    state.orgs = [org({ brands: [1, 2, 3, 4, 5, 6, 7].map((n) => brand(n)) })];
    state.clerkUsers = [payingUser("growth")];

    expect((await runCron()).dueCount).toBe(7);
  });

  it('legacy FINDABLE_AUTO_MEASUREMENT_ENABLED=true behaves as "all"', async () => {
    process.env.FINDABLE_AUTO_MEASUREMENT_ENABLED = "true";
    state.orgs = [
      org({
        plan: "growth",
        planExpiresAt: new Date(NOW.getTime() + 5 * DAY_MS),
      }),
    ];
    state.clerkUsers = [grantedUser("free")];

    const result = await runCron();

    expect(result.autoMeasurement).toBe("all");
    expect(result.dueCount).toBe(1);
  });
});

describe('scope "off"', () => {
  it("🔴 measures nothing but still runs every payment-expiry step", async () => {
    process.env.FINDABLE_AUTO_MEASUREMENT_SCOPE = "off";
    state.orgs = [org()];
    state.clerkUsers = [payingUser("growth")];

    const result = await runCron();

    expect(result).toMatchObject({
      autoMeasurement: "off",
      dueCount: 0,
      triggered: 0,
    });
    expect(mocks.runAuditJob).not.toHaveBeenCalled();
    expect(mocks.auditJobCreate).not.toHaveBeenCalled();
    expect(mocks.getUserList).not.toHaveBeenCalled();
    expect(mocks.expireLapsedRenewalGrants).toHaveBeenCalledTimes(1);
    expect(mocks.expireCancelledSubscriptions).toHaveBeenCalledTimes(1);
    expect(mocks.expireOneOffPaymentGrants).toHaveBeenCalledTimes(1);
  });

  it("expiry steps also run in paid mode", async () => {
    await runCron();
    expect(mocks.expireLapsedRenewalGrants).toHaveBeenCalledTimes(1);
    expect(mocks.expireCancelledSubscriptions).toHaveBeenCalledTimes(1);
    expect(mocks.expireOneOffPaymentGrants).toHaveBeenCalledTimes(1);
  });
});

describe("resolveOrganizationPlanWithSource", () => {
  const member = {
    clerkPlan: "free" as const,
    hasCurrentPaymentGrant: false,
    hasInviteRedemption: false,
    isApprovedPartner: false,
  };
  const future = new Date(NOW.getTime() + DAY_MS);

  it.each([
    [
      "payment",
      {
        organizationPlan: "free",
        organizationPlanExpiresAt: null,
        members: [
          { ...member, clerkPlan: "growth", hasCurrentPaymentGrant: true },
        ],
      },
      { plan: "growth", source: "payment", paymentPlan: "growth" },
    ],
    [
      "admin timed DB grant",
      {
        organizationPlan: "growth",
        organizationPlanExpiresAt: future,
        members: [member],
      },
      { plan: "growth", source: "admin", paymentPlan: "free" },
    ],
    [
      "admin Clerk push only",
      {
        organizationPlan: "free",
        organizationPlanExpiresAt: null,
        members: [{ ...member, clerkPlan: "growth" }],
      },
      { plan: "growth", source: "admin", paymentPlan: "free" },
    ],
    [
      "invite",
      {
        organizationPlan: "growth",
        organizationPlanExpiresAt: future,
        members: [{ ...member, hasInviteRedemption: true }],
      },
      { plan: "growth", source: "invite", paymentPlan: "free" },
    ],
    [
      "partner",
      {
        organizationPlan: "free",
        organizationPlanExpiresAt: null,
        members: [{ ...member, isApprovedPartner: true }],
      },
      { plan: "growth", source: "partner", paymentPlan: "free" },
    ],
    [
      "db-only",
      {
        organizationPlan: "scale",
        organizationPlanExpiresAt: null,
        members: [],
      },
      { plan: "scale", source: "db", paymentPlan: "free" },
    ],
    [
      "none",
      {
        organizationPlan: "free",
        organizationPlanExpiresAt: null,
        members: [member],
      },
      { plan: "free", source: "none", paymentPlan: "free" },
    ],
    [
      "payment wins a tie with an admin grant",
      {
        organizationPlan: "growth",
        organizationPlanExpiresAt: future,
        members: [
          { ...member, clerkPlan: "growth", hasCurrentPaymentGrant: true },
        ],
      },
      { plan: "growth", source: "payment", paymentPlan: "growth" },
    ],
    [
      "higher admin grant over a lower payment",
      {
        organizationPlan: "scale",
        organizationPlanExpiresAt: future,
        members: [
          { ...member, clerkPlan: "starter", hasCurrentPaymentGrant: true },
        ],
      },
      { plan: "scale", source: "admin", paymentPlan: "starter" },
    ],
  ] as const)("%s", (_label, input, expected) => {
    expect(resolveOrganizationPlanWithSource({ ...input, now: NOW })).toEqual(
      expected
    );
  });
});

describe("resolveOrganizationPlanWithSource matches resolveOrganizationPlan", () => {
  it("returns the same effective plan for every member/org combination", () => {
    const expiries = [
      null,
      new Date(NOW.getTime() + DAY_MS),
      new Date(NOW.getTime() - DAY_MS),
    ];
    const flags = [false, true];
    const members: MemberPlanSignal[] = [];
    for (const clerkPlan of PLANS) {
      for (const hasCurrentPaymentGrant of flags) {
        for (const hasInviteRedemption of flags) {
          for (const isApprovedPartner of flags) {
            members.push({
              clerkPlan,
              hasCurrentPaymentGrant,
              hasInviteRedemption,
              isApprovedPartner,
            });
          }
        }
      }
    }
    let checked = 0;
    for (const organizationPlan of PLANS) {
      for (const organizationPlanExpiresAt of expiries) {
        const input = { organizationPlan, organizationPlanExpiresAt, now: NOW };
        expect(
          resolveOrganizationPlanWithSource({ ...input, members: [] }).plan
        ).toBe(resolveOrganizationPlan({ ...input, members: [] }));
        for (const a of members) {
          for (const b of [members[0], members.at(-1)]) {
            const pair = [a, b as MemberPlanSignal];
            expect(
              resolveOrganizationPlanWithSource({ ...input, members: pair })
                .plan
            ).toBe(resolveOrganizationPlan({ ...input, members: pair }));
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
