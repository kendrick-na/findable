import { database } from "@repo/database";
import type { TaggedEngineResponse } from "./tracking";
import { isTrackableResponse } from "./tracking-eligibility";

export const TRACKING_RECONCILE_MAX_ATTEMPTS = 3;
export const TRACKING_RECONCILE_RETRY_MS = 60_000;

type ReconcileDatabase = Pick<typeof database, "$executeRawUnsafe">;
type ReplayAxis = "tracking" | "briefingTracking";

/**
 * A killed worker cannot finalize its claim. Retire an exhausted stale lease
 * with a token-and-stage CAS; a late successful writer wins if it finalized
 * first. Pending/unknown markers already at the limit are retired when due.
 */
export function retireExhaustedTrackingClaim(
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
  const manifestKey = `${axis}Manifest`;
  const rowAxis = axis === "tracking" ? "core" : "briefing";
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000);
  return db.$executeRawUnsafe(
    `WITH candidate AS MATERIALIZED (
       SELECT "id", "postprocessing", "brandId", "completedAt"
       FROM "AuditJob"
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
         )
       FOR UPDATE
     ), proof AS (
       SELECT candidate."id",
         (candidate."postprocessing"->$12->>'v' = '1'
           AND candidate."postprocessing"->$12->>'brandId' = candidate."brandId"
           AND jsonb_typeof(candidate."postprocessing"->$12->'keys') = 'array'
           AND stats.expected BETWEEN 1 AND 100
           AND stats.expected = stats.distinct_keys
           AND stats.expected = stats.scoped_keys
           AND stats.expected = stats.found_keys) AS complete
       FROM candidate
       CROSS JOIN LATERAL (
         SELECT count(*)::int AS expected,
           count(DISTINCT expected_key.key)::int AS distinct_keys,
           count(*) FILTER (
             WHERE left(expected_key.key, length($1::text || '|' || $13::text || '|'))
               = $1::text || '|' || $13::text || '|'
           )::int AS scoped_keys,
           count(tracked."id")::int AS found_keys
         FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(candidate."postprocessing"->$12->'keys') = 'array'
             THEN candidate."postprocessing"->$12->'keys'
             ELSE '[]'::jsonb END
         ) AS expected_key(key)
         LEFT JOIN "Tracking" AS tracked
           ON tracked."trackingRowKey" = expected_key.key
           AND tracked."brandId" = candidate."brandId"
           AND tracked."trackedAt" = candidate."completedAt"
       ) AS stats
     )
     UPDATE "AuditJob" AS job
     SET "postprocessing" = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
       COALESCE(job."postprocessing", '{}'::jsonb),
       ARRAY[$2::text],
       to_jsonb(CASE WHEN proof.complete THEN 'completed' ELSE 'retry_exhausted' END), true),
       ARRAY[$3::text], 'null'::jsonb, true),
       ARRAY[$4::text], 'null'::jsonb, true),
       ARRAY[$5::text], 'null'::jsonb, true)
     FROM proof WHERE job."id" = proof."id"`,
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
    now.toISOString(),
    manifestKey,
    rowAxis
  );
}

/** Distinguish immutable non-writes from dependencies that may recover. */
export async function classifyTrackingReplay(
  organizationId: string,
  tagged: TaggedEngineResponse[]
): Promise<"ready" | "not_applicable" | "unreplayable" | "retry"> {
  if (tagged.length === 0) {
    return "unreplayable";
  }
  const snapshotEngineIds = new Set(tagged.map((row) => row.engineId));
  const eligible = tagged.filter((row) =>
    isTrackableResponse(row, snapshotEngineIds)
  );
  if (eligible.length === 0) {
    // Stub, provider error, unverified verdict or blank prompt cannot become
    // a real answer by retrying the same immutable AuditJob snapshot.
    return "not_applicable";
  }
  const organization = await database.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) {
    return "not_applicable";
  }
  const engines = await database.engine.findMany({ select: { id: true } });
  const validEngineIds = new Set(engines.map((engine) => engine.id));
  // A missing Engine seed can be repaired without changing the snapshot.
  if (eligible.some((row) => !validEngineIds.has(row.engineId))) {
    return "retry";
  }
  return "ready";
}
