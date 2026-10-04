/**
 * Subscription entry guards — ported from spike/payment-ledger-safety-20261004
 * (subscription-entry-guards-red.test.ts, G1-G7/C1/X1/X2) and adapted to main.
 *
 * Real server actions; DB, PortOne, and Clerk are in-memory doubles. No provider,
 * Clerk, or production DB calls occur. Kill-switch cases (K1-K7) are not ported:
 * main has no BILLING_NEW_ENROLLMENT_DISABLED switch.
 *
 * Policy (control tower, 2026-10-05): fail closed — an org that is active/past_due
 * (or still holds a billing key) cannot start a new subscription; only the paying
 * member or an org admin may cancel.
 * KNOWN RED on main: cases marked it.fails reproduce the harm (fixed next commit).
 * @vitest-environment node
 */

import { amountForPlan } from "@repo/payments/catalog";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

interface OrgRow {
  billingCustomerId: string | null;
  billingLastPaymentId: string | null;
  billingNextPaymentAt: Date | null;
  billingNextPaymentId: string | null;
  billingProvider: string | null;
  billingStatus: string;
  id: string;
  ownerId: string;
}

const fixture = vi.hoisted(() => {
  const blank = {
    billingStatus: "trialing",
    billingCustomerId: null,
    billingProvider: null,
    billingLastPaymentId: null,
    billingNextPaymentId: null,
    billingNextPaymentAt: null,
  };
  const session = {
    userId: "user_owner-1",
    orgId: "org-1" as string | null,
    orgRole: "org:admin",
    has: vi.fn(({ role }: { role: string }) => role === "org:admin"),
  };
  const organization: Record<string, unknown> = {
    id: "org-1",
    ownerId: "user_owner-1",
    ...blank,
  };
  const otherOrganization: Record<string, unknown> = {
    id: "org-2",
    ownerId: "user_owner-1",
    ...blank,
  };
  const rows = [organization, otherOrganization];
  const rowFor = (id: string) => rows.find((row) => row.id === id);
  const matches = (
    row: Record<string, unknown>,
    where: Record<string, unknown>
  ) =>
    Object.entries(where).every(([key, condition]) => {
      if (!(key in row)) {
        throw new Error(`unsupported condition: ${key}`);
      }
      const actual = row[key];
      if (condition && typeof condition === "object") {
        const operand = condition as Record<string, unknown>;
        if ("in" in operand && Array.isArray(operand.in)) {
          return operand.in.includes(actual);
        }
        if ("not" in operand) {
          return actual !== operand.not;
        }
        throw new Error(`unsupported operator: ${key}`);
      }
      return actual === condition;
    });
  let sequence = 0;
  return {
    blank,
    session,
    organization,
    otherOrganization,
    rowFor,
    matches,
    pay: vi.fn((_input: { billingKey: string; paymentId: string }) =>
      Promise.resolve()
    ),
    getPayment: vi.fn(async (paymentId: string) => ({
      id: paymentId,
      status: "PAID",
      currency: "KRW",
      amount: { total: 39_000 },
    })),
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    schedule: vi.fn((_input: { billingKey: string; paymentId: string }) =>
      Promise.resolve()
    ),
    cancelSchedules: vi.fn((_key: string) => Promise.resolve()),
    deleteKey: vi.fn((_key: string) => Promise.resolve()),
    // Real id format; a per-call offset stands in for distinct request clocks.
    buildPaymentId: vi.fn((plan: string, userId: string, at?: number) => {
      sequence += 1;
      const issued = at ?? Date.now() + sequence;
      return `fdbl-${plan}-${userId.replace(/^user_/, "")}-${issued.toString(36)}`;
    }),
    findUnique: vi.fn(
      ({
        select,
        where,
      }: {
        select?: Record<string, boolean>;
        where: { id: string };
      }) => {
        const row = rowFor(where.id);
        if (!row) {
          return Promise.resolve(null);
        }
        if (!select) {
          return Promise.resolve(structuredClone(row));
        }
        return Promise.resolve(
          Object.fromEntries(
            Object.entries(select)
              .filter(([, enabled]) => enabled)
              .map(([key]) => {
                if (!(key in row)) {
                  throw new Error(`unknown selected field: ${key}`);
                }
                return [key, row[key]];
              })
          )
        );
      }
    ),
    update: vi.fn(
      ({
        data,
        where,
      }: {
        data: Record<string, unknown>;
        where: { id: string };
      }) => {
        const row = rowFor(where.id);
        if (!row) {
          throw new Error("wrong organization update");
        }
        Object.assign(row, data);
        return Promise.resolve(row);
      }
    ),
    // In-memory atomic compare-and-write for the exact Prisma where supplied.
    updateMany: vi.fn(
      ({
        data,
        where,
      }: {
        data: Record<string, unknown>;
        where: Record<string, unknown> & { id: string };
      }) => {
        const row = rowFor(where.id);
        if (!(row && matches(row, where))) {
          return Promise.resolve({ count: 0 });
        }
        Object.assign(row, data);
        return Promise.resolve({ count: 1 });
      }
    ),
  };
});

