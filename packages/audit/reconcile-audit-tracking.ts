import { randomUUID } from "node:crypto";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { persistAuditTracking, type TaggedEngineResponse } from "./tracking";

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
       SET "postprocessing" = jsonb_set(
       jsonb_set(
         jsonb_set(COALESCE("postprocessing", '{}'::jsonb), '{tracking}', '"reconciling"', true),
         '{trackingReconcileStartedAt}', to_jsonb($2::text), true),
       '{trackingReconcileToken}', to_jsonb($3::text), true)
     WHERE "id" = $1 AND "status" = 'completed'
       AND (
         "postprocessing"->>'tracking' IN ('pending', 'unknown')
         OR ("postprocessing"->>'tracking' = 'reconciling'
             AND ("postprocessing"->>'trackingReconcileStartedAt')::timestamptz < $4::timestamptz)
       )`,
    jobId,
    claimStartedAt.toISOString(),
    claimToken,
    staleBefore.toISOString()
  );
  return claimed === 1 ? claimToken : null;
}

export async function finalizeAuditTracking(
  db: ReconcileDatabase,
  jobId: string,
  claimToken: string,
  status: "completed" | "unknown"
): Promise<number> {
  return db.$executeRawUnsafe(
    `UPDATE "AuditJob"
       SET "postprocessing" = jsonb_set(
         jsonb_set(
           jsonb_set(COALESCE("postprocessing", '{}'::jsonb), '{tracking}', to_jsonb($3::text), true),
           '{trackingReconcileStartedAt}', 'null', true),
         '{trackingReconcileToken}', 'null', true)
     WHERE "id" = $1 AND "status" = 'completed'
       AND "postprocessing"->>'tracking' = 'reconciling'
       AND "postprocessing"->>'trackingReconcileToken' = $2`,
    jobId,
    claimToken,
    status
  );
}

/**
 * Replays only a completed AuditJob's core Tracking boundary. The durable row
 * key makes this safe after a crash between AuditJob completion and Tracking.
 * Legacy snapshots without promptIndex are intentionally not guessed.
 */
export async function reconcileAuditTracking(
  jobId: string
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
  if (
    !job ||
    job.status !== "completed" ||
    !job.organizationId ||
    !job.brandId ||
    !job.completedAt ||
    !job.result
  ) {
    return "skipped";
  }
  const trackingStage =
    job.postprocessing &&
    typeof job.postprocessing === "object" &&
    !Array.isArray(job.postprocessing)
      ? (job.postprocessing as { tracking?: unknown }).tracking
      : undefined;
  if (trackingStage !== "pending" && trackingStage !== "unknown" && trackingStage !== "reconciling") {
    // The durable marker, not the current feature flag, decides whether this
    // AuditJob intended a Tracking dual-write. Missing/skipped/completed jobs
    // must never be guessed into new rows.
    return "skipped";
  }
  const claimToken = await claimAuditTracking(database, jobId);
  if (!claimToken) return "skipped";

  const result = job.result as {
    engineResponses?: Array<Record<string, unknown>>;
  };
  const tagged: TaggedEngineResponse[] = (result.engineResponses ?? [])
    .filter(
      (row) =>
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
    await finalizeAuditTracking(database, jobId, claimToken, "unknown");
    return "skipped";
  }

  const status = await persistAuditTracking({
    auditJobId: jobId,
    organizationId: job.organizationId,
    brandId: job.brandId,
    completedAt: job.completedAt,
    trackingAxis: "core",
    tagged,
  });

  if (status === "completed") {
    const updated = await finalizeAuditTracking(database, jobId, claimToken, "completed");
    if (updated !== 1) {
      log.warn("audit.tracking.reconcile_marker_unknown", { jobId, updated });
    }
  }
  if (status === "failed") {
    await finalizeAuditTracking(database, jobId, claimToken, "unknown");
  }
  return status;
}
