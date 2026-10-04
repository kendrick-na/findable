/**
 * Post-charge failure → real Paid/Cancelled webhook POST → another confirm.
 * Ported from spike/payment-ledger-safety-20261004
 * (subscription-post-charge-webhook-red.test.ts) and adapted to main.
 *
 * Signature, PortOne, DB, and Clerk are doubles; the action, webhook route,
 * parser, and catalog are real. Ledger-only cases (claims, attempts, shadow
 * tombstones, kill switch) are not ported because main has none of them.
 * KNOWN RED on main: cases marked it.fails reproduce the harm (fixed next commit).
 * @vitest-environment node
 */

import { amountForPlan } from "@repo/payments/catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STARTER_AMOUNT = amountForPlan("starter") ?? 0;

const fixture = vi.hoisted(() => {
  const blank = {
    billingStatus: "trialing",
    billingCustomerId: null,
    billingProvider: null,
    billingLastPaymentId: null,
    billingNextPaymentId: null,
    billingNextPaymentAt: null,
  };
  const organization: Record<string, unknown> = {
    id: "org-1",
    ownerId: "user_owner-1",
    ...blank,
  };
  const state = { failNextActiveWrite: false };
  const shouldFailActiveWrite = (data: Record<string, unknown>) => {
    if (state.failNextActiveWrite && data.billingStatus === "active") {
      state.failNextActiveWrite = false;
      return true;
    }
    return false;
  };
  const matches = (where: Record<string, unknown>) =>
    Object.entries(where).every(([key, condition]) => {
      if (!(key in organization)) {
        throw new Error(`unsupported condition: ${key}`);
      }
      if (condition && typeof condition === "object") {
        throw new Error(`unsupported operator: ${key}`);
      }
      return organization[key] === condition;
    });
  return {
    blank,
    state,
    organization,
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    pay: vi.fn(
      async (_input: { paymentId: string; billingKey: string }) => undefined
    ),
    grant: vi.fn(
      async (_userId: string, _plan: string, _paymentId: string) => true
    ),
    revoke: vi.fn(async (_userId: string, _paymentId: string) => ({
      revoked: true,
      reason: "revoked",
    })),
    cancelSchedules: vi.fn(async (_key: string) => undefined),
    deleteBillingKey: vi.fn(async (_key: string) => undefined),
    schedule: vi.fn(async (_input: { paymentId: string }) => undefined),
    getPayment: vi.fn(),
    findOrganization: vi.fn(
      ({
        select,
        where,
      }: {
        select?: Record<string, boolean>;
        where: { id: string };
      }) => {
        if (where.id !== organization.id) {
          return Promise.resolve(null);
        }
        if (!select) {
          return Promise.resolve(structuredClone(organization));
        }
        return Promise.resolve(
          Object.fromEntries(
            Object.entries(select)
              .filter(([, enabled]) => enabled)
              .map(([key]) => [key, organization[key]])
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
        if (where.id !== organization.id) {
          return Promise.reject(new Error("wrong org update"));
        }
        if (shouldFailActiveWrite(data)) {
          return Promise.reject(new Error("simulated org write failure"));
        }
        Object.assign(organization, data);
        return Promise.resolve(organization);
      }
    ),
    updateMany: vi.fn(
      ({
        data,
        where,
      }: {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      }) => {
        if (!matches(where)) {
          return Promise.resolve({ count: 0 });
        }
        if (shouldFailActiveWrite(data)) {
          return Promise.reject(new Error("simulated org write failure"));
        }
        Object.assign(organization, data);
        return Promise.resolve({ count: 1 });
      }
    ),
    findFirst: vi.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(matches(where) ? structuredClone(organization) : null)
    ),
    findUser: vi.fn(({ where }: { where: { id: string } }) => {
      if (where.id !== "user_owner-1") {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        email: "test@example.invalid",
        name: "Test Buyer",
        organization: structuredClone(organization),
      });
    }),
  };
});

vi.mock("@repo/auth/server", () => ({
  auth: vi.fn(async () => ({
    userId: "user_owner-1",
    orgId: "org-1",
    has: () => true,
  })),
  currentUser: vi.fn(async () => ({ firstName: "Test", lastName: "Buyer" })),
}));
vi.mock("@repo/auth/plan-grant", () => ({
  grantPlanFromPayment: fixture.grant,
  revokePlanFromPayment: fixture.revoke,
}));
vi.mock("@repo/database", () => ({
  database: {
    organization: {
      findFirst: fixture.findFirst,
      findUnique: fixture.findOrganization,
      update: fixture.update,
      updateMany: fixture.updateMany,
    },
    user: { findUnique: fixture.findUser },
  },
}));
vi.mock("@repo/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/payments")>();
  return {
    ...actual,
    verifyWebhookSignature: vi.fn(() => ({ ok: true })),
    getPortOnePayment: fixture.getPayment,
    cancelBillingKeySchedules: fixture.cancelSchedules,
    deleteBillingKey: fixture.deleteBillingKey,
    isPortOneConfigured: vi.fn(() => true),
    payWithBillingKey: fixture.pay,
    schedulePaymentWithBillingKey: fixture.schedule,
  };
});
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@/lib/db/ensure-org", () => ({
  ensureOrgExists: vi.fn(async () => "org-1"),
}));
vi.mock("@repo/observability/error", () => ({ parseError: String }));
vi.mock("@repo/observability/log", () => ({ log: fixture.log }));

