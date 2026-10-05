/**
 * P1-2 / P1-3: refunding a renewal must end paid access by the next cron run.
 *
 * Real: payments webhook route, plan-grant (Clerk mocked as an in-memory
 * user), expireCancelledSubscriptions. Doubles: PortOne, DB.
 * @vitest-environment node
 */

import { nextBillingDate } from "@repo/payments/billing-cycle";
import {
  amountForPlan,
  buildPaymentId,
  paymentIssuedAtFromPaymentId,
} from "@repo/payments/catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STARTER = amountForPlan("starter") ?? 0;
const USER_ID = "user_sub-1";
const FIRST_AT = new Date("2026-09-01T00:00:00.000Z");
const RENEWAL_AT = nextBillingDate(FIRST_AT); // 2026-10-01
const NEXT_AT = nextBillingDate(RENEWAL_AT); // 2026-11-01
const REFUND_AT = new Date("2026-10-05T00:00:00.000Z");
const FIRST_ID = buildPaymentId("starter", USER_ID, FIRST_AT.getTime());
const RENEWAL_ID = buildPaymentId("starter", USER_ID, RENEWAL_AT.getTime());
const NEXT_ID = buildPaymentId("starter", USER_ID, NEXT_AT.getTime());

const fx = vi.hoisted(() => {
  const org: Record<string, unknown> = {};
  const clerk = {
    publicMetadata: {} as Record<string, unknown>,
    privateMetadata: {} as Record<string, unknown>,
  };
  const cond = (value: unknown, condition: unknown): boolean => {
    if (
      condition &&
      typeof condition === "object" &&
      !(condition instanceof Date)
    ) {
      const c = condition as Record<string, unknown>;
      if ("not" in c) {
        return value !== c.not;
      }
      if ("lte" in c) {
        return value instanceof Date && value <= (c.lte as Date);
      }
      if ("gt" in c) {
        return value instanceof Date && value > (c.gt as Date);
      }
      throw new Error("unsupported operator");
    }
    if (condition instanceof Date) {
      return value instanceof Date && value.getTime() === condition.getTime();
    }
    return value === condition;
  };
  const matches = (where: Record<string, unknown>) =>
    Object.entries(where).every(([key, condition]) =>
      cond(org[key], condition)
    );
  return {
    org,
    clerk,
    matches,
    getPayment: vi.fn(),
    cancelSchedules: vi.fn(async () => undefined),
    deleteBillingKey: vi.fn(async () => undefined),
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  };
});

vi.mock("@repo/database", () => ({
  database: {
    organization: {
      findFirst: vi.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(fx.matches(where) ? { ...fx.org } : null)
      ),
      findMany: vi.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(fx.matches(where) ? [{ ...fx.org }] : [])
      ),
      updateMany: vi.fn(
        ({
          data,
          where,
        }: {
          data: Record<string, unknown>;
          where: Record<string, unknown>;
        }) => {
          if (!fx.matches(where)) {
            return Promise.resolve({ count: 0 });
          }
          Object.assign(fx.org, data);
          return Promise.resolve({ count: 1 });
        }
      ),
    },
    user: {
      findUnique: vi.fn(async () => ({
        organizationId: "org-1",
        organization: { ...fx.org },
      })),
    },
    paymentRefund: {
      create: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));
vi.mock(
  "../../../packages/auth/node_modules/@clerk/nextjs/dist/esm/server/index.js",
  () => ({
    auth: vi.fn(),
    currentUser: vi.fn(),
    clerkClient: vi.fn(async () => ({
      users: {
        getUser: vi.fn(async () => ({
          id: USER_ID,
          publicMetadata: structuredClone(fx.clerk.publicMetadata),
          privateMetadata: structuredClone(fx.clerk.privateMetadata),
        })),
        updateUserMetadata: vi.fn(
          (
            _id: string,
            patch: {
              privateMetadata: Record<string, unknown>;
              publicMetadata: Record<string, unknown>;
            }
          ) => {
            Object.assign(fx.clerk.publicMetadata, patch.publicMetadata);
            Object.assign(fx.clerk.privateMetadata, patch.privateMetadata);
            return Promise.resolve({});
          }
        ),
      },
    })),
  })
);
vi.mock("@repo/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/payments")>();
  return {
    ...actual,
    verifyWebhookSignature: vi.fn(() => ({ ok: true })),
    getPortOnePayment: fx.getPayment,
    cancelBillingKeySchedules: fx.cancelSchedules,
    deleteBillingKey: fx.deleteBillingKey,
  };
});
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@repo/observability/error", () => ({ parseError: String }));
vi.mock("@repo/observability/log", () => ({ log: fx.log }));

const cancelled = (id: string) => ({
  id,
  storeId: "store-test",
  status: "CANCELLED",
  currency: "KRW",
  amount: { total: STARTER, cancelled: STARTER },
  requestedAt: paymentIssuedAtFromPaymentId(id)?.toISOString(),
  cancelledAt: REFUND_AT.toISOString(),
});

async function postCancelled(paymentId: string) {
  const { POST } = await import("@/app/webhooks/payments/route");
  return POST(
    new Request("http://localhost/webhooks/payments", {
      method: "POST",
      body: JSON.stringify({
        type: "Transaction.Cancelled",
        data: { paymentId },
      }),
    })
  );
}

