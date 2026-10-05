/**
 * Per-user Clerk plan signals, shared by the auto-refresh cron and the admin
 * plan display (2026-10-05).
 *
 * Payment entitlement lives in Clerk (`publicMetadata.plan` + the private
 * payment source), not in `Organization.plan`. Both callers combine these
 * signals with DB grants via `resolveOrganizationPlan`.
 *
 * Failure contract: `loadClerkPlanSignals` never throws. On any Clerk error it
 * logs `failureEvent` and returns `null`; each caller decides what that means
 * (cron → DB-only verdict, admin → DB-only verdict marked unverified).
 */

import {
  hasCurrentPaymentGrant,
  type MemberPlanSignal,
  planFromPublicMetadata,
} from "@repo/auth/plan";
import { clerkClient } from "@repo/auth/server";
import { log } from "@repo/observability/log";

/** Clerk getUserList page size (at or below the Clerk list API limit). */
export const CLERK_USER_PAGE = 100;

export type ClerkPlanSignal = Pick<
  MemberPlanSignal,
  "clerkPlan" | "hasCurrentPaymentGrant"
> & {
  /** Current payment provenance id (private), for paid-period checks. */
  currentPaymentId: string | null;
};

/** Clerk signals per user id, or `null` when Clerk could not be read. */
export async function loadClerkPlanSignals(
  userIds: readonly string[],
  failureEvent: string
): Promise<Map<string, ClerkPlanSignal> | null> {
  const signals = new Map<string, ClerkPlanSignal>();
  if (userIds.length === 0) {
    return signals;
  }
  try {
    const clerk = await clerkClient();
    for (let i = 0; i < userIds.length; i += CLERK_USER_PAGE) {
      const chunk = userIds.slice(i, i + CLERK_USER_PAGE);
      const page = await clerk.users.getUserList({
        userId: [...chunk],
        limit: CLERK_USER_PAGE,
      });
      for (const user of page.data) {
        const privateMetadata = user.privateMetadata as Record<
          string,
          unknown
        > | null;
        const paymentId = privateMetadata?.findablePaymentId;
        signals.set(user.id, {
          clerkPlan: planFromPublicMetadata(
            user.publicMetadata as Record<string, unknown> | null
          ),
          hasCurrentPaymentGrant: hasCurrentPaymentGrant(privateMetadata),
          currentPaymentId: typeof paymentId === "string" ? paymentId : null,
        });
      }
    }
    return signals;
  } catch (error) {
    log.error(failureEvent, {
      users: userIds.length,
      error: String(error),
    });
    return null;
  }
}

/**
 * One member's plan signal. A user missing from Clerk (or Clerk unavailable)
 * counts as free with no payment grant, so only DB grants remain.
 */
export function memberPlanSignal(
  userId: string,
  clerkSignals: ReadonlyMap<string, ClerkPlanSignal> | null,
  invited: ReadonlySet<string>,
  approvedPartners: ReadonlySet<string>
): MemberPlanSignal {
  const clerk = clerkSignals?.get(userId);
  return {
    clerkPlan: clerk?.clerkPlan ?? "free",
    hasCurrentPaymentGrant: clerk?.hasCurrentPaymentGrant ?? false,
    hasInviteRedemption: invited.has(userId),
    isApprovedPartner: approvedPartners.has(userId),
  };
}