const paidPayment = (paymentId: string, paidAt?: string) => ({
  id: paymentId,
  storeId: "store-test",
  status: "PAID",
  currency: "KRW",
  amount: { total: STARTER_AMOUNT },
  paidAt,
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_PORTONE_CHANNEL_KEY_BILLING", "test-channel");
  Object.assign(fixture.organization, fixture.blank);
  fixture.state.failNextActiveWrite = false;
  vi.clearAllMocks();
  fixture.pay.mockImplementation(async () => undefined);
  fixture.grant.mockImplementation(async () => true);
  fixture.schedule.mockImplementation(async () => undefined);
  fixture.getPayment.mockImplementation(async (paymentId: string) =>
    paidPayment(paymentId, "2026-10-04T00:00:00.000Z")
  );
});

async function postEvent(
  type: "Transaction.Paid" | "Transaction.Cancelled",
  paymentId: string
): Promise<Response> {
  const { POST } = await import("@/app/webhooks/payments/route");
  return POST(
    new Request("http://localhost/webhooks/payments", {
      method: "POST",
      body: JSON.stringify({
        type,
        data: { paymentId, storeId: "store-test" },
      }),
    })
  );
}

const postPaid = (paymentId: string) =>
  postEvent("Transaction.Paid", paymentId);

const confirm = async (plan: "starter" | "growth", key: string) => {
  const { confirmSubscription } = await import(
    "@/app/actions/billing/subscription"
  );
  return confirmSubscription(plan, key);
};

