/**
 * P1-1: a browser can edit the paymentId (base36 time tail, plan segment)
 * before requestPayment. The grant paths must reject IDs that do not match
 * the exact buildPaymentId format, the paid plan, the session user, and
 * PortOne's requestedAt (±15 min). Server-recorded subscription IDs are
 * exempt from the time check. Unparseable payment grants count as expired.
 * @vitest-environment node
 */

import { amountForPlan, buildPaymentId } from "@repo/payments/catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const MINUTE = 60 * 1000;
const USER_ID = "user_buyer-1";
const STARTER = amountForPlan("starter") ?? 0;

const fixture = vi.hoisted(() => ({
  grant: vi.fn(async () => true),
  revoke: vi.fn(async () => ({ revoked: true, reason: "revoked" })),
  getPayment: vi.fn(),
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  org: {
    id: "org-1",
    billingStatus: "trialing",
    billingCustomerId: null as string | null,
    billingProvider: null as string | null,
    billingLastPaymentId: null as string | null,
    billingNextPaymentId: null as string | null,
  },
}));

vi.mock("@repo/auth/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_buyer-1", orgId: "org-1" })),
  currentUser: vi.fn(async () => null),
}));
vi.mock("@repo/auth/plan-grant", () => ({
  grantPlanFromPayment: fixture.grant,
  revokePlanFromPayment: fixture.revoke,
}));
vi.mock("@repo/database", () => ({
  database: {
    organization: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => ({ ...fixture.org })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    user: {
      findUnique: vi.fn(async () => ({
        email: "buyer@example.invalid",
        name: "Buyer",
        organizationId: "org-1",
        organization: { ...fixture.org },
      })),
    },
    paymentRefund: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));
vi.mock("@repo/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/payments")>();
  return {
    ...actual,
    verifyWebhookSignature: vi.fn(() => ({ ok: true })),
    getPortOnePayment: fixture.getPayment,
    schedulePaymentWithBillingKey: vi.fn(async () => undefined),
  };
});
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@repo/observability/error", () => ({ parseError: String }));
vi.mock("@repo/observability/log", () => ({ log: fixture.log }));

const paid = (
  id: string,
  requestedAt: Date | null,
  amount = STARTER
): Record<string, unknown> => ({
  id,
  storeId: "store-test",
  status: "PAID",
  currency: "KRW",
  amount: { total: amount },
  ...(requestedAt ? { requestedAt: requestedAt.toISOString() } : {}),
  paidAt: NOW.toISOString(),
});

/** Same uid and plan, but the time tail moved far into the future. */
const forgedTail = (minutesAhead: number) =>
  buildPaymentId("starter", USER_ID, NOW.getTime() + minutesAhead * MINUTE);

async function postPaid(paymentId: string) {
  const { POST } = await import("@/app/webhooks/payments/route");
  return POST(
    new Request("http://localhost/webhooks/payments", {
      method: "POST",
      body: JSON.stringify({ type: "Transaction.Paid", data: { paymentId } }),
    })
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  Object.assign(fixture.org, {
    billingStatus: "trialing",
    billingCustomerId: null,
    billingProvider: null,
    billingLastPaymentId: null,
    billingNextPaymentId: null,
  });
});

describe("checkPaymentIdIntegrity [P1-1]", () => {
  it("accepts an exact server-built ID near requestedAt, rejects edits", async () => {
    const { checkPaymentIdIntegrity } = await import("@repo/payments/catalog");
    const good = buildPaymentId("starter", USER_ID, NOW.getTime());
    const at = new Date(NOW.getTime() + 2 * MINUTE).toISOString();
    expect(
      checkPaymentIdIntegrity(good, { plan: "starter", requestedAt: at })
    ).toEqual({ ok: true });
    expect(
      checkPaymentIdIntegrity(good, { plan: "growth", requestedAt: at })
    ).toEqual({ ok: false, reason: "plan_mismatch" });
    expect(
      checkPaymentIdIntegrity(forgedTail(60 * 24 * 365 * 50), {
        plan: "starter",
        requestedAt: at,
      })
    ).toEqual({ ok: false, reason: "time_mismatch" });
    expect(
      checkPaymentIdIntegrity(`${good}x`, { plan: "starter", requestedAt: at })
    ).toMatchObject({ ok: false });
    expect(
      checkPaymentIdIntegrity(good.replace("-starter-", "-Starter-"), {
        plan: "starter",
        requestedAt: at,
      })
    ).toEqual({ ok: false, reason: "malformed" });
    expect(
      checkPaymentIdIntegrity(good, {
        plan: "starter",
        userId: "user_other",
        requestedAt: at,
      })
    ).toEqual({ ok: false, reason: "user_mismatch" });
  });

  it("falls back to paidAt, and fails closed with neither", async () => {
    const { checkPaymentIdIntegrity } = await import("@repo/payments/catalog");
    const good = buildPaymentId("starter", USER_ID, NOW.getTime());
    expect(
      checkPaymentIdIntegrity(good, {
        plan: "starter",
        paidAt: new Date(NOW.getTime() + 10 * MINUTE).toISOString(),
      })
    ).toEqual({ ok: true });
    expect(
      checkPaymentIdIntegrity(good, {
        plan: "starter",
        paidAt: new Date(NOW.getTime() + 20 * MINUTE).toISOString(),
      })
    ).toEqual({ ok: false, reason: "time_mismatch" });
    expect(checkPaymentIdIntegrity(good, { plan: "starter" })).toEqual({
      ok: false,
      reason: "no_reference_time",
    });
  });
});

