// Retired auto-refresh cron (apps/web).
//
// The scheduled, authoritative auto-refresh cron lives in apps/app:
//   apps/app/app/api/cron/auto-refresh-tracking/route.ts
// It applies billing grace/expiry and paid-org eligibility. This web copy was
// unscheduled (apps/web/vercel.json has no cron for it) but still reachable,
// and its old logic cleared `planExpiresAt` and selected orgs by DB plan only.
// A manual call must never run that stale logic, so after the cron auth check
// it only answers 410 Gone.
//
// Auth stays first: `denyIfNotCron` is the single source of truth (CRON_SECRET
// Bearer only, fail closed). Unauthenticated callers still get 401.

import { denyIfNotCron } from "@repo/security/cron";
import type { NextRequest } from "next/server";

export const GET = (request: NextRequest): Response => {
  const denied = denyIfNotCron(request);
  if (denied) {
    return denied;
  }
  return Response.json(
    {
      error: "moved",
      message:
        "auto-refresh-tracking moved to the app deployment (apps/app); this endpoint no longer runs.",
    },
    { status: 410 }
  );
};
