import {
  citationPrescriptionsRestricted,
  isPublishableAuditResult,
  withRecomputedAuditMetrics,
} from "@repo/audit/normalize-stored-metrics";

/** Never turn an older Tracking snapshot into the latest run's citation or competitor claim. */
export function canShowLatestAnalysis(input: {
  createdAt: Date;
  /**
   * The screen interprets cited links as the brand's sources. Links whose
   * relation to the brand is unknown do not block the score (2026-09-28), but
   * they must not become a source analysis either.
   */
  citationBased?: boolean;
  result: unknown;
  status: string;
  trackedAt: Date | null;
}): boolean {
  const corrected = withRecomputedAuditMetrics(input.result);
  return (
    input.status === "completed" &&
    input.trackedAt !== null &&
    input.trackedAt.getTime() >= input.createdAt.getTime() &&
    isPublishableAuditResult(corrected) &&
    !(input.citationBased && citationPrescriptionsRestricted(corrected))
  );
}