/** First month + one renewal granted: stack [renewal, first, free]. */
function seedRenewedSubscriber(org: Record<string, unknown>) {
  for (const key of Object.keys(fx.org)) {
    delete fx.org[key];
  }
  Object.assign(fx.org, {
    id: "org-1",
    billingStatus: "active",
    billingProvider: "portone",
    billingCustomerId: "key-1",
    ...org,
  });
  fx.clerk.publicMetadata = { plan: "starter" };
  fx.clerk.privateMetadata = {
    findablePaymentId: RENEWAL_ID,
    findablePaymentGrantStack: [
      { paymentId: RENEWAL_ID, plan: "starter" },
      { paymentId: FIRST_ID, plan: "starter" },
      { paymentId: null, plan: "free" },
    ],
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(REFUND_AT);
  vi.clearAllMocks();
  fx.getPayment.mockImplementation(async (id: string) => cancelled(id));
});

describe("refunded renewal ends paid access [P1-2/P1-3]", () => {
  it("P1-2: refunding the current renewal ends access by the next cron run", async () => {
    seedRenewedSubscriber({
      billingLastPaymentId: RENEWAL_ID,
      billingNextPaymentId: NEXT_ID,
      billingNextPaymentAt: NEXT_AT,
    });
    expect((await postCancelled(RENEWAL_ID)).status).toBe(200);
    // The refunded renewal's grant is gone, but it fell back to the first month.
    expect(fx.org).toMatchObject({ billingStatus: "canceled" });

    const { expireCancelledSubscriptions } = await import(
      "@/lib/billing/period-end-expiry"
    );
    const cronAt = new Date(REFUND_AT.getTime() + 30 * 60 * 1000);
    vi.setSystemTime(cronAt);
    const result = await expireCancelledSubscriptions(cronAt);
    expect(result.expired).toBe(1);
    expect(fx.clerk.publicMetadata.plan).toBe("free");
    expect(fx.org.billingStatus).toBe("expired");
  });

  it("P1-2: a duplicate refund webhook does not move the period end again", async () => {
    seedRenewedSubscriber({
      billingLastPaymentId: RENEWAL_ID,
      billingNextPaymentId: NEXT_ID,
      billingNextPaymentAt: NEXT_AT,
    });
    expect((await postCancelled(RENEWAL_ID)).status).toBe(200);
    const after = structuredClone(fx.org);
    vi.setSystemTime(new Date(REFUND_AT.getTime() + 60_000));
    expect((await postCancelled(RENEWAL_ID)).status).toBe(200);
    expect(fx.org).toEqual(after);
  });

  it("P1-2: refunding after an unsubscribe also ends the refunded month", async () => {
    seedRenewedSubscriber({
      billingStatus: "canceled",
      billingProvider: null,
      billingCustomerId: null,
      billingLastPaymentId: RENEWAL_ID,
      billingNextPaymentId: null,
      billingNextPaymentAt: NEXT_AT,
    });
    expect((await postCancelled(RENEWAL_ID)).status).toBe(200);
    const { expireCancelledSubscriptions } = await import(
      "@/lib/billing/period-end-expiry"
    );
    const cronAt = new Date(REFUND_AT.getTime() + 30 * 60 * 1000);
    expect((await expireCancelledSubscriptions(cronAt)).expired).toBe(1);
    expect(fx.clerk.publicMetadata.plan).toBe("free");
  });

  it("P1-3: refunding a renewal whose Paid webhook never finished still ends the subscription", async () => {
    // The renewal charged, but its Paid webhook never recorded it as last.
    seedRenewedSubscriber({
      billingLastPaymentId: FIRST_ID,
      billingNextPaymentId: RENEWAL_ID,
      billingNextPaymentAt: RENEWAL_AT,
    });
    fx.getPayment.mockImplementation(async (id: string) => ({
      ...cancelled(id),
      paidAt: RENEWAL_AT.toISOString(),
    }));
    expect((await postCancelled(RENEWAL_ID)).status).toBe(200);
    expect(fx.cancelSchedules).toHaveBeenCalledWith("key-1");
    expect(fx.deleteBillingKey).toHaveBeenCalledWith("key-1");
    expect(fx.org).toMatchObject({
      billingStatus: "canceled",
      billingCustomerId: null,
      billingNextPaymentId: null,
    });
    const { expireCancelledSubscriptions } = await import(
      "@/lib/billing/period-end-expiry"
    );
    const cronAt = new Date(REFUND_AT.getTime() + 30 * 60 * 1000);
    expect((await expireCancelledSubscriptions(cronAt)).expired).toBe(1);
    expect(fx.clerk.publicMetadata.plan).toBe("free");
  });

  it("P1-3 control: a cancelled next payment that was never paid leaves the subscription alone", async () => {
    seedRenewedSubscriber({
      billingLastPaymentId: RENEWAL_ID,
      billingNextPaymentId: NEXT_ID,
      billingNextPaymentAt: NEXT_AT,
    });
    const before = structuredClone(fx.org);
    expect((await postCancelled(NEXT_ID)).status).toBe(200);
    expect(fx.cancelSchedules).not.toHaveBeenCalled();
    expect(fx.org).toEqual(before);
  });
});
