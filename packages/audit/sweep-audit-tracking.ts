import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { reconcileAuditTracking } from "./reconcile-audit-tracking";
import { reconcileBriefingTracking } from "./reconcile-briefing-tracking";

export const AUDIT_TRACKING_RECONCILE_MIN_AGE_MS = 10 * 60 * 1000;
export const AUDIT_TRACKING_RECONCILE_MAX_ROWS = 10;
export const AUDIT_TRACKING_RECONCILE_MAX_DURATION_MS = 20_000;

const RECONCILE_OPERATION_TIMEOUT_MS = 5_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("tracking reconcile timeout")), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function sweepAuditTrackingReconciliation(
  now = new Date()
): Promise<{ completed: number; skipped: number; failed: number; bounded: boolean }> {
  const startedAt = Date.now();
  const agedBefore = new Date(
    now.getTime() - AUDIT_TRACKING_RECONCILE_MIN_AGE_MS
  );
  let candidates: Array<{ id: string; corePending: boolean; briefingPending: boolean }>;
  try {
    candidates = await withTimeout(
      database.$queryRawUnsafe<Array<{ id: string; corePending: boolean; briefingPending: boolean }>>(
        `WITH eligible AS (
           SELECT "id", "completedAt",
             "postprocessing"->>'tracking' AS "coreStage",
             "postprocessing"->>'briefingTracking' AS "briefingStage",
             ("postprocessing"->>'tracking' = 'pending'
               OR ("postprocessing"->>'tracking' IN ('unknown', 'failed')
                 AND ("postprocessing"->>'trackingNextAttemptAt' IS NULL
                   OR ("postprocessing"->>'trackingNextAttemptAt')::timestamptz <= $3))
               OR ("postprocessing"->>'tracking' = 'reconciling'
                 AND ("postprocessing"->>'trackingReconcileStartedAt')::timestamptz < $1)) AS "corePending",
             ("postprocessing"->>'briefingTracking' = 'pending'
               OR ("postprocessing"->>'briefingTracking' IN ('unknown', 'failed')
                 AND ("postprocessing"->>'briefingTrackingNextAttemptAt' IS NULL
                   OR ("postprocessing"->>'briefingTrackingNextAttemptAt')::timestamptz <= $3))
               OR ("postprocessing"->>'briefingTracking' = 'reconciling'
                 AND ("postprocessing"->>'briefingTrackingReconcileStartedAt')::timestamptz < $1)) AS "briefingPending"
           FROM "AuditJob"
           WHERE "status" = 'completed' AND "completedAt" < $1
             AND ("postprocessing"->>'tracking' IN ('pending', 'unknown', 'failed', 'reconciling')
               OR "postprocessing"->>'briefingTracking' IN ('pending', 'unknown', 'failed', 'reconciling'))
         ), ranked AS (
           SELECT "id", "corePending", "briefingPending", "completedAt",
             CASE WHEN "coreStage" = 'pending' OR "briefingStage" = 'pending' THEN 0 ELSE 1 END AS "queueClass",
             row_number() OVER (
               PARTITION BY CASE WHEN "coreStage" = 'pending' OR "briefingStage" = 'pending' THEN 0 ELSE 1 END
               ORDER BY "completedAt" ASC, "id" ASC
             ) AS "queueRank"
           FROM eligible
           WHERE "corePending" OR "briefingPending"
         )
         SELECT "id", "corePending", "briefingPending" FROM ranked
         ORDER BY "queueRank" ASC, "queueClass" ASC, "completedAt" ASC, "id" ASC
         LIMIT $2`,
        agedBefore,
        AUDIT_TRACKING_RECONCILE_MAX_ROWS,
        now
      ),
      RECONCILE_OPERATION_TIMEOUT_MS
    );
  } catch (error) {
    log.warn("audit.tracking.reconcile_sweep_query_timeout", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { completed: 0, skipped: 0, failed: 1, bounded: true };
  }

  const counts = { completed: 0, skipped: 0, failed: 0 };
  let bounded = false;
  for (const candidate of candidates) {
    if (Date.now() - startedAt >= AUDIT_TRACKING_RECONCILE_MAX_DURATION_MS) {
      bounded = true;
      break;
    }
    // reconcileAuditTracking re-reads the durable marker immediately before
    // writing. A stale candidate that became skipped/completed is harmless.
    try {
      const remaining = AUDIT_TRACKING_RECONCILE_MAX_DURATION_MS - (Date.now() - startedAt);
      if (remaining <= 0) {
        bounded = true;
        break;
      }
      const results = await withTimeout(
        Promise.all([
          ...(candidate.corePending ? [reconcileAuditTracking(candidate.id, now)] : []),
          ...(candidate.briefingPending ? [reconcileBriefingTracking(candidate.id, now)] : []),
        ]),
        Math.min(RECONCILE_OPERATION_TIMEOUT_MS, remaining)
      );
      for (const result of results) counts[result] += 1;
    } catch (error) {
      counts.failed += 1;
      log.warn("audit.tracking.reconcile_sweep_timeout", {
        jobId: candidate.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (candidates.length === AUDIT_TRACKING_RECONCILE_MAX_ROWS) bounded = true;
  if (counts.completed || counts.failed || bounded) {
    log.info("audit.tracking.reconcile_sweep", { ...counts, bounded });
  }
  return { ...counts, bounded };
}
