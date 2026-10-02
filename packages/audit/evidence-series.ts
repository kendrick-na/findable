import type { MeasurementPoint } from "./before-after";

/**
 * ActionCompletion snapshots are displayed as 0–100 mention percentages.
 * Tracking.shareOfVoice is a 0–1 *per-answer* share, not a run-level mention
 * percentage. Never compare those columns directly.
 */
export function completionMentionRate(percent: number | null): number | null {
  if (
    percent === null ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100
  ) {
    return null;
  }
  return percent / 100;
}

export interface EvidenceTrackingRow {
  brandMentioned: boolean;
  trackedAt: Date;
}

/** One observation per run timestamp, using the same mention/answer axis as
 * the completion snapshot. Tracking has no runId: same-time system briefings
 * may still contaminate a cohort, so this is observational only. */
export function mentionRateSeries(
  rows: EvidenceTrackingRow[]
): MeasurementPoint[] {
  const runs = new Map<number, { mentions: number; total: number }>();
  for (const row of rows) {
    const time = row.trackedAt.getTime();
    if (!Number.isFinite(time)) {
      continue;
    }
    const run = runs.get(time) ?? { mentions: 0, total: 0 };
    run.total += 1;
    if (row.brandMentioned) {
      run.mentions += 1;
    }
    runs.set(time, run);
  }
  return [...runs].map(([time, run]) => ({
    measuredAt: new Date(time),
    sov: run.mentions / run.total,
  }));
}
