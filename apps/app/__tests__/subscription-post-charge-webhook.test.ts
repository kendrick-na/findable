/**
 * Post-charge failure → real Paid/Cancelled webhook POST → another confirm.
 * Ported from spike/payment-ledger-safety-20261004
 * (subscription-post-charge-webhook-red.test.ts) and adapted to main.
 *
 * Signature, PortOne, DB, and Clerk are doubles; the action, webhook route,
 * parser, and catalog are real. Ledger-only cases (claims, attempts, shadow
 * tombstones, kill switch) are not ported because main has none of them.
 * @vitest-environment node
 */

import {
  amountForPlan,
  paymentIssuedAtFromPaymentId,
} from "@repo/payments/catalog";
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
  const state = { failNextActiveWrite: false, refundTableMissing: false };
  interface RefundRow {
    amount: number;
    kind: "full" | "partial";
    organizationId: string | null;
    paymentId: string;
    refundedAt: Date;
    userId: string;
  }
  const refunds = new Map<string, RefundRow>();
  const missingTable = () =>
    Object.assign(
      new Error("The table `public.PaymentRefund` does not exist"),
      { code: "P2021" }
    );
  const refundMatches = (
    row: RefundRow,
    where: Record<string, unknown>
  ): boolean =>
    Object.entries(where).every(([key, condition]) => {
      const value = row[key as keyof RefundRow];
      if (condition && typeof condition === "object" && "lt" in condition) {
        return (value as number) < (condition as { lt: number }).lt;
      }
      return value === condition;
    });
  const paymentRefund = {
    create: vi.fn(({ data }: { data: RefundRow }) => {
      if (state.refundTableMissing) {
        return Promise.reject(missingTable());
      }
      if (refunds.has(data.paymentId)) {
        return Promise.reject(
          Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          })
        );
      }
      refunds.set(data.paymentId, { ...data });
      return Promise.resolve({ ...data });
    }),
    updateMany: vi.fn(
      ({
        data,
        where,
      }: {
        data: Partial<RefundRow>;
        where: Record<string, unknown>;
      }) => {
        if (state.refundTableMissing) {
          return Promise.reject(missingTable());
        }
        let count = 0;
        for (const row of refunds.values()) {
          if (refundMatches(row, where)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      }
    ),
    findUnique: vi.fn(({ where }: { where: { paymentId: string } }) => {
      if (state.refundTableMissing) {
        return Promise.reject(missingTable());
      }
      const row = refunds.get(where.paymentId);
      return Promise.resolve(row ? { ...row } : null);
    }),
  };
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
    refunds,
    paymentRefund,
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
        organizationId: organization.id,
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
    paymentRefund: fixture.paymentRefund,
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

// PortOne always returns requestedAt; for our IDs it is the ID's issue time.
const paidPayment = (paymentId: string, paidAt?: string) => ({
  id: paymentId,
  storeId: "store-test",
  status: "PAID",
  currency: "KRW",
  amount: { total: STARTER_AMOUNT },
  requestedAt: paymentIssuedAtFromPaymentId(paymentId)?.toISOString(),
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
  fixture.state.refundTableMissing = false;
  fixture.refunds.clear();
  vi.clearAllMocks();
  fixture.cancelSchedules.mockImplementation(async () => undefined);
  fixture.deleteBillingKey.mockImplementation(async () => undefined);
  fixture.revoke.mockImplementation(async () => ({
    revoked: true,
    reason: "revoked",
  }));
  fixture.pay.mockImplementation(async () => undefined);
  fixture.grant.mockImplementation(async () => true);
  fixture.schedule.mockImplementation(async () => undefined);
  fixture.getPayment.mockImplementation(async (paymentId: string) =>
    paidPayment(paymentId, "2026-10-04T00:00:00.000Z")
  );
});

async function postEvent(
  type:
    | "Transaction.Paid"
    | "Transaction.Cancelled"
    | "Transaction.PartialCancelled",
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
  it("P1-b [harm]: after the orphan first charge's Paid webhook, another plan confirm does not charge again", async () => {
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

  it("O1: a Paid webhook for an unrecorded first charge raises an operator alert", async () => {
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

  it("X6 [harm]: a renewal Paid without paidAt retried later re-schedules the same next id", async () => {
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

  it("X4: a full refund webhook also cancels the next schedule and billing key", async () => {
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
    expect(fixture.cancelSchedules.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.deleteBillingKey.mock.invocationCallOrder[0] ?? 0
    );
    expect(fixture.organization).toMatchObject({
      billingStatus: "canceled",
      billingNextPaymentId: null,
      billingCustomerId: null,
      billingProvider: null,
      billingLastPaymentId: firstPaymentId,
    });
  });

  it("X4-dup: a duplicate full refund webhook is idempotent", async () => {
    expect(await confirm("starter", "refund-key")).toMatchObject({ ok: true });
    const firstPaymentId = fixture.pay.mock.calls[0]?.[0].paymentId as string;
    fixture.getPayment.mockImplementation(async (id: string) => ({
      ...paidPayment(id, "2026-10-04T00:00:00.000Z"),
      status: "CANCELLED",
    }));
    expect(
      (await postEvent("Transaction.Cancelled", firstPaymentId)).status
    ).toBe(200);
    const after = structuredClone(fixture.organization);
    expect(
      (await postEvent("Transaction.Cancelled", firstPaymentId)).status
    ).toBe(200);
    expect(fixture.cancelSchedules).toHaveBeenCalledTimes(1);
    expect(fixture.deleteBillingKey).toHaveBeenCalledTimes(1);
    expect(fixture.organization).toEqual(after);
  });

  it("X4-retry: a schedule-cancel failure returns 5xx, keeps the key, and the retry finishes cleanup", async () => {
    expect(await confirm("starter", "refund-key")).toMatchObject({ ok: true });
    const firstPaymentId = fixture.pay.mock.calls[0]?.[0].paymentId as string;
    const nextPaymentId = fixture.organization.billingNextPaymentId;
    fixture.getPayment.mockImplementation(async (id: string) => ({
      ...paidPayment(id, "2026-10-04T00:00:00.000Z"),
      status: "CANCELLED",
    }));
    fixture.cancelSchedules.mockRejectedValueOnce(new Error("portone 503"));
    expect(
      (await postEvent("Transaction.Cancelled", firstPaymentId)).status
    ).toBe(500);
    expect(fixture.log.error).toHaveBeenCalledWith(
      "payments.webhook.refund_cleanup_failed",
      expect.objectContaining({ paymentId: firstPaymentId })
    );
    // No half state: the key is not deleted and the org record still points at it.
    expect(fixture.deleteBillingKey).not.toHaveBeenCalled();
    expect(fixture.organization).toMatchObject({
      billingStatus: "active",
      billingCustomerId: "refund-key",
      billingNextPaymentId: nextPaymentId,
    });

    // PortOne re-sends the webhook.
    expect(
      (await postEvent("Transaction.Cancelled", firstPaymentId)).status
    ).toBe(200);
    expect(fixture.deleteBillingKey).toHaveBeenCalledWith("refund-key");
    expect(fixture.organization).toMatchObject({
      billingStatus: "canceled",
      billingNextPaymentId: null,
      billingCustomerId: null,
    });
  });

  it("X4 control: a partial cancel leaves the subscription untouched", async () => {
    expect(await confirm("starter", "partial-key")).toMatchObject({
      ok: true,
    });
    const firstPaymentId = fixture.pay.mock.calls[0]?.[0].paymentId as string;
    const before = structuredClone(fixture.organization);
    fixture.getPayment.mockImplementation(async (id: string) => ({
      ...paidPayment(id, "2026-10-04T00:00:00.000Z"),
      status: "PARTIAL_CANCELLED",
    }));
    expect(
      (await postEvent("Transaction.PartialCancelled", firstPaymentId)).status
    ).toBe(200);
    expect(fixture.revoke).not.toHaveBeenCalled();
    expect(fixture.cancelSchedules).not.toHaveBeenCalled();
    expect(fixture.deleteBillingKey).not.toHaveBeenCalled();
    expect(fixture.organization).toEqual(before);
  });

  it("X4 control: refunding a one-off payment revokes without touching billing", async () => {
    expect(await confirm("starter", "keep-key")).toMatchObject({ ok: true });
    const before = structuredClone(fixture.organization);
    const { buildPaymentId } = await import("@repo/payments/catalog");
    const oneOffId = buildPaymentId(
      "starter",
      "user_owner-1",
      Date.now() + 60_000
    );
    fixture.getPayment.mockImplementation(async (id: string) => ({
      ...paidPayment(id, "2026-10-04T00:00:00.000Z"),
      status: "CANCELLED",
    }));
    expect((await postEvent("Transaction.Cancelled", oneOffId)).status).toBe(
      200
    );
    expect(fixture.revoke).toHaveBeenCalledWith("user_owner-1", oneOffId);
    expect(fixture.cancelSchedules).not.toHaveBeenCalled();
    expect(fixture.organization).toEqual(before);
  });

  it("X8: a Paid grant finishing after a refund revoke does not restore access", async () => {
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

  it("X8-fence: a late Paid for a payment older than the recorded refund does not grant", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T00:00:00.000Z"));
    const { buildPaymentId } = await import("@repo/payments/catalog");
    const olderId = buildPaymentId("starter", "user_owner-1");
    vi.setSystemTime(new Date("2026-10-04T00:05:00.000Z"));
    expect(await confirm("starter", "fence-key")).toMatchObject({ ok: true });
    const refundedId = fixture.pay.mock.calls[0]?.[0].paymentId as string;
    fixture.getPayment.mockImplementation(async (id: string) => ({
      ...paidPayment(id, "2026-10-04T00:00:00.000Z"),
      status: id === refundedId ? "CANCELLED" : "PAID",
    }));
    expect((await postEvent("Transaction.Cancelled", refundedId)).status).toBe(
      200
    );
    fixture.grant.mockClear();

    expect((await postPaid(olderId)).status).toBe(200);
    expect(fixture.grant).not.toHaveBeenCalled();

    // A payment issued after the refund is a new purchase and still grants.
    vi.setSystemTime(new Date("2026-10-04T00:10:00.000Z"));
    const newerId = buildPaymentId("starter", "user_owner-1");
    expect((await postPaid(newerId)).status).toBe(200);
    expect(fixture.grant).toHaveBeenCalledWith(
      "user_owner-1",
      "starter",
      newerId
    );
  });

  it("X8 control: an unsubscribed (not refunded) org still grants a late older Paid", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T00:00:00.000Z"));
    const { buildPaymentId } = await import("@repo/payments/catalog");
    const olderId = buildPaymentId("starter", "user_owner-1");
    vi.setSystemTime(new Date("2026-10-04T00:05:00.000Z"));
    expect(await confirm("starter", "unsub-key")).toMatchObject({ ok: true });
    Object.assign(fixture.organization, {
      billingStatus: "canceled",
      billingCustomerId: null,
      billingProvider: null,
      billingNextPaymentId: null,
    });
    expect((await postPaid(olderId)).status).toBe(200);
    expect(fixture.grant).toHaveBeenCalledWith(
      "user_owner-1",
      "starter",
      olderId
    );
  });
});

const cancelledPayment = (
  paymentId: string,
  overrides: Record<string, unknown> = {}
) => ({
  ...paidPayment(paymentId, "2026-10-04T00:00:00.000Z"),
  status: "CANCELLED",
  amount: { total: STARTER_AMOUNT, cancelled: STARTER_AMOUNT },
  cancelledAt: "2026-10-04T01:00:00.000Z",
  ...overrides,
});

describe("durable PaymentRefund record [R]", () => {
  it("R1: a full refund webhook writes one record, and a duplicate does not add or change it", async () => {
    expect(await confirm("starter", "rec-key")).toMatchObject({ ok: true });
    const paymentId = fixture.pay.mock.calls[0]?.[0].paymentId as string;
    fixture.getPayment.mockImplementation(async (id: string) =>
      cancelledPayment(id)
    );
    expect((await postEvent("Transaction.Cancelled", paymentId)).status).toBe(
      200
    );
    expect(fixture.refunds.get(paymentId)).toEqual({
      paymentId,
      organizationId: "org-1",
      userId: "user_owner-1",
      amount: STARTER_AMOUNT,
      kind: "full",
      refundedAt: new Date("2026-10-04T01:00:00.000Z"),
    });
    const first = structuredClone(fixture.refunds.get(paymentId));
    expect((await postEvent("Transaction.Cancelled", paymentId)).status).toBe(
      200
    );
    expect(fixture.refunds.size).toBe(1);
    expect(fixture.refunds.get(paymentId)).toEqual(first);
  });

  it("R2: a partial cancel writes a partial record and a later full refund promotes it", async () => {
    const { buildPaymentId } = await import("@repo/payments/catalog");
    const paymentId = buildPaymentId("starter", "user_owner-1");
    fixture.getPayment.mockImplementation(async (id: string) =>
      cancelledPayment(id, {
        status: "PARTIAL_CANCELLED",
        amount: { total: STARTER_AMOUNT, cancelled: 1000 },
        cancelledAt: "2026-10-04T00:30:00.000Z",
      })
    );
    expect(
      (await postEvent("Transaction.PartialCancelled", paymentId)).status
    ).toBe(200);
    expect(fixture.refunds.get(paymentId)).toMatchObject({
      kind: "partial",
      amount: 1000,
    });
    // A partial cancel never revokes.
    expect(fixture.revoke).not.toHaveBeenCalled();

    fixture.getPayment.mockImplementation(async (id: string) =>
      cancelledPayment(id)
    );
    expect((await postEvent("Transaction.Cancelled", paymentId)).status).toBe(
      200
    );
    expect(fixture.refunds.size).toBe(1);
    expect(fixture.refunds.get(paymentId)).toMatchObject({
      kind: "full",
      amount: STARTER_AMOUNT,
      refundedAt: new Date("2026-10-04T01:00:00.000Z"),
    });

    // A stale partial webhook replayed after the full refund does not demote it.
    fixture.getPayment.mockImplementation(async (id: string) =>
      cancelledPayment(id, {
        status: "PARTIAL_CANCELLED",
        amount: { total: STARTER_AMOUNT, cancelled: 1000 },
      })
    );
    expect(
      (await postEvent("Transaction.PartialCancelled", paymentId)).status
    ).toBe(200);
    expect(fixture.refunds.get(paymentId)).toMatchObject({
      kind: "full",
      amount: STARTER_AMOUNT,
    });
  });

  it("R3: the late-Paid fence trusts the record and skips the live PortOne lookup", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T00:00:00.000Z"));
    const { buildPaymentId } = await import("@repo/payments/catalog");
    const olderId = buildPaymentId("starter", "user_owner-1");
    vi.setSystemTime(new Date("2026-10-04T00:05:00.000Z"));
    expect(await confirm("starter", "fence-key")).toMatchObject({ ok: true });
    const refundedId = fixture.pay.mock.calls[0]?.[0].paymentId as string;
    fixture.getPayment.mockImplementation(async (id: string) =>
      id === refundedId ? cancelledPayment(id) : paidPayment(id)
    );
    expect((await postEvent("Transaction.Cancelled", refundedId)).status).toBe(
      200
    );
    fixture.grant.mockClear();
    fixture.getPayment.mockClear();

    expect((await postPaid(olderId)).status).toBe(200);
    expect(fixture.grant).not.toHaveBeenCalled();
    expect(fixture.getPayment.mock.calls.map(([id]) => id)).not.toContain(
      refundedId
    );
  });

  it("R4: the record fences a late older Paid even while the subscription cleanup is still failing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T00:00:00.000Z"));
    const { buildPaymentId } = await import("@repo/payments/catalog");
    const olderId = buildPaymentId("starter", "user_owner-1");
    vi.setSystemTime(new Date("2026-10-04T00:05:00.000Z"));
    expect(await confirm("starter", "fence-key")).toMatchObject({ ok: true });
    const refundedId = fixture.pay.mock.calls[0]?.[0].paymentId as string;
    fixture.getPayment.mockImplementation(async (id: string) =>
      id === refundedId ? cancelledPayment(id) : paidPayment(id)
    );
    fixture.cancelSchedules.mockRejectedValueOnce(new Error("portone 503"));
    expect((await postEvent("Transaction.Cancelled", refundedId)).status).toBe(
      500
    );
    // Cleanup failed: the org still looks active, but the refund is a fact.
    expect(fixture.organization.billingStatus).toBe("active");
    expect(fixture.refunds.get(refundedId)?.kind).toBe("full");
    fixture.grant.mockClear();

    expect((await postPaid(olderId)).status).toBe(200);
    expect(fixture.grant).not.toHaveBeenCalled();
  });

  it("R5: a Paid whose refund was recorded mid-grant is undone even if PortOne still reads PAID", async () => {
    const { buildPaymentId } = await import("@repo/payments/catalog");
    const paymentId = buildPaymentId("starter", "user_owner-1");
    fixture.grant.mockImplementation(() => {
      fixture.refunds.set(paymentId, {
        paymentId,
        organizationId: "org-1",
        userId: "user_owner-1",
        amount: STARTER_AMOUNT,
        kind: "full",
        refundedAt: new Date("2026-10-04T01:00:00.000Z"),
      });
      return Promise.resolve(true);
    });
    expect((await postPaid(paymentId)).status).toBe(200);
    expect(fixture.revoke).toHaveBeenCalledWith("user_owner-1", paymentId);
    expect(fixture.schedule).not.toHaveBeenCalled();
  });

  it("R6: without the table, refunds and fences behave as before and the gap is logged once", async () => {
    vi.resetModules();
    fixture.state.refundTableMissing = true;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T00:00:00.000Z"));
    const { buildPaymentId } = await import("@repo/payments/catalog");
    const olderId = buildPaymentId("starter", "user_owner-1");
    vi.setSystemTime(new Date("2026-10-04T00:05:00.000Z"));
    expect(await confirm("starter", "fence-key")).toMatchObject({ ok: true });
    const refundedId = fixture.pay.mock.calls[0]?.[0].paymentId as string;
    fixture.getPayment.mockImplementation(async (id: string) =>
      id === refundedId ? cancelledPayment(id) : paidPayment(id)
    );
    expect((await postEvent("Transaction.Cancelled", refundedId)).status).toBe(
      200
    );
    expect(fixture.organization).toMatchObject({
      billingStatus: "canceled",
      billingCustomerId: null,
    });
    fixture.grant.mockClear();
    // Fence falls back to org status + live lookup.
    expect((await postPaid(olderId)).status).toBe(200);
    expect(fixture.grant).not.toHaveBeenCalled();
    expect(fixture.getPayment.mock.calls.map(([id]) => id)).toContain(
      refundedId
    );
    expect((await postEvent("Transaction.Cancelled", refundedId)).status).toBe(
      200
    );
    const missingWarnings = fixture.log.warn.mock.calls.filter(
      ([event]) => event === "payments.refund_record.table_missing"
    );
    expect(missingWarnings).toHaveLength(1);
    expect(fixture.log.error).not.toHaveBeenCalled();
  });
});

describe("renewal scheduling does not overwrite a concurrent change [P2-1]", () => {
  it("P2-1: an unsubscribe during renewal scheduling stays canceled and the new schedule is cancelled", async () => {
    expect(await confirm("starter", "race-key")).toMatchObject({ ok: true });
    const renewalId = fixture.organization.billingNextPaymentId as string;
    fixture.schedule.mockImplementationOnce(() => {
      // unsubscribe() lands while PortOne is creating the next schedule.
      Object.assign(fixture.organization, {
        billingStatus: "canceled",
        billingCustomerId: null,
        billingProvider: null,
        billingNextPaymentId: null,
      });
      return Promise.resolve(undefined);
    });
    expect((await postPaid(renewalId)).status).toBe(200);
    expect(fixture.organization).toMatchObject({
      billingStatus: "canceled",
      billingCustomerId: null,
      billingNextPaymentId: null,
    });
    expect(fixture.cancelSchedules).toHaveBeenCalledWith("race-key");
  });

  it("P2-1 control: a duplicate Paid that already advanced the cycle does not cancel the schedule", async () => {
    expect(await confirm("starter", "dup-key")).toMatchObject({ ok: true });
    const renewalId = fixture.organization.billingNextPaymentId as string;
    let advancedTo: string | null = null;
    fixture.schedule.mockImplementationOnce((input: { paymentId: string }) => {
      // A concurrent delivery of the same Paid already recorded this cycle.
      advancedTo = input.paymentId;
      Object.assign(fixture.organization, {
        billingLastPaymentId: renewalId,
        billingNextPaymentId: input.paymentId,
      });
      return Promise.resolve(undefined);
    });
    expect((await postPaid(renewalId)).status).toBe(200);
    expect(fixture.cancelSchedules).not.toHaveBeenCalled();
    expect(fixture.organization).toMatchObject({
      billingStatus: "active",
      billingCustomerId: "dup-key",
      billingNextPaymentId: advancedTo,
    });
  });
});