vi.mock("@repo/auth/server", () => ({
  auth: vi.fn(async () => fixture.session),
  currentUser: vi.fn(async () => ({ firstName: "Test", lastName: "Buyer" })),
}));
vi.mock("@repo/auth/plan-grant", () => ({
  grantPlanFromPayment: vi.fn(async () => true),
}));
vi.mock("@repo/database", () => ({
  database: {
    organization: {
      findUnique: fixture.findUnique,
      update: fixture.update,
      updateMany: fixture.updateMany,
    },
  },
}));
vi.mock("@repo/payments", async () => {
  const catalog = await vi.importActual<
    typeof import("@repo/payments/catalog")
  >("@repo/payments/catalog");
  const cycle = await vi.importActual<
    typeof import("@repo/payments/billing-cycle")
  >("@repo/payments/billing-cycle");
  return {
    ...catalog,
    nextBillingDate: cycle.nextBillingDate,
    buildPaymentId: fixture.buildPaymentId,
    cancelBillingKeySchedules: fixture.cancelSchedules,
    deleteBillingKey: fixture.deleteKey,
    getPortOnePayment: fixture.getPayment,
    isPortOneConfigured: vi.fn(() => true),
    payWithBillingKey: fixture.pay,
    schedulePaymentWithBillingKey: fixture.schedule,
  };
});
vi.mock("@/lib/db/ensure-org", () => ({
  ensureOrgExists: vi.fn(async () => fixture.session.orgId),
}));
vi.mock("@repo/observability/error", () => ({ parseError: String }));
vi.mock("@repo/observability/log", () => ({ log: fixture.log }));

let actions: typeof import("@/app/actions/billing/subscription");
let checkout: typeof import("@/app/actions/billing/checkout");

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_PORTONE_CHANNEL_KEY_BILLING", "test-only-channel");
  actions = await import("@/app/actions/billing/subscription");
  checkout = await import("@/app/actions/billing/checkout");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const org = () => fixture.organization as unknown as OrgRow;
const setOrg = (patch: Partial<OrgRow>) =>
  Object.assign(fixture.organization, patch);
const paymentIdFor = (userId: string) =>
  fixture.buildPaymentId("starter", userId);

beforeEach(() => {
  Object.assign(fixture.session, {
    userId: "user_owner-1",
    orgId: "org-1",
    orgRole: "org:admin",
  });
  Object.assign(fixture.organization, fixture.blank);
  Object.assign(fixture.otherOrganization, fixture.blank);
  vi.clearAllMocks();
  fixture.pay.mockImplementation(() => Promise.resolve());
  fixture.session.has.mockImplementation(({ role }) => role === "org:admin");
  fixture.getPayment.mockImplementation(async (paymentId: string) => ({
    id: paymentId,
    status: "PAID",
    currency: "KRW",
    amount: { total: 39_000 },
  }));
});

