import "server-only";

import {
  type MemberPlanSignal,
  normalizePlan,
  type Plan,
  resolveOrganizationPlan,
} from "@repo/auth/plan";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import {
  loadClerkPlanSignals,
  memberPlanSignal,
} from "@/lib/billing/clerk-plan-signals";

/**
 * Admin-console plan display (2026-10-05).
 *
 * Why: payment entitlement lives in Clerk (`publicMetadata.plan` + the private
 *   payment source), not in `Organization.plan`, which only holds invite/admin
 *   grants. Showing the raw DB column made paying customers look "free".
 *
 * The effective plan uses `resolveOrganizationPlan` — the same verdict the
 *   auto-refresh cron uses — over every member (owner + DB users). The raw DB
 *   grant stays visible as a secondary field.
 *
 * Failure: if Clerk (or anything else here) fails, the plan is derived from
 *   DB data only and marked `verified: false`. It never throws, so an admin
 *   page never crashes because Clerk is down.
 */

export interface AdminPlanView {
  /** Raw `Organization.plan` (invite/admin grant only). */
  dbPlan: Plan;
  /** What gates actually use. */
  effectivePlan: Plan;
  /** False when Clerk could not be read; effectivePlan is then DB-only. */
  verified: boolean;
}

export interface AdminPlanOrgInput {
  id: string;
  memberIds: readonly string[];
  plan: string;
  planExpiresAt: Date | null;
}

function dbOnlyViews(
  orgs: readonly AdminPlanOrgInput[]
): Map<string, AdminPlanView> {
  return new Map(
    orgs.map((org) => {
      const dbPlan = normalizePlan(org.plan);
      return [org.id, { dbPlan, effectivePlan: dbPlan, verified: false }];
    })
  );
}

/** Effective plan per organization for admin screens. Never throws. */
export async function resolveAdminOrgPlans(
  orgs: readonly AdminPlanOrgInput[],
  now = new Date()
): Promise<Map<string, AdminPlanView>> {
  if (orgs.length === 0) {
    return new Map();
  }
  try {
    const userIds = [...new Set(orgs.flatMap((org) => org.memberIds))];
    const [clerkSignals, invites, partners] = await Promise.all([
      loadClerkPlanSignals(userIds, "admin.plan.clerk_lookup_failed"),
      database.inviteRedemption.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true },
      }),
      database.partnerApplication.findMany({
        where: { userId: { in: userIds }, status: "approved" },
        select: { userId: true },
      }),
    ]);
    const invited = new Set(invites.map((row) => row.userId));
    const approvedPartners = new Set(partners.map((row) => row.userId));

    return new Map(
      orgs.map((org) => {
        const dbPlan = normalizePlan(org.plan);
        // Clerk failed → per-user payment is unknown → free (DB grant only).
        const members: MemberPlanSignal[] = [...new Set(org.memberIds)].map(
          (userId) =>
            memberPlanSignal(userId, clerkSignals, invited, approvedPartners)
        );
        const effectivePlan = resolveOrganizationPlan({
          organizationPlan: dbPlan,
          organizationPlanExpiresAt: org.planExpiresAt,
          members,
          now,
        });
        return [
          org.id,
          { dbPlan, effectivePlan, verified: clerkSignals !== null },
        ];
      })
    );
  } catch (error) {
    log.error("admin.plan.resolve_failed", {
      orgs: orgs.length,
      error: String(error),
    });
    return dbOnlyViews(orgs);
  }
}

/** Single-organization convenience for the consulting page. Never throws. */
export async function resolveAdminOrgPlan(
  org: AdminPlanOrgInput,
  now = new Date()
): Promise<AdminPlanView> {
  const views = await resolveAdminOrgPlans([org], now);
  return (
    views.get(org.id) ?? {
      dbPlan: normalizePlan(org.plan),
      effectivePlan: normalizePlan(org.plan),
      verified: false,
    }
  );
}
