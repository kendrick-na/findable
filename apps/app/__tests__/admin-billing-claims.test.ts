/**
 * Operator tool for stuck subscription claims (billingNextPaymentId set, no
 * billing key). Admin gate, PortOne-verified release, refusal on PAID, and
 * idempotency. DB, PortOne and Clerk are doubles; the action is real.
 * @vitest-environment node
 */

import { buildPaymentId } from "@repo/payments/catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const MINUTE = 60 * 1000;

const fixture = vi.hoisted(() => {
  interface Org {
    billingCustomerId: string | null;
    billingNextPaymentId: string | null;
    billingStatus: string;
    id: string;
    name: string;
  }
  const orgs = new Map<string, Org>();
  const matches = (org: Org, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, condition]) => {
      const value = org[key as keyof Org];
      if (condition && typeof condition === "object") {
        if ("not" in condition) {
          return value !== (condition as { not: unknown }).not;
        }
        throw new Error(`unsupported operator: ${key}`);
      }
      return value === condition;
    });
  return {
    orgs,
    admin: { id: "user_admin-1" as string | null },
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    getPayment: vi.fn(),
    findMany: vi.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        [...orgs.values()]
          .filter((org) => matches(org, where))
          .map((org) => ({ ...org }))
      )
    ),
    findUnique: vi.fn(({ where }: { where: { id: string } }) => {
      const org = orgs.get(where.id);
      return Promise.resolve(org ? { ...org } : null);
    }),
    updateMany: vi.fn(
      ({
        data,
        where,
      }: {
        data: Partial<Org>;
        where: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const org of orgs.values()) {
          if (matches(org, where)) {
            Object.assign(org, data);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      }
    ),
  };
});

vi.mock("@repo/auth/admin", () => ({
  requireAdmin: vi.fn(() => {
    if (!fixture.admin.id) {
      return Promise.reject(new Error("FORBIDDEN: admin only"));
    }
    return Promise.resolve(fixture.admin.id);
  }),
}));
vi.mock("@repo/database", () => ({
  database: {
    organization: {
      findMany: fixture.findMany,
      findUnique: fixture.findUnique,
      updateMany: fixture.updateMany,
    },
  },
}));
vi.mock("@repo/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/payments")>();
  return { ...actual, getPortOnePayment: fixture.getPayment };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@repo/observability/error", () => ({ parseError: String }));
vi.mock("@repo/observability/log", () => ({ log: fixture.log }));

const claimId = (minutesAgo: number) =>
  buildPaymentId(
    "starter",
    "user_buyer-1",
    NOW.getTime() - minutesAgo * MINUTE
  );

function seed(id: string, overrides: Record<string, unknown> = {}) {
  fixture.orgs.set(id, {
    id,
    name: `Org ${id}`,
    billingStatus: "trialing",
    billingCustomerId: null,
    billingNextPaymentId: claimId(45),
    ...overrides,
  });
}

const payment = (id: string, status: string) => ({
  id,
  storeId: "store-test",
  status,
  currency: "KRW",
  amount: { total: 1000 },
});

const actions = () => import("@/app/actions/admin/billing");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  fixture.orgs.clear();
  fixture.admin.id = "user_admin-1";
});