describe("controls", () => {
  it("trialing owner can start a first subscription intent and one charge", async () => {
    expect(await actions.createSubscribeIntent("starter")).toMatchObject({
      ok: true,
      amount: amountForPlan("starter"),
    });
    expect(
      await actions.confirmSubscription("starter", "first-key")
    ).toMatchObject({ ok: true, plan: "starter", renewalScheduled: true });
    expect(fixture.pay).toHaveBeenCalledTimes(1);
    expect(fixture.schedule).toHaveBeenCalledTimes(1);
    expect(org()).toMatchObject({
      billingStatus: "active",
      billingCustomerId: "first-key",
      billingLastPaymentId: fixture.pay.mock.calls[0]?.[0].paymentId,
      billingNextPaymentId: fixture.schedule.mock.calls[0]?.[0].paymentId,
    });
  });

  it("the paying owner of an active org can cancel", async () => {
    setOrg({
      billingStatus: "active",
      billingCustomerId: "owner-key",
      billingProvider: "portone",
      billingLastPaymentId: paymentIdFor("user_owner-1"),
    });
    expect(await actions.unsubscribe()).toEqual({ ok: true });
    expect(fixture.cancelSchedules).toHaveBeenCalledWith("owner-key");
    expect(fixture.deleteKey).toHaveBeenCalledWith("owner-key");
  });

  it("one-off checkout intent is allowed for an org without a subscription", async () => {
    expect(await checkout.createCheckoutIntent("growth")).toMatchObject({
      ok: true,
      amount: amountForPlan("growth"),
    });
  });

  it("a cancelled org (no billing key) may subscribe again", async () => {
    setOrg({
      billingStatus: "canceled",
      billingLastPaymentId: paymentIdFor("user_owner-1"),
      billingNextPaymentAt: new Date("2026-11-01T00:00:00.000Z"),
    });
    expect(
      await actions.confirmSubscription("starter", "again-key")
    ).toMatchObject({ ok: true });
    expect(fixture.pay).toHaveBeenCalledTimes(1);
  });
});

