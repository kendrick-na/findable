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

/** A separate marker prevents briefing replay from changing core score state. */
export async function claimBriefingTracking(
  db: ReconcileDatabase,
  jobId: string,
  startedAt = new Date(),
  token: string = randomUUID()
): Promise<string | null> {
  const staleBefore = new Date(startedAt.getTime() - 10 * 60 * 1000);
  const claimed = await db.$executeRawUnsafe(
    `UPDATE "AuditJob"
     SET "postprocessing" = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
       COALESCE("postprocessing", '{}'::jsonb),
       '{briefingTracking}', '"reconciling"', true),
       '{briefingTrackingReconcileStartedAt}', to_jsonb($2::text), true),
       '{briefingTrackingReconcileToken}', to_jsonb($3::text), true),
       '{briefingTrackingReconcileAttempts}', to_jsonb(COALESCE(("postprocessing"->>'briefingTrackingReconcileAttempts')::int, 0) + 1), true)
     WHERE "id" = $1 AND "status" = 'completed'
       AND COALESCE(("postprocessing"->>'briefingTrackingReconcileAttempts')::int, 0) < $5
       AND (
         ("postprocessing"->>'briefingTracking' IN ('pending', 'unknown', 'failed')
           AND ("postprocessing"->>'briefingTracking' = 'pending'
             OR "postprocessing"->>'briefingTrackingNextAttemptAt' IS NULL
             OR ("postprocessing"->>'briefingTrackingNextAttemptAt')::timestamptz <= $2::timestamptz))
         OR ("postprocessing"->>'briefingTracking' = 'reconciling'
           AND ("postprocessing"->>'briefingTrackingReconcileStartedAt')::timestamptz < $4::timestamptz)
       )`,
    jobId,
    startedAt.toISOString(),
    token,
    staleBefore.toISOString(),
    TRACKING_RECONCILE_MAX_ATTEMPTS
  );
  return claimed === 1 ? token : null;
}

export async function finalizeBriefingTracking(
  db: ReconcileDatabase,
  jobId: string,
  token: string,
  status: "completed" | "unknown" | "not_applicable" | "unreplayable"
): Promise<number> {
  return db.$executeRawUnsafe(
    `UPDATE "AuditJob"
     SET "postprocessing" = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
       COALESCE("postprocessing", '{}'::jsonb),
       '{briefingTracking}',
       to_jsonb(CASE WHEN $3::text = 'unknown'
         AND COALESCE(("postprocessing"->>'briefingTrackingReconcileAttempts')::int, 0) >= $4
         THEN 'retry_exhausted' ELSE $3::text END), true),
       '{briefingTrackingReconcileStartedAt}', 'null', true),
       '{briefingTrackingReconcileToken}', 'null', true),
       '{briefingTrackingNextAttemptAt}',
       CASE WHEN $3::text = 'unknown'
         AND COALESCE(("postprocessing"->>'briefingTrackingReconcileAttempts')::int, 0) < $4
         THEN to_jsonb((now() + interval '1 minute' * COALESCE(("postprocessing"->>'briefingTrackingReconcileAttempts')::int, 1))::text)
         ELSE 'null'::jsonb END, true)
     WHERE "id" = $1 AND "status" = 'completed'
       AND "postprocessing"->>'briefingTracking' = 'reconciling'
       AND "postprocessing"->>'briefingTrackingReconcileToken' = $2`,
    jobId,
    token,
    status,
    TRACKING_RECONCILE_MAX_ATTEMPTS
  );
}

/** Replay only a captured on-demand briefing snapshot; never re-run the provider. */
export async function reconcileBriefingTracking(
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
  if (!job || job.status !== "completed") return "skipped";

  const marker = job.postprocessing && typeof job.postprocessing === "object" &&
    !Array.isArray(job.postprocessing)
      ? (job.postprocessing as { briefingTracking?: unknown }).briefingTracking
      : undefined;
  if (marker !== "pending" && marker !== "unknown" && marker !== "failed" && marker !== "reconciling") return "skipped";

  const stage = job.postprocessing as Record<string, unknown>;
  const attempts = stage.briefingTrackingReconcileAttempts;
  if (
    typeof attempts === "number" &&
    attempts >= TRACKING_RECONCILE_MAX_ATTEMPTS
  ) {
    const retired = await retireExhaustedTrackingClaim(
      database,
      jobId,
      "briefingTracking",
      marker,
      typeof stage.briefingTrackingReconcileToken === "string"
        ? stage.briefingTrackingReconcileToken
        : null,
      now
    );
    if (retired === 1) {
      log.warn("audit.briefing.tracking_retry_exhausted", { jobId, attempts });
    }
    return "skipped";
  }
  const token = await claimBriefingTracking(database, jobId, now);
  if (!token) return "skipped";
  if (!job.organizationId || !job.brandId) {
    await finalizeBriefingTracking(database, jobId, token, "not_applicable");
    return "skipped";
  }
  if (!job.completedAt || !job.result) {
    await finalizeBriefingTracking(database, jobId, token, "unreplayable");
    return "skipped";
  }
  const result = job.result as {
    briefingStatus?: unknown;
    briefingPrompt?: unknown;
    engineResponses?: Array<Record<string, unknown>>;
  };
  const tagged: TaggedEngineResponse[] = (Array.isArray(result.engineResponses) ? result.engineResponses : [])
    .filter((row) => row !== null && typeof row === "object" && !Array.isArray(row) &&
      row.engineId === "naver-briefing" &&
      row.trackingInputCaptured === true && row.promptIndex === 0 &&
      typeof row.promptText === "string" && row.promptText === result.briefingPrompt &&
      (row.promptLang === "ko" || row.promptLang === "en") &&
      typeof row.rawResponse === "string" && row.rawResponse.length > 0 &&
      row.isStub === false && !row.errorMessage)
    .map((row) => ({
      ...(row as unknown as TaggedEngineResponse),
      citedSources: Array.isArray(row.citedSources) ? row.citedSources : [],
      shareOfVoice: typeof row.shareOfVoice === "number" ? row.shareOfVoice : null,
      usage: row.usage && typeof row.usage === "object"
        ? row.usage as TaggedEngineResponse["usage"] : undefined,
    }));

  if (result.briefingStatus !== "completed" || tagged.length !== 1) {
    log.warn("audit.briefing.tracking_unreplayable_snapshot", { jobId });
    await finalizeBriefingTracking(database, jobId, token, "unreplayable");
    return "skipped";
  }

  try {
    const replayability = await classifyTrackingReplay(job.organizationId, tagged);
    if (replayability !== "ready") {
      await finalizeBriefingTracking(
        database, jobId, token,
        replayability === "retry" ? "unknown" : replayability
      );
      return replayability === "retry" ? "failed" : "skipped";
    }

    const status = await persistAuditTracking({
      auditJobId: jobId,
      organizationId: job.organizationId,
      brandId: job.brandId,
      completedAt: job.completedAt,
      trackingAxis: "briefing",
      promptIsAutoGenerated: false,
      tagged,
    });
    const updated = await finalizeBriefingTracking(
      database, jobId, token, status === "completed" ? "completed" : "unknown"
    );
    if (updated !== 1) log.warn("audit.briefing.tracking_lost_claim", { jobId });
    return status;
  } catch (error) {
    log.warn("audit.briefing.tracking_retry", { jobId, error: String(error) });
    try {
      await finalizeBriefingTracking(database, jobId, token, "unknown");
    } catch (finalizeError) {
      log.warn("audit.briefing.tracking_finalize_failed", {
        jobId,
        error: String(finalizeError),
      });
    }
    return "failed";
  }
}
