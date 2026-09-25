import {
  isPublishableAuditResult,
  withRecomputedAuditMetrics,
} from "@repo/audit/normalize-stored-metrics";

/** Never turn an older Tracking snapshot into the latest run's citation or competitor claim. */
export function canShowLatestAnalysis(input: {
  createdAt: Date;
  result: unknown;
  status: string;
  trackedAt: Date | null;
}): boolean {
  return (
    input.status === "completed" &&
    input.trackedAt !== null &&
    input.trackedAt.getTime() >= input.createdAt.getTime() &&
    isPublishableAuditResult(withRecomputedAuditMetrics(input.result))
  );
}
