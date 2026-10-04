import { database } from "@repo/database";
import { isTrackableResponse } from "./tracking-eligibility";
import type { TaggedEngineResponse } from "./tracking";

export const TRACKING_RECONCILE_MAX_ATTEMPTS = 3;
export const TRACKING_RECONCILE_RETRY_MS = 60_000;

type ReconcileDatabase = Pick<typeof database, "$executeRawUnsafe">;
type ReplayAxis = "tracking" | "briefingTracking";

/**
 * A killed worker cannot finalize its claim. Retire an exhausted stale lease
 * with a token-and-stage CAS; a late successful writer wins if it finalized
 * first. Pending/unknown markers already at the limit are retired when due.
 */
export async function retireExhaustedTrackingClaim(
  db: ReconcileDatabase,
  jobId: string,
  axis: ReplayAxis,
  expectedStage: "pending" | "unknown" | "failed" | "reconciling",
  expectedToken: string | null,
  now = new Date()
): Promise<number> {
  const startedKey = `${axis}ReconcileStartedAt`;
  const tokenKey = `${axis}ReconcileToken`;
  const attemptsKey = `${axis}ReconcileAttempts`;
  const nextKey = `${axis}NextAttemptAt`;
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000);
  return db.$executeRawUnsafe(
    `UPDATE "AuditJob"
     SET "postprocessing" = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
       COALESCE("postprocessing", '{}'::jsonb),
       ARRAY[$2::text], to_jsonb('retry_exhausted'::text), true),
       ARRAY[$3::text], 'null'::jsonb, true),
       ARRAY[$4::text], 'null'::jsonb, true),
       ARRAY[$5::text], 'null'::jsonb, true)
     WHERE "id" = $1 AND "status" = 'completed'
       AND "postprocessing"->>$2 = $8
       AND COALESCE(("postprocessing"->>$6)::int, 0) >= $7
       AND ("postprocessing"->>$4) IS NOT DISTINCT FROM $9::text
       AND (
         ($8::text = 'reconciling'
           AND ("postprocessing"->>$3)::timestamptz < $10::timestamptz)
         OR ($8::text IN ('pending', 'unknown', 'failed')
           AND ("postprocessing"->>$5 IS NULL
             OR ("postprocessing"->>$5)::timestamptz <= $11::timestamptz))
       )`,
    jobId,
    axis,
    startedKey,
    tokenKey,
    nextKey,
    attemptsKey,
    TRACKING_RECONCILE_MAX_ATTEMPTS,
    expectedStage,
    expectedToken,
    staleBefore.toISOString(),
    now.toISOString()
  );
}

/** Distinguish immutable non-writes from dependencies that may recover. */
export async function classifyTrackingReplay(
  organizationId: string,
  tagged: TaggedEngineResponse[]
): Promise<"ready" | "not_applicable" | "unreplayable" | "retry"> {
  if (tagged.length === 0) return "unreplayable";
  const snapshotEngineIds = new Set(tagged.map((row) => row.engineId));
  if (!tagged.some((row) => isTrackableResponse(row, snapshotEngineIds))) {
    // Stub, provider error, unverified verdict or blank prompt cannot become
    // a real answer by retrying the same immutable AuditJob snapshot.
    return "not_applicable";
  }
  const organization = await database.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) return "not_applicable";
  const engines = await database.engine.findMany({ select: { id: true } });
  const validEngineIds = new Set(engines.map((engine) => engine.id));
  // A missing Engine seed can be repaired without changing the snapshot.
  if (!tagged.some((row) => isTrackableResponse(row, validEngineIds))) return "retry";
  return "ready";
}
