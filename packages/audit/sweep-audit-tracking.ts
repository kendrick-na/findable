import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { reconcileAuditTracking } from "./reconcile-audit-tracking";

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
  let candidates: Array<{ id: string }>;
  try {
    candidates = await withTimeout(
      database.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id"
         FROM "AuditJob"
         WHERE "status" = 'completed'
           AND "completedAt" < $1
           AND (
             "postprocessing"->>'tracking' IN ('pending', 'unknown')
             OR ("postprocessing"->>'tracking' = 'reconciling'
                 AND ("postprocessing"->>'trackingReconcileStartedAt')::timestamptz < $1)
           )
         ORDER BY "completedAt" ASC
         LIMIT $2`,
        agedBefore,
        AUDIT_TRACKING_RECONCILE_MAX_ROWS
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
      const result = await withTimeout(
        reconcileAuditTracking(candidate.id),
        Math.min(RECONCILE_OPERATION_TIMEOUT_MS, remaining)
      );
      counts[result] += 1;
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