describe("policy gates [policy-gate]", () => {
  it.fails("G1: active org intent is refused without issueId/channel key", async () => {
    setOrg({
      billingStatus: "active",
      billingCustomerId: "old-key",
      billingProvider: "portone",
    });
    const result = await actions.createSubscribeIntent("growth");
    expect(result).toHaveProperty("error");
    expect(result).not.toHaveProperty("issueId");
    expect(result).not.toHaveProperty("billingChannelKey");
  });

  it.fails("G2: active org calling confirm directly is charged zero times", async () => {
    setOrg({
      billingStatus: "active",
      billingCustomerId: "old-key",
      billingProvider: "portone",
    });
    const result = await actions.confirmSubscription("growth", "new-key");
    expect(fixture.pay).not.toHaveBeenCalled();
    expect(result).toHaveProperty("error");
    expect(org().billingCustomerId).toBe("old-key");
  });

  it.fails("G4a: past_due org intent is refused without issueId/channel key", async () => {
    setOrg({
      billingStatus: "past_due",
      billingCustomerId: "existing-key",
      billingProvider: "portone",
    });
    const intent = await actions.createSubscribeIntent("growth");
    expect(intent).toHaveProperty("error");
    expect(intent).not.toHaveProperty("issueId");
    expect(intent).not.toHaveProperty("billingChannelKey");
  });

  it.fails("G4b: past_due org direct confirm is refused before charging", async () => {
    setOrg({
      billingStatus: "past_due",
      billingCustomerId: "existing-key",
      billingProvider: "portone",
    });
    const confirmation = await actions.confirmSubscription("growth", "new-key");
    expect(fixture.pay).not.toHaveBeenCalled();
    expect(confirmation).toHaveProperty("error");
  });

  it.fails("G6: active org one-off checkout intent is refused without paymentId", async () => {
    setOrg({
      billingStatus: "active",
      billingCustomerId: "old-key",
      billingProvider: "portone",
    });
    const result = await checkout.createCheckoutIntent("growth");
    expect(result).toHaveProperty("error");
    expect(result).not.toHaveProperty("paymentId");
  });

  it.fails("G7: a non-paying org:member cannot cancel the owner's key", async () => {
    fixture.session.userId = "user_member-2";
    fixture.session.orgRole = "org:member";
    fixture.session.has.mockReturnValue(false);
    setOrg({
      billingStatus: "active",
      billingCustomerId: "owner-key",
      billingProvider: "portone",
      billingLastPaymentId: paymentIdFor("user_owner-1"),
    });
    const result = await actions.unsubscribe();
    expect(fixture.cancelSchedules).not.toHaveBeenCalled();
    expect(fixture.deleteKey).not.toHaveBeenCalled();
    expect(result).toHaveProperty("error");
    expect(org().billingCustomerId).toBe("owner-key");
  });

  it("G7 control: the paying org:member can cancel", async () => {
    fixture.session.userId = "user_member-2";
    fixture.session.orgRole = "org:member";
    fixture.session.has.mockReturnValue(false);
    setOrg({
      billingStatus: "active",
      billingCustomerId: "member-key",
      billingProvider: "portone",
      billingLastPaymentId: paymentIdFor("user_member-2"),
    });
    expect(await actions.unsubscribe()).toEqual({ ok: true });
    expect(fixture.cancelSchedules).toHaveBeenCalledWith("member-key");
    expect(fixture.deleteKey).toHaveBeenCalledWith("member-key");
  });

  it("G7 control: a non-paying org admin can cancel", async () => {
    fixture.session.userId = "user_admin-3";
    setOrg({
      billingStatus: "active",
      billingCustomerId: "owner-key",
      billingProvider: "portone",
      billingLastPaymentId: paymentIdFor("user_owner-1"),
    });
    expect(await actions.unsubscribe()).toEqual({ ok: true });
    expect(fixture.cancelSchedules).toHaveBeenCalledWith("owner-key");
  });

  it.fails("H4: legacy org without a last payment id is cancellable by admin only", async () => {
    setOrg({
      billingStatus: "active",
      billingCustomerId: "legacy-key",
      billingProvider: "portone",
      billingLastPaymentId: null,
    });
    fixture.session.userId = "user_member-2";
    fixture.session.orgRole = "org:member";
    fixture.session.has.mockReturnValue(false);
    expect(await actions.unsubscribe()).toHaveProperty("error");
    expect(fixture.cancelSchedules).not.toHaveBeenCalled();

    fixture.session.has.mockImplementation(({ role }) => role === "org:admin");
    expect(await actions.unsubscribe()).toEqual({ ok: true });
    expect(fixture.cancelSchedules).toHaveBeenCalledWith("legacy-key");
  });

  it("P1: payer without an active orgId cannot cancel", async () => {
    fixture.session.orgId = null;
    setOrg({
      billingStatus: "active",
      billingCustomerId: "owner-key",
      billingProvider: "portone",
      billingLastPaymentId: paymentIdFor("user_owner-1"),
    });
    expect(await actions.unsubscribe()).toHaveProperty("error");
    expect(fixture.cancelSchedules).not.toHaveBeenCalled();
  });

  it("P1-a: session on org-2 targets org-2 only", async () => {
    fixture.session.orgId = "org-2";
    setOrg({
      billingStatus: "active",
      billingCustomerId: "org-1-key",
      billingProvider: "portone",
      billingLastPaymentId: paymentIdFor("user_owner-1"),
    });
    Object.assign(fixture.otherOrganization, {
      billingStatus: "active",
      billingCustomerId: "org-2-key",
      billingProvider: "portone",
      billingLastPaymentId: paymentIdFor("user_owner-1"),
    });
    expect(await actions.unsubscribe()).toEqual({ ok: true });
    expect(fixture.cancelSchedules).toHaveBeenCalledWith("org-2-key");
    expect(fixture.cancelSchedules).not.toHaveBeenCalledWith("org-1-key");
    expect(org().billingCustomerId).toBe("org-1-key");
  });

  it("X1: a trialing org still holding a key can be cancelled by its payer", async () => {
    setOrg({
      billingStatus: "trialing",
      billingCustomerId: "pending-key",
      billingProvider: "portone",
      billingLastPaymentId: paymentIdFor("user_owner-1"),
    });
    expect(await actions.unsubscribe()).toEqual({ ok: true });
    expect(fixture.cancelSchedules).toHaveBeenCalledWith("pending-key");
    expect(fixture.deleteKey).toHaveBeenCalledWith("pending-key");
    expect(org().billingCustomerId).toBeNull();
  });

  it.fails("X2: an org still holding a billing key cannot start a second charge", async () => {
    setOrg({
      billingStatus: "trialing",
      billingCustomerId: "old-key",
      billingProvider: "portone",
      billingLastPaymentId: paymentIdFor("user_owner-1"),
    });
    expect(
      await actions.confirmSubscription("starter", "new-key")
    ).toHaveProperty("error");
    expect(fixture.pay).not.toHaveBeenCalled();
    expect(org().billingCustomerId).toBe("old-key");
  });
});