describe("post-charge webhook and re-entry [C1/P1-b]", () => {
  it.fails("P1-b [harm]: after the orphan first charge's Paid webhook, another plan confirm does not charge again", async () => {
    fixture.state.failNextActiveWrite = true;
    const first = await confirm("starter", "first-key");
    expect(first).toHaveProperty("error");
    expect(fixture.pay).toHaveBeenCalledTimes(1);
    const firstPaymentId = fixture.pay.mock.calls[0]?.[0].paymentId as string;

    const response = await postPaid(firstPaymentId);
    expect(response.status).toBe(200);
    expect(fixture.grant).toHaveBeenCalledWith(
      "user_owner-1",
      "starter",
      firstPaymentId
    );
    // The webhook must not schedule a renewal for an unrecorded first charge.
    expect(fixture.schedule).not.toHaveBeenCalled();
    expect(fixture.organization.billingStatus).toBe("trialing");

    const growth = await confirm("growth", "second-key");
    expect({
      chargeAttempts: fixture.pay.mock.calls.length,
      growth,
    }).toMatchObject({
      chargeAttempts: 1,
      growth: { error: expect.stringMatching(/복구|처리 중/) },
    });
  });

  it("R-dup control: replaying the first charge's Paid webhook adds no schedule", async () => {
    expect(await confirm("starter", "first-key")).toMatchObject({
      ok: true,
      renewalScheduled: true,
    });
    const firstPaymentId = fixture.pay.mock.calls[0]?.[0].paymentId as string;
    const nextPaymentId = fixture.organization.billingNextPaymentId;
    expect((await postPaid(firstPaymentId)).status).toBe(200);
    expect((await postPaid(firstPaymentId)).status).toBe(200);
    expect(fixture.pay).toHaveBeenCalledTimes(1);
    expect(fixture.schedule).toHaveBeenCalledTimes(1);
    expect(fixture.organization.billingNextPaymentId).toBe(nextPaymentId);
  });

  it.fails("O1: a Paid webhook for an unrecorded first charge raises an operator alert", async () => {
    fixture.state.failNextActiveWrite = true;
    expect(await confirm("starter", "first-key")).toHaveProperty("error");
    const firstPaymentId = fixture.pay.mock.calls[0]?.[0].paymentId as string;
    fixture.log.error.mockClear();
    fixture.log.warn.mockClear();

    expect((await postPaid(firstPaymentId)).status).toBe(200);
    expect(fixture.organization.billingStatus).toBe("trialing");
    expect(
      fixture.log.error.mock.calls.length + fixture.log.warn.mock.calls.length
    ).toBeGreaterThan(0);
  });

  it("O1 control: a normal one-off Paid grants without an alert", async () => {
    const { buildPaymentId } = await import("@repo/payments/catalog");
    const paymentId = buildPaymentId("starter", "user_owner-1");
    expect((await postPaid(paymentId)).status).toBe(200);
    expect(fixture.grant).toHaveBeenCalledWith(
      "user_owner-1",
      "starter",
      paymentId
    );
    expect(fixture.schedule).not.toHaveBeenCalled();
    expect(fixture.log.error).not.toHaveBeenCalled();
    expect(fixture.log.warn).not.toHaveBeenCalled();
  });

  it.fails("X6 [harm]: a renewal Paid without paidAt retried later re-schedules the same next id", async () => {
    expect(await confirm("starter", "stable-key")).toMatchObject({
      ok: true,
      renewalScheduled: true,
    });
    const renewalId = fixture.organization.billingNextPaymentId as string;
    fixture.getPayment.mockImplementation(async (paymentId: string) =>
      paidPayment(paymentId)
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T00:00:05.000Z"));
    fixture.state.failNextActiveWrite = true;
    expect((await postPaid(renewalId)).status).toBe(500);
    // PortOne retries the webhook minutes later.
    vi.setSystemTime(new Date("2026-11-04T00:07:00.000Z"));
    expect((await postPaid(renewalId)).status).toBe(200);
    const retriedIds = fixture.schedule.mock.calls
      .slice(1)
      .map(([input]) => input.paymentId);
    expect(retriedIds).toHaveLength(2);
    expect(new Set(retriedIds).size).toBe(1);
  });

  it("X12 control: a normal renewal Paid grants and schedules exactly once", async () => {
    expect(await confirm("starter", "renew-key")).toMatchObject({ ok: true });
    const renewalId = fixture.organization.billingNextPaymentId as string;
    expect((await postPaid(renewalId)).status).toBe(200);
    expect(fixture.grant).toHaveBeenCalledWith(
      "user_owner-1",
      "starter",
      renewalId
    );
    expect(fixture.schedule).toHaveBeenCalledTimes(2);
    expect(fixture.organization.billingLastPaymentId).toBe(renewalId);
  });

  it("X16 control: a partial cancel during Paid grant does not revoke", async () => {
    const { buildPaymentId } = await import("@repo/payments/catalog");
    const paymentId = buildPaymentId("starter", "user_owner-1");
    let lookups = 0;
    fixture.getPayment.mockImplementation((id: string) => {
      lookups += 1;
      return Promise.resolve({
        ...paidPayment(id, "2026-10-04T00:00:00.000Z"),
        status: lookups === 1 ? "PAID" : "PARTIAL_CANCELLED",
      });
    });
    const response = await postPaid(paymentId);
    expect(response.status).toBe(200);
    expect(fixture.grant).toHaveBeenCalledWith(
      "user_owner-1",
      "starter",
      paymentId
    );
    expect(fixture.revoke).not.toHaveBeenCalled();
  });

  // KNOWN RED (not fixed here): a full refund revokes the plan but leaves the
  // renewal schedule and billing key live; whether a refund also ends the
  // subscription is a separate policy decision.
  it.fails("X4 [known red]: a full refund webhook also cancels the next schedule and billing key", async () => {
    expect(await confirm("starter", "refund-key")).toMatchObject({ ok: true });
    const firstPaymentId = fixture.pay.mock.calls[0]?.[0].paymentId as string;
    fixture.getPayment.mockImplementation(async (id: string) => ({
      ...paidPayment(id, "2026-10-04T00:00:00.000Z"),
      status: "CANCELLED",
    }));
    expect(
      (await postEvent("Transaction.Cancelled", firstPaymentId)).status
    ).toBe(200);
    expect(fixture.revoke).toHaveBeenCalledWith("user_owner-1", firstPaymentId);
    expect(fixture.cancelSchedules).toHaveBeenCalledWith("refund-key");
    expect(fixture.deleteBillingKey).toHaveBeenCalledWith("refund-key");
  });

  // KNOWN RED (not fixed here): entitlement race, not a charge; needs a
  // durable refund fence (spike ledger) to close.
  it.fails("X8 [known red]: a Paid grant finishing after a refund revoke does not restore access", async () => {
    const { buildPaymentId } = await import("@repo/payments/catalog");
    const paymentId = buildPaymentId("starter", "user_owner-1");
    let cancelled = false;
    let releaseGrant: (() => void) | undefined;
    const grantBarrier = new Promise<void>((resolve) => {
      releaseGrant = resolve;
    });
    let entitlementPaymentId: string | null = null;
    fixture.getPayment.mockImplementation(async (id: string) => ({
      ...paidPayment(id, "2026-10-04T00:00:00.000Z"),
      status: cancelled ? "CANCELLED" : "PAID",
    }));
    fixture.grant.mockImplementation(async (_userId, _plan, id) => {
      await grantBarrier;
      entitlementPaymentId = id;
      return true;
    });
    fixture.revoke.mockImplementation(() => {
      entitlementPaymentId = null;
      return Promise.resolve({ revoked: true, reason: "revoked" });
    });
    const delayedPaid = postPaid(paymentId);
    await vi.waitFor(() => expect(fixture.grant).toHaveBeenCalledTimes(1));
    cancelled = true;
    expect((await postEvent("Transaction.Cancelled", paymentId)).status).toBe(
      200
    );
    releaseGrant?.();
    expect((await delayedPaid).status).toBe(200);
    expect(entitlementPaymentId).toBeNull();
  });
});
