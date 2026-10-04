/**
 * Shared Clerk plan-signal loader used by the auto-refresh cron and the admin
 * plan display: batches of 100, never throws, `null` on Clerk failure.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getUserList: vi.fn(),
  clerkClient: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@repo/auth/server", () => ({ clerkClient: h.clerkClient }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: h.logError },
}));

import {
  CLERK_USER_PAGE,
  loadClerkPlanSignals,
  memberPlanSignal,
} from "../lib/billing/clerk-plan-signals";

beforeEach(() => {
  for (const fn of Object.values(h)) {
    fn.mockReset();
  }
  h.clerkClient.mockResolvedValue({ users: { getUserList: h.getUserList } });
});

describe("loadClerkPlanSignals", () => {
  it("returns an empty map without calling Clerk when there are no users", async () => {
    const signals = await loadClerkPlanSignals([], "test.failed");
    expect(signals).toEqual(new Map());
    expect(h.clerkClient).not.toHaveBeenCalled();
  });

  it("asks Clerk in pages of 100 and maps plan + payment grant per user", async () => {
    const userIds = Array.from({ length: 205 }, (_, i) => `user_${i}`);
    h.getUserList.mockImplementation(({ userId }: { userId: string[] }) => ({
      data: userId.map((id) => ({
        id,
        publicMetadata: { plan: id === "user_0" ? "starter" : "free" },
        privateMetadata:
          id === "user_0" ? { findablePaymentId: "pay_1" } : null,
      })),
    }));

    const signals = await loadClerkPlanSignals(userIds, "test.failed");

    expect(CLERK_USER_PAGE).toBe(100);
    expect(h.getUserList).toHaveBeenCalledTimes(3);
    expect(
      h.getUserList.mock.calls.map((call) => {
        const params = call[0] as { userId: string[]; limit: number };
        return [params.userId.length, params.limit];
      })
    ).toEqual([
      [100, 100],
      [100, 100],
      [5, 100],
    ]);
    expect(signals?.size).toBe(205);
    expect(signals?.get("user_0")).toEqual({
      clerkPlan: "starter",
      hasCurrentPaymentGrant: true,
    });
    expect(signals?.get("user_204")).toEqual({
      clerkPlan: "free",
      hasCurrentPaymentGrant: false,
    });
  });

  it("returns null and logs the caller's event when Clerk fails", async () => {
    h.getUserList.mockRejectedValue(new Error("clerk down"));

    await expect(
      loadClerkPlanSignals(["user_1"], "cron.test.lookup_failed")
    ).resolves.toBeNull();
    expect(h.logError).toHaveBeenCalledWith("cron.test.lookup_failed", {
      users: 1,
      error: "Error: clerk down",
    });
  });
});

describe("memberPlanSignal", () => {
  it("treats a user missing from Clerk (or Clerk down) as free with DB grants only", () => {
    const invited = new Set(["user_1"]);
    const partners = new Set(["user_1"]);
    expect(memberPlanSignal("user_1", null, invited, partners)).toEqual({
      clerkPlan: "free",
      hasCurrentPaymentGrant: false,
      hasInviteRedemption: true,
      isApprovedPartner: true,
    });
    expect(
      memberPlanSignal(
        "user_2",
        new Map([
          ["user_2", { clerkPlan: "growth", hasCurrentPaymentGrant: true }],
        ]),
        invited,
        partners
      )
    ).toEqual({
      clerkPlan: "growth",
      hasCurrentPaymentGrant: true,
      hasInviteRedemption: false,
      isApprovedPartner: false,
    });
  });
});
