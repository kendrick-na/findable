/**
 * R4 — a second plan started during an active subscription must not leave two
 * future charges. Ported from spike/payment-ledger-safety-20261004
 * (subscription-duplicate-schedule-red.test.ts) and adapted to main.
 * Real subscription actions; DB and PortOne are in-memory doubles.
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmSubscription,
  unsubscribe,
} from "@/app/actions/billing/subscription";

const fixture = vi.hoisted(() => {
  const organization: Record<string, unknown> = {
    id: "org-1",
    ownerId: "user_buyer-1",
    billingCustomerId: null,
    billingProvider: null,
    billingStatus: "trialing",
    billingLastPaymentId: null,
    billingNextPaymentId: null,
    billingNextPaymentAt: null,
  };
  const schedules: Array<{ billingKey: string; paymentId: string }> = [];
  let sequence = 0;
  return {
    organization,
    schedules,
    paid: vi.fn((input: { billingKey: string; paymentId: string }) =>
      Promise.resolve(input)
    ),
    buildPaymentId: vi.fn((plan: string, userId: string, at?: number) => {
      sequence += 1;
      const issued = at ?? Date.now() + sequence;
      return `fdbl-${plan}-${userId.replace(/^user_/, "")}-${issued.toString(36)}`;
    }),
    scheduled: vi.fn((input: { billingKey: string; paymentId: string }) => {
      if (schedules.some((item) => item.paymentId === input.paymentId)) {
        throw new Error("PAYMENT_SCHEDULE_ALREADY_EXISTS");
      }
      schedules.push({
        billingKey: input.billingKey,
        paymentId: input.paymentId,
      });
      return Promise.resolve();
    }),
    canceled: vi.fn((billingKey: string) => {
      // PortOne V2 DELETE /payment-schedules is scoped to one billing key.
      for (let index = schedules.length - 1; index >= 0; index -= 1) {
        if (schedules[index]?.billingKey === billingKey) {
          schedules.splice(index, 1);
        }
      }
      return Promise.resolve();
    }),
    deleted: vi.fn((_billingKey: string) => Promise.resolve()),
    update: vi.fn(
      ({
        data,
        where,
      }: {
        data: Record<string, unknown>;
        where: { id: string };
      }) => {
        if (where.id !== organization.id) {
          throw new Error("wrong organization update");
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
        for (const [key, condition] of Object.entries(where)) {
          if (!(key in organization)) {
            throw new Error(`unsupported condition: ${key}`);
          }
          if (condition && typeof condition === "object") {
            throw new Error(`unsupported operator: ${key}`);
          }
          if (organization[key] !== condition) {
            return Promise.resolve({ count: 0 });
          }
        }
        Object.assign(organization, data);
        return Promise.resolve({ count: 1 });
      }
    ),
  };
});

vi.mock("@repo/auth/server", () => ({
  auth: vi.fn(async () => ({
    userId: "user_buyer-1",
    orgId: "org-1",
    has: () => false,
  })),
  currentUser: vi.fn(async () => ({ firstName: "Test", lastName: "Buyer" })),
}));
vi.mock("@repo/auth/plan-grant", () => ({
  grantPlanFromPayment: vi.fn(async () => true),
}));
vi.mock("@repo/database", () => ({
  database: {
    organization: {
      update: fixture.update,
      updateMany: fixture.updateMany,
      findUnique: vi.fn(
        ({
          select,
          where,
        }: {
          select?: Record<string, boolean>;
          where: { id: string };
        }) => {
          if (where.id !== fixture.organization.id) {
            return Promise.resolve(null);
          }
          if (!select) {
            return Promise.resolve(structuredClone(fixture.organization));
          }
          const row = fixture.organization;
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
    cancelBillingKeySchedules: fixture.canceled,
    deleteBillingKey: fixture.deleted,
    getPortOnePayment: vi.fn(() =>
      Promise.reject(new Error("no PortOne lookup expected"))
    ),
    isPortOneConfigured: vi.fn(() => true),
    payWithBillingKey: fixture.paid,
    schedulePaymentWithBillingKey: fixture.scheduled,
  };
});
vi.mock("@/lib/db/ensure-org", () => ({
  ensureOrgExists: vi.fn(async () => "org-1"),
}));
vi.mock("@repo/observability/error", () => ({ parseError: String }));
vi.mock("@repo/observability/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

beforeEach(() => {
  Object.assign(fixture.organization, {
    billingCustomerId: null,
    billingProvider: null,
    billingStatus: "trialing",
    billingLastPaymentId: null,
    billingNextPaymentId: null,
    billingNextPaymentAt: null,
  });
  fixture.schedules.splice(0);
  vi.clearAllMocks();
});

describe("duplicate subscription schedule [R4 harm]", () => {
  it("a Growth request during Starter is refused before charging and leaves one schedule", async () => {
    expect(await confirmSubscription("starter", "starter-key")).toMatchObject({
      ok: true,
      plan: "starter",
      renewalScheduled: true,
    });
    const second = await confirmSubscription("growth", "growth-key");
    expect({
      second,
      charges: fixture.paid.mock.calls.length,
      scheduledKeys: fixture.schedules.map((item) => item.billingKey),
      storedKey: fixture.organization.billingCustomerId,
    }).toMatchObject({
      second: { error: expect.any(String) },
      charges: 1,
      scheduledKeys: ["starter-key"],
      storedKey: "starter-key",
    });

    // The paying member can still cancel, and no future charge survives.
    expect(await unsubscribe()).toEqual({ ok: true });
    expect(fixture.canceled).toHaveBeenCalledWith("starter-key");
    expect(fixture.schedules).toEqual([]);
  });
});
