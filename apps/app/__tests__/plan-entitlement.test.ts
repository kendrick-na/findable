import { resolveEffectivePlan } from "@repo/auth/plan";
import { describe, expect, it } from "vitest";

const now = new Date("2026-09-25T00:00:00.000Z");

describe("organization entitlement", () => {
  it("uses the active invite even when the Clerk write failed", () => {
    expect(
      resolveEffectivePlan({
        clerkPlan: "free",
        organizationPlan: "growth",
        organizationPlanExpiresAt: new Date("2026-09-30T00:00:00.000Z"),
        now,
      })
    ).toBe("growth");
  });

  it("removes the legacy cached grant after the 20-day PoC expires", () => {
    expect(
      resolveEffectivePlan({
        clerkPlan: "growth",
        organizationPlan: "free",
        organizationPlanExpiresAt: null,
        hasInviteRedemption: true,
        now,
      })
    ).toBe("free");
  });

  it("honors an admin revocation before the original invite expiry", () => {
    expect(
      resolveEffectivePlan({
        clerkPlan: "growth",
        organizationPlan: "free",
        organizationPlanExpiresAt: null,
        hasInviteRedemption: true,
        now,
      })
    ).toBe("free");
  });

  it("expires an administrator's timed grant even without an invite history", () => {
    expect(
      resolveEffectivePlan({
        clerkPlan: "growth",
        organizationPlan: "free",
        organizationPlanExpiresAt: new Date("2026-09-24T00:00:00.000Z"),
        hasInviteRedemption: false,
        now,
      })
    ).toBe("free");
  });

  it("does not let an invite for another organization unlock this one", () => {
    expect(
      resolveEffectivePlan({
        clerkPlan: "growth",
        organizationPlan: "free",
        organizationPlanExpiresAt: null,
        hasInviteRedemption: true,
        now,
      })
    ).toBe("free");
  });

  it("keeps an independently purchased plan when an invite expires", () => {
    expect(
      resolveEffectivePlan({
        clerkPlan: "scale",
        organizationPlan: "free",
        organizationPlanExpiresAt: null,
        hasInviteRedemption: true,
        hasCurrentPaymentGrant: true,
        now,
      })
    ).toBe("scale");
  });

  it("does not downgrade an approved partner after an invite expires", () => {
    expect(
      resolveEffectivePlan({
        clerkPlan: "growth",
        organizationPlan: "free",
        organizationPlanExpiresAt: null,
        hasInviteRedemption: true,
        isApprovedPartner: true,
        now,
      })
    ).toBe("growth");
  });
});