describe("double-charge harms [harm]", () => {
  it.fails("G3: two concurrent confirms start exactly one charge", async () => {
    let releasePayment: () => void = () => undefined;
    const paymentBarrier = new Promise<void>((resolve) => {
      releasePayment = resolve;
    });
    fixture.pay.mockImplementation(() => paymentBarrier);
    // Two distinct action module instances share one DB double.
    const firstInstance = actions;
    vi.resetModules();
    const secondInstance = await import("@/app/actions/billing/subscription");
    expect(secondInstance.confirmSubscription).not.toBe(
      firstInstance.confirmSubscription
    );
    const attempts = [
      firstInstance.confirmSubscription("starter", "key-1"),
      secondInstance.confirmSubscription("starter", "key-2"),
    ];
    // Let every continuation run up to the unresolved payment barrier.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const startedCharges = fixture.pay.mock.calls.length;
    releasePayment();
    const results = await Promise.all(attempts);
    expect({
      startedCharges,
      finalCharges: fixture.pay.mock.calls.length,
      successfulConfirms: results.filter((result) => "ok" in result).length,
      schedules: fixture.schedule.mock.calls.length,
    }).toEqual({
      startedCharges: 1,
      finalCharges: 1,
      successfulConfirms: 1,
      schedules: 1,
    });
  });

  it.fails("C1: retry after a post-charge DB failure does not re-charge with a new id", async () => {
    expect(await actions.createSubscribeIntent("starter")).toMatchObject({
      ok: true,
    });
    const originalUpdate = fixture.update.getMockImplementation();
    const originalUpdateMany = fixture.updateMany.getMockImplementation();
    let injected = false;
    const failsAfterCharge = (data: Record<string, unknown>) => {
      if (
        !injected &&
        fixture.pay.mock.calls.length === 1 &&
        data.billingStatus === "active"
      ) {
        injected = true;
        return true;
      }
      return false;
    };
    fixture.update.mockImplementation((input) => {
      if (failsAfterCharge(input.data)) {
        return Promise.reject(new Error("simulated post-charge write failure"));
      }
      if (!originalUpdate) {
        throw new Error("missing organization update fixture");
      }
      return originalUpdate(input);
    });
    fixture.updateMany.mockImplementation((input) => {
      if (failsAfterCharge(input.data)) {
        return Promise.reject(new Error("simulated post-charge write failure"));
      }
      if (!originalUpdateMany) {
        throw new Error("missing organization updateMany fixture");
      }
      return originalUpdateMany(input);
    });
    const first = await actions.confirmSubscription(
      "starter",
      "first-issued-key"
    );
    expect(injected).toBe(true);
    expect(fixture.pay).toHaveBeenCalledTimes(1);
    expect(org().billingStatus).toBe("trialing");
    expect(org().billingCustomerId).toBeNull();
    // The UI retry would issue a new intent + billing key; refuse before that.
    const retryIntent = await actions.createSubscribeIntent("starter");
    // Process memory is gone after a restart; only the DB double survives.
    vi.resetModules();
    const restartedActions = await import("@/app/actions/billing/subscription");
    const retry = await restartedActions.confirmSubscription(
      "starter",
      "retry-issued-key"
    );
    expect(fixture.pay.mock.calls[0]?.[0].billingKey).toBe("first-issued-key");
    expect({
      first,
      chargeAttempts: fixture.pay.mock.calls.length,
      retryIntent,
      retry,
    }).toMatchObject({
      first: { error: expect.stringMatching(/복구|처리 중/) },
      chargeAttempts: 1,
      retryIntent: { error: expect.any(String) },
      retry: { error: expect.stringMatching(/복구|처리 중/) },
    });
  });

  it("C1 control: a declined first charge releases the claim so a retry can pay", async () => {
    fixture.pay.mockRejectedValueOnce(new Error("card declined"));
    fixture.getPayment.mockImplementation(async (paymentId: string) => ({
      id: paymentId,
      status: "FAILED",
      currency: "KRW",
      amount: { total: 39_000 },
    }));
    expect(
      await actions.confirmSubscription("starter", "declined-key")
    ).toHaveProperty("error");
    expect(org().billingNextPaymentId).toBeNull();

    expect(
      await actions.confirmSubscription("starter", "second-key")
    ).toMatchObject({ ok: true });
    expect(fixture.pay).toHaveBeenCalledTimes(2);
    const [firstId, secondId] = fixture.pay.mock.calls.map(
      ([input]) => input.paymentId
    );
    expect(secondId).not.toBe(firstId);
  });

  it.fails("C1 control: an unknown charge outcome keeps the claim (fail closed)", async () => {
    fixture.pay.mockRejectedValueOnce(new Error("timeout"));
    fixture.getPayment.mockRejectedValue(new Error("lookup outage"));
    expect(
      await actions.confirmSubscription("starter", "timeout-key")
    ).toHaveProperty("error");
    expect(org().billingNextPaymentId).toBe(
      fixture.pay.mock.calls[0]?.[0].paymentId
    );
    expect(
      await actions.confirmSubscription("starter", "again-key")
    ).toHaveProperty("error");
    expect(fixture.pay).toHaveBeenCalledTimes(1);
  });

  it.fails("C1 control: a stale claim whose charge FAILED at PortOne is released", async () => {
    const staleId = fixture.buildPaymentId(
      "starter",
      "user_owner-1",
      Date.now() - 60 * 60 * 1000
    );
    setOrg({ billingNextPaymentId: staleId });
    fixture.getPayment.mockImplementation(async (paymentId: string) => ({
      id: paymentId,
      status: "FAILED",
      currency: "KRW",
      amount: { total: 39_000 },
    }));
    expect(
      await actions.confirmSubscription("starter", "fresh-key")
    ).toMatchObject({ ok: true });
    expect(fixture.getPayment).toHaveBeenCalledWith(staleId);
    expect(fixture.pay).toHaveBeenCalledTimes(1);
    expect(fixture.pay.mock.calls[0]?.[0].paymentId).not.toBe(staleId);
  });

  it.fails("C1 control: a stale claim whose charge is PAID stays blocked for recovery", async () => {
    const staleId = fixture.buildPaymentId(
      "starter",
      "user_owner-1",
      Date.now() - 60 * 60 * 1000
    );
    setOrg({ billingNextPaymentId: staleId });
    const result = await actions.confirmSubscription("starter", "fresh-key");
    expect(result).toMatchObject({ error: expect.stringMatching(/복구/) });
    expect(fixture.pay).not.toHaveBeenCalled();
    expect(org().billingNextPaymentId).toBe(staleId);
  });
});
