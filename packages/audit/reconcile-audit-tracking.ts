import { randomUUID } from "node:crypto";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { persistAuditTracking, type TaggedEngineResponse } from "./tracking";
import {
  classifyTrackingReplay,
  retireExhaustedTrackingClaim,
  TRACKING_RECONCILE_MAX_ATTEMPTS,
} from "./tracking-replay-policy";

type ReconcileDatabase = Pick<typeof database, "$executeRawUnsafe">;

export async function claimAuditTracking(
  db: ReconcileDatabase,
  jobId: string,
  claimStartedAt = new Date(),
  claimToken: string = randomUUID()
): Promise<string | null> {
  const staleBefore = new Date(claimStartedAt.getTime() - 10 * 60 * 1000);
  const claimed = await db.$executeRawUnsafe(
    `UPDATE "AuditJob"
       SET "postprocessing" = jsonb_set(jsonb_set(
       jsonb_set(
         jsonb_set(COALESCE("postprocessing", '{}'::jsonb), '{tracking}', '"reconciling"', true),
         '{trackingReconcileStartedAt}', to_jsonb($2::text), true),
       '{trackingReconcileToken}', to_jsonb($3::text), true),
       '{trackingReconcileAttempts}', to_jsonb(COALESCE(("postprocessing"->>'trackingReconcileAttempts')::int, 0) + 1), true)
     WHERE "id" = $1 AND "status" = 'completed'
       AND COALESCE(("postprocessing"->>'trackingReconcileAttempts')::int, 0) < $5
       AND (
         ("postprocessing"->>'tracking' IN ('pending', 'unknown', 'failed')
           AND ("postprocessing"->>'tracking' = 'pending'
             OR "postprocessing"->>'trackingNextAttemptAt' IS NULL
             OR ("postprocessing"->>'trackingNextAttemptAt')::timestamptz <= $2::timestamptz))
         OR ("postprocessing"->>'tracking' = 'reconciling'
             AND ("postprocessing"->>'trackingReconcileStartedAt')::timestamptz < $4::timestamptz)
       )`,
    jobId,
    claimStartedAt.toISOString(),
    claimToken,
    staleBefore.toISOString(),
    TRACKING_RECONCILE_MAX_ATTEMPTS
  );
  return claimed === 1 ? claimToken : null;
}

export async function finalizeAuditTracking(
  db: ReconcileDatabase,
  jobId: string,
  claimToken: string,
  status: "completed" | "unknown" | "not_applicable" | "unreplayable"
): Promise<number> {
  return db.$executeRawUnsafe(
    `UPDATE "AuditJob"
       SET "postprocessing" = jsonb_set(jsonb_set(
         jsonb_set(
           jsonb_set(COALESCE("postprocessing", '{}'::jsonb), '{tracking}',
             to_jsonb(CASE WHEN $3::text = 'unknown'
               AND COALESCE(("postprocessing"->>'trackingReconcileAttempts')::int, 0) >= $4
               THEN 'retry_exhausted' ELSE $3::text END), true),
           '{trackingReconcileStartedAt}', 'null', true),
         '{trackingReconcileToken}', 'null', true),
         '{trackingNextAttemptAt}',
         CASE WHEN $3::text = 'unknown'
           AND COALESCE(("postprocessing"->>'trackingReconcileAttempts')::int, 0) < $4
           THEN to_jsonb((now() + interval '1 minute' * COALESCE(("postprocessing"->>'trackingReconcileAttempts')::int, 1))::text)
           ELSE 'null'::jsonb END, true)
     WHERE "id" = $1 AND "status" = 'completed'
       AND "postprocessing"->>'tracking' = 'reconciling'
       AND "postprocessing"->>'trackingReconcileToken' = $2`,
    jobId,
    claimToken,
    status,
    TRACKING_RECONCILE_MAX_ATTEMPTS
  );
}

/**
 * Replays only a completed AuditJob's core Tracking boundary. The durable row
 * key makes this safe after a crash between AuditJob completion and Tracking.
 * Legacy snapshots without promptIndex are intentionally not guessed.
 */
