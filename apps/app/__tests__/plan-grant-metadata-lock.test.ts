/**
 * P1-4: Clerk metadata is read-modify-write. A Paid grant and a period-end
 * expiry running at the same time read the same snapshot; the later write
 * drops the other's change (a paid grant can vanish). Mutations for one
 * user must be serialized with a Postgres advisory lock.
 *
 * Real: packages/auth/plan-grant. Doubles: Clerk (in-memory, delayed
 * writes) and the DB transaction (in-process advisory-lock emulation).
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "user_race-1";
const OLD_ID = "fdbl-starter-race-1-old";
const NEW_ID = "fdbl-growth-race-1-new";

const fx = vi.hoisted(() => {
  const user = {
    publicMetadata: {} as Record<string, unknown>,
    privateMetadata: {} as Record<string, unknown>,
  };
  const lockKeys: string[] = [];
  const locks = new Map<string, Promise<void>>();
  const transaction = vi.fn(
    async (
      fn: (tx: {
        $executeRaw: (
          strings: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>;
      }) => Promise<unknown>
    ) => {
      let release: (() => void) | undefined;
      const tx = {
        $executeRaw: async (
          strings: TemplateStringsArray,
          ...values: unknown[]
        ) => {
          if (!strings.join("?").includes("pg_advisory_xact_lock")) {
            throw new Error("unexpected SQL");
          }
          const key = String(values[0]);
          lockKeys.push(key);
          const previous = locks.get(key) ?? Promise.resolve();
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          locks.set(
            key,
            previous.then(() => held)
          );
          await previous;
          return 1;
        },
      };
      try {
        return await fn(tx);
      } finally {
        release?.();
      }
    }
  );
  return { user, lockKeys, locks, transaction };
});

vi.mock("@repo/database", () => ({
  database: { $transaction: fx.transaction },
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
          publicMetadata: structuredClone(fx.user.publicMetadata),
          privateMetadata: structuredClone(fx.user.privateMetadata),
        })),
        updateUserMetadata: vi.fn(
          async (
            _id: string,
            patch: {
              privateMetadata: Record<string, unknown>;
              publicMetadata: Record<string, unknown>;
            }
          ) => {
            // The expiry/refund (writes plan "free") is the slow writer.
            const delay = patch.publicMetadata.plan === "free" ? 40 : 0;
            await new Promise((resolve) => setTimeout(resolve, delay));
            fx.user.publicMetadata = {
              ...fx.user.publicMetadata,
              ...patch.publicMetadata,
            };
            fx.user.privateMetadata = {
              ...fx.user.privateMetadata,
              ...patch.privateMetadata,
            };
            return {};
          }
        ),
      },
    })),
  })
);

beforeEach(() => {
  vi.clearAllMocks();
  fx.locks.clear();
  fx.lockKeys.length = 0;
  fx.user.publicMetadata = { plan: "starter" };
  fx.user.privateMetadata = {
    findablePaymentId: OLD_ID,
    findablePaymentGrantStack: [
      { paymentId: OLD_ID, plan: "starter" },
      { paymentId: null, plan: "free" },
    ],
  };
});

describe("plan-grant serializes per-user metadata writes [P1-4]", () => {
  it("a concurrent expiry does not erase a grant that landed meanwhile", async () => {
    const { expirePaymentGrants, grantPlanFromPayment } = await import(
      "@repo/auth/plan-grant"
    );
    // Expiry starts first but writes last.
    const expiry = expirePaymentGrants(USER_ID, (id) => id === OLD_ID);
    const grant = grantPlanFromPayment(USER_ID, "growth", NEW_ID);
    const [expired, granted] = await Promise.all([expiry, grant]);
    expect(expired.reason).toBe("expired");
    expect(granted).toBe(true);

    expect(fx.user.publicMetadata.plan).toBe("growth");
    expect(fx.user.privateMetadata.findablePaymentId).toBe(NEW_ID);
    const stack = fx.user.privateMetadata.findablePaymentGrantStack as Array<{
      paymentId: string | null;
    }>;
    expect(stack.map((entry) => entry.paymentId)).toContain(NEW_ID);
    expect(stack.map((entry) => entry.paymentId)).not.toContain(OLD_ID);
  });

  it("a concurrent refund and grant both survive", async () => {
    const { grantPlanFromPayment, revokePlanFromPayment } = await import(
      "@repo/auth/plan-grant"
    );
    const [revoked, granted] = await Promise.all([
      revokePlanFromPayment(USER_ID, OLD_ID),
      grantPlanFromPayment(USER_ID, "growth", NEW_ID),
    ]);
    expect(revoked.reason).toBe("revoked");
    expect(granted).toBe(true);
    expect(fx.user.privateMetadata.findablePaymentId).toBe(NEW_ID);
    expect(fx.user.publicMetadata.plan).toBe("growth");
  });

  it("uses one lock key per user and fails closed when the lock is unavailable", async () => {
    const { grantPlanFromPayment } = await import("@repo/auth/plan-grant");
    expect(await grantPlanFromPayment(USER_ID, "growth", NEW_ID)).toBe(true);
    expect(fx.lockKeys).toEqual([`findable:plan-metadata:${USER_ID}`]);

    fx.transaction.mockRejectedValueOnce(new Error("db down"));
    const before = structuredClone(fx.user);
    expect(
      await grantPlanFromPayment(USER_ID, "scale", "fdbl-scale-race-1-x")
    ).toBe(false);
    expect(fx.user).toEqual(before);
  });
});