describe("admin stuck-claim tool [S]", () => {
  it("S1: non-admins can neither list nor release, and nothing is read or changed", async () => {
    seed("org-1");
    fixture.admin.id = null;
    const { listStuckClaims, releaseStuckClaim } = await actions();
    await expect(listStuckClaims()).rejects.toThrow(/FORBIDDEN/);
    await expect(releaseStuckClaim("org-1")).rejects.toThrow(/FORBIDDEN/);
    expect(fixture.findMany).not.toHaveBeenCalled();
    expect(fixture.findUnique).not.toHaveBeenCalled();
    expect(fixture.getPayment).not.toHaveBeenCalled();
    expect(fixture.orgs.get("org-1")?.billingNextPaymentId).not.toBeNull();
  });

  it("S2: the list shows only claims older than 30 minutes with no billing key, without calling PortOne", async () => {
    seed("old");
    seed("recent", { billingNextPaymentId: claimId(10) });
    seed("subscribed", {
      billingCustomerId: "key-1",
      billingStatus: "active",
    });
    seed("clean", { billingNextPaymentId: null });
    const { listStuckClaims } = await actions();
    const rows = await listStuckClaims();
    expect(rows.map((row) => row.organizationId)).toEqual(["old"]);
    expect(rows[0]).toMatchObject({
      organizationName: "Org old",
      paymentId: claimId(45),
      ageMinutes: 45,
    });
    expect(fixture.getPayment).not.toHaveBeenCalled();
  });

  it.each([
    "FAILED",
    "CANCELLED",
  ])("S3: releases when PortOne says %s and logs the admin id", async (status) => {
    seed("org-1");
    fixture.getPayment.mockImplementation(async (id: string) =>
      payment(id, status)
    );
    const { releaseStuckClaim } = await actions();
    expect(await releaseStuckClaim("org-1")).toEqual({
      ok: true,
      outcome: "released",
    });
    expect(fixture.orgs.get("org-1")?.billingNextPaymentId).toBeNull();
    expect(fixture.log.info).toHaveBeenCalledWith(
      "admin.billing.claim_release",
      expect.objectContaining({
        adminId: "user_admin-1",
        organizationId: "org-1",
        outcome: "released",
        portoneStatus: status,
      })
    );
  });

  it("S4: releases when PortOne never created the payment (404 / PAYMENT_NOT_FOUND)", async () => {
    const { PortOneApiError } = await import("@repo/payments");
    seed("org-404");
    seed("org-code");
    const { releaseStuckClaim } = await actions();
    fixture.getPayment.mockRejectedValueOnce(
      new PortOneApiError("lookup failed", 404, null)
    );
    expect(await releaseStuckClaim("org-404")).toMatchObject({
      ok: true,
      outcome: "released",
    });
    fixture.getPayment.mockRejectedValueOnce(
      new PortOneApiError("lookup failed", 400, "PAYMENT_NOT_FOUND")
    );
    expect(await releaseStuckClaim("org-code")).toMatchObject({
      ok: true,
      outcome: "released",
    });
    expect(fixture.orgs.get("org-404")?.billingNextPaymentId).toBeNull();
    expect(fixture.orgs.get("org-code")?.billingNextPaymentId).toBeNull();
  });

  it.each([
    "PAID",
    "PARTIAL_CANCELLED",
  ])("S5: refuses when PortOne says %s (paid but unrecorded) and keeps the claim", async (status) => {
    seed("org-1");
    const before = fixture.orgs.get("org-1")?.billingNextPaymentId;
    fixture.getPayment.mockImplementation(async (id: string) =>
      payment(id, status)
    );
    const { releaseStuckClaim } = await actions();
    expect(await releaseStuckClaim("org-1")).toMatchObject({
      ok: false,
      outcome: "paid_unrecorded",
    });
    expect(fixture.orgs.get("org-1")?.billingNextPaymentId).toBe(before);
    expect(fixture.updateMany).not.toHaveBeenCalled();
    expect(fixture.log.warn).toHaveBeenCalledWith(
      "admin.billing.claim_release",
      expect.objectContaining({
        adminId: "user_admin-1",
        outcome: "paid_unrecorded",
      })
    );
  });

  it("S6: refuses on in-progress status, on lookup errors, and on claims younger than 30 minutes", async () => {
    seed("pending");
    seed("broken");
    seed("young", { billingNextPaymentId: claimId(5) });
    const { releaseStuckClaim } = await actions();
    fixture.getPayment.mockImplementationOnce(async (id: string) =>
      payment(id, "PENDING")
    );
    expect(await releaseStuckClaim("pending")).toMatchObject({
      ok: false,
      outcome: "in_progress",
    });
    fixture.getPayment.mockRejectedValueOnce(new Error("portone 503"));
    expect(await releaseStuckClaim("broken")).toMatchObject({
      ok: false,
      outcome: "lookup_failed",
    });
    fixture.getPayment.mockClear();
    expect(await releaseStuckClaim("young")).toMatchObject({
      ok: false,
      outcome: "too_recent",
    });
    expect(fixture.getPayment).not.toHaveBeenCalled();
    for (const id of ["pending", "broken", "young"]) {
      expect(fixture.orgs.get(id)?.billingNextPaymentId).not.toBeNull();
    }
  });

  it("S7: release is idempotent and never touches a subscribed org", async () => {
    seed("org-1");
    seed("subscribed", {
      billingCustomerId: "key-1",
      billingStatus: "active",
    });
    fixture.getPayment.mockImplementation(async (id: string) =>
      payment(id, "FAILED")
    );
    const { releaseStuckClaim } = await actions();
    expect(await releaseStuckClaim("org-1")).toMatchObject({
      outcome: "released",
    });
    fixture.getPayment.mockClear();
    expect(await releaseStuckClaim("org-1")).toEqual({
      ok: true,
      outcome: "already_released",
    });
    expect(fixture.getPayment).not.toHaveBeenCalled();

    expect(await releaseStuckClaim("subscribed")).toMatchObject({
      ok: false,
      outcome: "not_a_claim",
    });
    expect(fixture.getPayment).not.toHaveBeenCalled();
    expect(fixture.orgs.get("subscribed")?.billingNextPaymentId).not.toBeNull();
  });

  it("S8: a claim replaced between lookup and release is not cleared", async () => {
    seed("org-1");
    const replacement = claimId(1);
    fixture.getPayment.mockImplementation((id: string) => {
      const org = fixture.orgs.get("org-1");
      if (org) {
        org.billingNextPaymentId = replacement;
      }
      return Promise.resolve(payment(id, "FAILED"));
    });
    const { releaseStuckClaim } = await actions();
    expect(await releaseStuckClaim("org-1")).toMatchObject({
      ok: true,
      outcome: "already_released",
    });
    expect(fixture.orgs.get("org-1")?.billingNextPaymentId).toBe(replacement);
  });
});