export async function reconcileAuditTracking(
  jobId: string,
  now = new Date()
): Promise<"completed" | "failed" | "skipped"> {
  const job = await database.auditJob.findUnique({
    where: { id: jobId },
    select: {
      status: true,
      organizationId: true,
      brandId: true,
      completedAt: true,
      result: true,
      postprocessing: true,
    },
  });
  if (!job || job.status !== "completed") {
    return "skipped";
  }
  const trackingStage =
    job.postprocessing &&
    typeof job.postprocessing === "object" &&
    !Array.isArray(job.postprocessing)
      ? (job.postprocessing as { tracking?: unknown }).tracking
      : undefined;
  if (
    trackingStage !== "pending" &&
    trackingStage !== "unknown" &&
    trackingStage !== "failed" &&
    trackingStage !== "reconciling"
  ) {
    // The durable marker, not the current feature flag, decides whether this
    // AuditJob intended a Tracking dual-write. Missing/skipped/completed jobs
    // must never be guessed into new rows.
    return "skipped";
  }
  const marker = job.postprocessing as Record<string, unknown>;
  const attempts = marker.trackingReconcileAttempts;
  if (
    typeof attempts === "number" &&
    attempts >= TRACKING_RECONCILE_MAX_ATTEMPTS
  ) {
    const retired = await retireExhaustedTrackingClaim(
      database,
      jobId,
      "tracking",
      trackingStage,
      typeof marker.trackingReconcileToken === "string"
        ? marker.trackingReconcileToken
        : null,
      now
    );
    if (retired === 1) {
      log.warn("audit.tracking.reconcile_retry_exhausted", { jobId, attempts });
    }
    return "skipped";
  }
  const claimToken = await claimAuditTracking(database, jobId, now);
  if (!claimToken) {
    return "skipped";
  }

  if (!(job.organizationId && job.brandId)) {
    await finalizeAuditTracking(database, jobId, claimToken, "not_applicable");
    return "skipped";
  }
  if (!(job.completedAt && job.result)) {
    await finalizeAuditTracking(database, jobId, claimToken, "unreplayable");
    return "skipped";
  }
  const result = job.result as {
    engineResponses?: Array<Record<string, unknown>>;
  };
  const tagged: TaggedEngineResponse[] = (
    Array.isArray(result.engineResponses) ? result.engineResponses : []
  )
    .filter(
      (row) =>
        row !== null &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        row.promptKind !== "discovery" &&
        row.trackingInputCaptured === true &&
        typeof row.promptIndex === "number" &&
        typeof row.promptText === "string" &&
        typeof row.promptLang === "string"
    )
    .map((row) => ({
      ...(row as unknown as TaggedEngineResponse),
      rawResponse: String(row.rawResponse ?? ""),
      citedSources: Array.isArray(row.citedSources) ? row.citedSources : [],
      shareOfVoice:
        typeof row.shareOfVoice === "number" ? row.shareOfVoice : null,
      usage:
        row.usage && typeof row.usage === "object"
          ? (row.usage as TaggedEngineResponse["usage"])
          : undefined,
      promptLang: row.promptLang === "en" ? "en" : "ko",
      promptText: String(row.promptText),
      promptIndex: row.promptIndex as number,
    }));

  if (tagged.length === 0) {
    log.warn("audit.tracking.reconcile_unkeyed_snapshot", { jobId });
    await finalizeAuditTracking(database, jobId, claimToken, "unreplayable");
    return "skipped";
  }

  try {
    const replayability = await classifyTrackingReplay(
      job.organizationId,
      tagged
    );
    if (replayability !== "ready") {
      await finalizeAuditTracking(
        database,
        jobId,
        claimToken,
        replayability === "retry" ? "unknown" : replayability
      );
      return replayability === "retry" ? "failed" : "skipped";
    }

    const status = await persistAuditTracking({
      auditJobId: jobId,
      trackingClaimToken: claimToken,
      organizationId: job.organizationId,
      brandId: job.brandId,
      completedAt: job.completedAt,
      trackingAxis: "core",
      tagged,
    });

    const updated = await finalizeAuditTracking(
      database,
      jobId,
      claimToken,
      status === "completed" ? "completed" : "unknown"
    );
    if (updated !== 1) {
      log.warn("audit.tracking.reconcile_lost_claim", { jobId, updated });
    }
    return status;
  } catch (error) {
    log.warn("audit.tracking.reconcile_retry", { jobId, error: String(error) });
    try {
      await finalizeAuditTracking(database, jobId, claimToken, "unknown");
    } catch (finalizeError) {
      // DB failure or forced termination still leaves the fenced stale lease
      // for a later bounded reclaim/retirement.
      log.warn("audit.tracking.reconcile_finalize_failed", {
        jobId,
        error: String(finalizeError),
      });
    }
    return "failed";
  }
}
