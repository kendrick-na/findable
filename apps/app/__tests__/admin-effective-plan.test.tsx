/**
 * Admin console plan display — effective plan (Clerk payment + DB grant) with
 * the raw DB grant kept as a secondary field. Clerk failure must degrade to
 * the DB plan with an "unverified" marker, never crash the page.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getUserList: vi.fn(),
  clerkClient: vi.fn(),
  inviteFindMany: vi.fn(),
  partnerFindMany: vi.fn(),
  orgFindMany: vi.fn(),
  orgFindUnique: vi.fn(),
  trackingGroupBy: vi.fn(),
  brandFindMany: vi.fn(),
}));

vi.mock("@repo/auth/server", () => ({ clerkClient: h.clerkClient }));
vi.mock("@repo/auth/admin", () => ({
  requireAdmin: vi.fn().mockResolvedValue("admin"),
}));
vi.mock("@repo/database", () => ({
  database: {
    inviteRedemption: { findMany: h.inviteFindMany },
    partnerApplication: { findMany: h.partnerFindMany },
    organization: { findMany: h.orgFindMany, findUnique: h.orgFindUnique },
    tracking: { groupBy: h.trackingGroupBy },
    brand: { findMany: h.brandFindMany },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_WEB_URL: "https://findable.example" },
}));

import { PlanCell } from "../app/(authenticated)/admin/orgs/plan-cell";
import { getConsultingWorkspace } from "../app/actions/admin/consulting";
import { listOrgs } from "../app/actions/admin/orgs";
import { resolveAdminOrgPlans } from "../lib/admin/effective-plan";

const NOW = new Date("2026-10-05T00:00:00Z");

const clerkUser = (id: string, plan: string, paid: boolean) => ({
  id,
  publicMetadata: { plan },
  privateMetadata: paid ? { findablePaymentId: "pay_1" } : {},
});

beforeEach(() => {
  for (const fn of Object.values(h)) {
    fn.mockReset();
  }
  h.clerkClient.mockResolvedValue({ users: { getUserList: h.getUserList } });
  h.getUserList.mockResolvedValue({ data: [] });
  h.inviteFindMany.mockResolvedValue([]);
  h.partnerFindMany.mockResolvedValue([]);
  h.trackingGroupBy.mockResolvedValue([]);
  h.brandFindMany.mockResolvedValue([]);
});

describe("resolveAdminOrgPlans", () => {
  it("shows a paying customer as paid even though the DB grant is free", async () => {
    h.getUserList.mockResolvedValue({
      data: [clerkUser("user_owner", "starter", true)],
    });
    const views = await resolveAdminOrgPlans(
      [
        {
          id: "org_1",
          plan: "free",
          planExpiresAt: null,
          memberIds: ["user_owner"],
        },
      ],
      NOW
    );
    expect(views.get("org_1")).toEqual({
      dbPlan: "free",
      effectivePlan: "starter",
      verified: true,
    });
  });

  it("an expired DB grant with no payment resolves to free", async () => {
    const views = await resolveAdminOrgPlans(
      [
        {
          id: "org_1",
          plan: "growth",
          planExpiresAt: new Date("2026-10-01T00:00:00Z"),
          memberIds: ["user_owner"],
        },
      ],
      NOW
    );
    expect(views.get("org_1")).toEqual({
      dbPlan: "growth",
      effectivePlan: "free",
      verified: true,
    });
  });

  it("Clerk failure → DB-only plan marked unverified, no throw", async () => {
    h.clerkClient.mockRejectedValue(new Error("clerk down"));
    const views = await resolveAdminOrgPlans(
      [
        {
          id: "org_1",
          plan: "growth",
          planExpiresAt: null,
          memberIds: ["user_owner"],
        },
      ],
      NOW
    );
    expect(views.get("org_1")).toEqual({
      dbPlan: "growth",
      effectivePlan: "growth",
      verified: false,
    });
  });

  it("any other failure falls back to the raw DB plan, unverified", async () => {
    h.inviteFindMany.mockRejectedValue(new Error("db hiccup"));
    const views = await resolveAdminOrgPlans(
      [{ id: "org_1", plan: "scale", planExpiresAt: null, memberIds: ["u"] }],
      NOW
    );
    expect(views.get("org_1")).toEqual({
      dbPlan: "scale",
      effectivePlan: "scale",
      verified: false,
    });
  });
});

describe("listOrgs", () => {
  it("returns the effective plan, the raw DB grant, and auto-refresh by effective plan", async () => {
    h.orgFindMany.mockResolvedValue([
      {
        id: "org_paid",
        name: "Paid",
        plan: "free",
        planExpiresAt: null,
        createdAt: NOW,
        ownerId: "user_owner",
        users: [{ id: "user_member" }],
        _count: { brands: 1, users: 2 },
      },
    ]);
    h.getUserList.mockResolvedValue({
      data: [
        clerkUser("user_owner", "free", false),
        clerkUser("user_member", "growth", true),
      ],
    });
    const [row] = await listOrgs();
    expect(row).toMatchObject({
      plan: "growth",
      dbPlan: "free",
      planVerified: true,
      autoRefreshHours: expect.any(Number),
    });
    expect(h.getUserList).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ["user_owner", "user_member"] })
    );
  });

  it("does not crash when Clerk is down", async () => {
    h.orgFindMany.mockResolvedValue([
      {
        id: "org_1",
        name: "A",
        plan: "free",
        planExpiresAt: null,
        createdAt: NOW,
        ownerId: "user_owner",
        users: [],
        _count: { brands: 0, users: 1 },
      },
    ]);
    h.clerkClient.mockRejectedValue(new Error("clerk down"));
    const [row] = await listOrgs();
    expect(row).toMatchObject({
      plan: "free",
      dbPlan: "free",
      planVerified: false,
      autoRefreshHours: null,
    });
  });
});

describe("getConsultingWorkspace", () => {
  const org = {
    id: "org_1",
    name: "Customer",
    plan: "free",
    planExpiresAt: null,
    ownerId: "user_owner",
    users: [],
    brands: [],
    consultationNotes: [],
  };

  it("shows the effective plan with the DB grant alongside", async () => {
    h.orgFindUnique.mockResolvedValue(org);
    h.getUserList.mockResolvedValue({
      data: [clerkUser("user_owner", "starter", true)],
    });
    const workspace = await getConsultingWorkspace("org_1");
    expect(workspace?.organization).toEqual({
      id: "org_1",
      name: "Customer",
      plan: "starter",
      dbPlan: "free",
      planVerified: true,
    });
  });

  it("Clerk failure → DB plan, unverified, page data still returned", async () => {
    h.orgFindUnique.mockResolvedValue(org);
    h.clerkClient.mockRejectedValue(new Error("clerk down"));
    const workspace = await getConsultingWorkspace("org_1");
    expect(workspace?.organization).toMatchObject({
      plan: "free",
      dbPlan: "free",
      planVerified: false,
    });
  });
});

describe("PlanCell", () => {
  it("renders the effective plan and the DB grant; no marker when verified", () => {
    const html = renderToStaticMarkup(
      <PlanCell dbPlan="free" plan="starter" verified />
    );
    expect(html).toContain(">starter<");
    expect(html).toContain("DB 부여 free");
    expect(html).not.toContain("미확인");
  });

  it("marks an unverified plan", () => {
    const html = renderToStaticMarkup(
      <PlanCell dbPlan="growth" plan="growth" verified={false} />
    );
    expect(html).toContain("미확인");
    expect(html).toContain("DB 부여 growth");
  });
});
