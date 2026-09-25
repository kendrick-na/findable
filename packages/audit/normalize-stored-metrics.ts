import { aggregateAudit } from "@repo/ai/lib/engines/aggregate";
import { MENTION_VERDICT_VERSION } from "@repo/ai/lib/mention-verdict-version";
import type {
  CitedSource,
  EngineId,
  EngineResponse,
} from "@repo/ai/lib/engines/types";

const CORE_ENGINES = new Set<EngineId>([
  "chatgpt",
  "chatgpt-web",
  "claude",
  "perplexity",
  "gemini",
  "hyperclova",
  "naver",
  "daum",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function normalizedMentionQuality(
  row: Record<string, unknown>,
  requiresRevalidation: boolean
): EngineResponse["mentionQuality"] {
  if (requiresRevalidation) {
    return "unverified";
  }
  if (
    row.mentionQuality === "unverified" ||
    (row.mentionQuality === "unknown_brand" &&
      row.verdictVia === "skipped" &&
      !row.errorMessage &&
      !row.isStub)
  ) {
    return "unverified";
  }
  return undefined;
}

function semanticJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item: unknown) =>
    isRecord(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) =>
            left.localeCompare(right)
          )
        )
      : item
  );
}

/**
 * Rebuild displayed metrics from the immutable engine rows in saved jobs.
 * Old snapshots counted sentiment for unrelated answers and could carry a
 * ranking from a rejected entity. Naver AI Briefing stays a separate channel.
 * Stored raw data and the historical PDF are not mutated.
 */
export function withRecomputedAuditMetrics<T>(result: T): T {
  if (!(isRecord(result) && isRecord(result.metrics))) {
    return result;
  }
  const raw = result.engineResponses;
  if (!Array.isArray(raw) || raw.length === 0) {
    return result;
  }
  const core = raw.filter(
    (row): row is Record<string, unknown> =>
      isRecord(row) && CORE_ENGINES.has(row.engineId as EngineId)
  );
  if (core.length === 0) {
    return result;
  }
  // Results written before the current entity-verdict contract have no way to
  // distinguish a true match from a same-name company. Never let their stored
  // booleans feed a score or recommendation. The immutable excerpts remain
  // available for a later explicit revalidation/backfill.
  const storedResult = result as unknown as Record<string, unknown>;
  const requiresRevalidation =
    storedResult.mentionVerdictVersion !== MENTION_VERDICT_VERSION;
  const responses: EngineResponse[] = core.map((row) => ({
    engineId: row.engineId as EngineId,
    brandMentioned: requiresRevalidation ? false : row.brandMentioned === true,
    mentionQuality: normalizedMentionQuality(row, requiresRevalidation),
    mentionPosition: requiresRevalidation
      ? null
      : positiveNumber(row.mentionPosition),
    mentionListSize: requiresRevalidation
      ? null
      : positiveNumber(row.mentionListSize),
    sentiment:
      row.sentiment === "positive" ||
      row.sentiment === "neutral" ||
      row.sentiment === "negative"
        ? row.sentiment
        : null,
    citedSources: Array.isArray(row.citedSources)
      ? row.citedSources.filter(
          (source): source is CitedSource =>
            isRecord(source) &&
            typeof source.domain === "string" &&
            typeof source.url === "string"
        )
      : [],
    rawResponse: "",
    shareOfVoice: null,
    durationMs: typeof row.durationMs === "number" ? row.durationMs : 0,
    isStub: row.isStub === true,
    errorMessage:
      typeof row.errorMessage === "string" ? row.errorMessage : null,
  }));
  const corrected = {
    ...result,
    metrics: { ...result.metrics, ...aggregateAudit(responses) },
    ...(requiresRevalidation
      ? {
          verificationState: "revalidation_required",
          geoActions: [],
          topRecommendations: [],
        }
      : {}),
  };
  // Historical region scores were also built with the old aggregator, but the
  // saved rows have no prompt-language tag to recompute them reliably.
  if (
    hasStaleAuditPdf(result, corrected) &&
    Array.isArray(result.regions) &&
    result.regions.length > 0
  ) {
    return {
      ...corrected,
      regions: undefined,
      regionScoresOutdated: true,
    } as T;
  }
  return corrected as T;
}

/** A generated PDF is immutable; don't offer it when its displayed metrics are stale. */
export function hasStaleAuditPdf(
  original: unknown,
  corrected: unknown
): boolean {
  if (!(isRecord(original) && isRecord(corrected))) {
    return false;
  }
  const oldMetrics = original.metrics;
  const newMetrics = corrected.metrics;
  if (!(isRecord(oldMetrics) && isRecord(newMetrics))) {
    return false;
  }
  // A legacy PDF presented skipped entity checks as negative answers. Its
  // headline score is not evidence-equivalent to the corrected on-page report.
  if (
    typeof newMetrics.unverifiedCount === "number" &&
    newMetrics.unverifiedCount > 0 &&
    oldMetrics.unverifiedCount !== newMetrics.unverifiedCount
  ) {
    return true;
  }
  const displayed = [
    "sov",
    "averageMentionPosition",
    "enginesCovered",
    "enginesWithMention",
    "sentimentDistribution",
    "stubCount",
    "topCitedDomains",
  ];
  return displayed.some(
    (key) => semanticJson(oldMetrics[key]) !== semanticJson(newMetrics[key])
  );
}
