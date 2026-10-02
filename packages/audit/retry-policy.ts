/** New jobs in customer/free/cron flows never auto-resume old paid calls. */
export const MAX_FAILED_AUDIT_JOBS_PER_DAY = 3;
export const MAX_CONSECUTIVE_NO_PROGRESS_JOBS = 2;

export interface RecentFailedAudit {
  checkpoint: unknown;
  status: string;
}

const hasQuestionProgress = (checkpoint: unknown): boolean => {
  if (!checkpoint || typeof checkpoint !== "object") {
    return false;
  }
  const responses = (checkpoint as { responses?: unknown }).responses;
  return Array.isArray(responses) && responses.length > 0;
};

/** Rows are newest-first; a completed run resets the failure streak. */
export function newAuditAttemptBlockReason(
  recentRows: readonly RecentFailedAudit[]
): "failed_attempt_cap" | "no_progress" | null {
  const failedRows = recentRows.filter((_row, index) =>
    recentRows.slice(0, index + 1).every((row) => row.status === "failed")
  );
  if (failedRows.length >= MAX_FAILED_AUDIT_JOBS_PER_DAY) {
    return "failed_attempt_cap";
  }
  if (
    failedRows.length >= MAX_CONSECUTIVE_NO_PROGRESS_JOBS &&
    failedRows
      .slice(0, MAX_CONSECUTIVE_NO_PROGRESS_JOBS)
      .every(
        (row) => row.status === "failed" && !hasQuestionProgress(row.checkpoint)
      )
  ) {
    return "no_progress";
  }
  return null;
}