describe("verifyPaymentAndGrant rejects edited IDs [P1-1]", () => {
  it("does not grant a payment whose time tail was edited", async () => {
    const forged = forgedTail(60 * 24 * 365 * 50);
    fixture.getPayment.mockImplementation(async (id: string) => paid(id, NOW));
    const { verifyPaymentAndGrant } = await import(
      "@/app/actions/billing/checkout"
    );
    expect(await verifyPaymentAndGrant(forged)).toHaveProperty("error");
    expect(fixture.grant).not.toHaveBeenCalled();
    expect(fixture.log.error).toHaveBeenCalledWith(
      "billing.verify.payment_id_mismatch",
      expect.objectContaining({ reason: "time_mismatch" })
    );
  });

  it("does not grant when the plan segment disagrees with the paid amount", async () => {
    const forged = buildPaymentId("scale", USER_ID, NOW.getTime());
    fixture.getPayment.mockImplementation(async (id: string) => paid(id, NOW));
    const { verifyPaymentAndGrant } = await import(
      "@/app/actions/billing/checkout"
    );
    expect(await verifyPaymentAndGrant(forged)).toHaveProperty("error");
    expect(fixture.grant).not.toHaveBeenCalled();
  });

  it("does not accept another user's uid embedded as a substring", async () => {
    const other = buildPaymentId("starter", "user_buyer-1x", NOW.getTime());
    fixture.getPayment.mockImplementation(async (id: string) => paid(id, NOW));
    const { verifyPaymentAndGrant } = await import(
      "@/app/actions/billing/checkout"
    );
    expect(await verifyPaymentAndGrant(other)).toHaveProperty("error");
    expect(fixture.getPayment).not.toHaveBeenCalled();
  });

  it("control: a genuine payment still grants", async () => {
    const good = buildPaymentId("starter", USER_ID, NOW.getTime() - MINUTE);
    fixture.getPayment.mockImplementation(async (id: string) => paid(id, NOW));
    const { verifyPaymentAndGrant } = await import(
      "@/app/actions/billing/checkout"
    );
    expect(await verifyPaymentAndGrant(good)).toMatchObject({
      ok: true,
      plan: "starter",
    });
    expect(fixture.grant).toHaveBeenCalledWith(USER_ID, "starter", good);
  });
});

describe("Paid webhook rejects edited IDs [P1-1]", () => {
  it("does not grant a one-off payment whose time tail was edited", async () => {
    const forged = forgedTail(60 * 24 * 365 * 50);
    fixture.getPayment.mockImplementation(async (id: string) => paid(id, NOW));
    const response = await postPaid(forged);
    expect(response.status).toBe(200);
    expect(fixture.grant).not.toHaveBeenCalled();
    expect(fixture.log.error).toHaveBeenCalledWith(
      "payments.webhook.payment_id_mismatch",
      expect.objectContaining({ reason: "time_mismatch" })
    );
  });

  it("control: a server-scheduled renewal grants even if requestedAt is the schedule time a month earlier", async () => {
    const renewalId = buildPaymentId("starter", USER_ID, NOW.getTime());
    Object.assign(fixture.org, {
      billingStatus: "active",
      billingCustomerId: "key-1",
      billingProvider: "portone",
      billingNextPaymentId: renewalId,
    });
    fixture.getPayment.mockImplementation(async (id: string) =>
      paid(id, new Date(NOW.getTime() - 31 * 24 * 60 * MINUTE))
    );
    expect((await postPaid(renewalId)).status).toBe(200);
    expect(fixture.grant).toHaveBeenCalledWith(USER_ID, "starter", renewalId);
  });
});

describe("isPaidPeriodOver treats unparseable payment grants as expired [P1-1]", () => {
  it("unparseable and far-future IDs are expired; null-sourced grants are untouched", async () => {
    const { isPaidPeriodOver } = await import("@/lib/billing/renewal-grace");
    const { paymentGrantAfterExpiry } = await vi.importActual<
      typeof import("@repo/auth/plan-grant")
    >("@repo/auth/plan-grant");
    expect(isPaidPeriodOver("partner-grant", NOW)).toBe(true);
    expect(isPaidPeriodOver(forgedTail(60 * 24 * 365 * 50), NOW)).toBe(true);
    expect(
      isPaidPeriodOver(buildPaymentId("starter", USER_ID, NOW.getTime()), NOW)
    ).toBe(false);

    // A partner/legacy grant (paymentId null) stays.
    const kept = paymentGrantAfterExpiry(
      "growth",
      {
        findablePaymentId: null,
        findablePaymentGrantStack: [{ paymentId: null, plan: "growth" }],
      },
      (id) => isPaidPeriodOver(id, NOW)
    );
    expect(kept).toMatchObject({ plan: "growth", expired: false });
  });
});
