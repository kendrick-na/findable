import { aggregateAudit } from "@repo/ai/lib/engines/aggregate";
import type {
  CitedSource,
  EngineId,
  EngineResponse,
} from "@repo/ai/lib/engines/types";
import { MENTION_VERDICT_VERSION } from "@repo/ai/lib/mention-verdict-version";

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
 * A run becomes provisional (잠정) only when too little of it was adjudicated.
 * Unverified answers never zero a run by themselves: they are removed from the
 * appearance-rate denominator and reported beside the score (approved
 * 2026-09-28). Changing these numbers changes what customers see as a score.
 */
export const PROVISIONAL_MAX_UNVERIFIED_SHARE = 0.2;
export const MIN_VERIFIED_ANSWERS = 10;

export type AuditPublicationIssue =
  /** No stored metrics at all. */
  | "missing_data"
  /** Saved before the current entity-verdict contract; needs revalidation. */
  | "brand_verification"
  /** More than 20% of successful answers could not be adjudicated. */
  | "unverified_share"
  /** Fewer than 10 adjudicated answers — too small a sample to publish. */
  | "insufficient_sample";

function countOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** Why a run cannot be presented as an authoritative score or prescription. */
export function auditPublicationIssue(
  result: unknown
): AuditPublicationIssue | null {
  if (!(isRecord(result) && isRecord(result.metrics))) {
    return "missing_data";
  }
  if (
    result.mentionVerdictVersion !== MENTION_VERDICT_VERSION ||
    result.verificationState === "revalidation_required"
  ) {
    return "brand_verification";
  }
  const unverified = countOf(result.metrics.unverifiedCount);
  const verified = countOf(result.metrics.verifiedCount);
  // Metrics without the counters predate verification accounting: we cannot
  // tell how many answers were adjudicated, so do not guess (fail closed).
  if (unverified === null || verified === null) {
    return "brand_verification";
  }
  const answers = verified + unverified;
  if (answers > 0 && unverified / answers > PROVISIONAL_MAX_UNVERIFIED_SHARE) {
    return "unverified_share";
  }
  if (verified < MIN_VERIFIED_ANSWERS) {
    return "insufficient_sample";
  }
  // Citation attribution is deliberately NOT a publication issue: a link whose
  // relationship to the brand is unknown says nothing about whether the brand
  // was mentioned. It only restricts citation-based prescriptions (see
  // `citationPrescriptionsRestricted`).
  return null;
}

/**
 * published   — authoritative score, prescriptions, PDF, sharing.
 * provisional — score/metrics computed from adjudicated answers only, shown
 *               with a warning; derivatives (prescriptions, missed-visit
 *               estimate, PDF, trends, alerts) are withheld.
 * withheld    — nothing adjudicated (legacy run or zero verified answers).
 */
export type AuditPublicationStatus = "published" | "provisional" | "withheld";

export function auditPublicationStatus(
  result: unknown
): AuditPublicationStatus {
  const issue = auditPublicationIssue(result);
  if (issue === null) {
    return "published";
  }
  if (
    (issue === "unverified_share" || issue === "insufficient_sample") &&
    isRecord(result) &&
    isRecord(result.metrics) &&
    (countOf(result.metrics.verifiedCount) ?? 0) > 0
  ) {
    return "provisional";
  }
  return "withheld";
}

/** Only current, sufficiently adjudicated measurements may feed PDFs or AI advice. */
export function isPublishableAuditResult(result: unknown): boolean {
  return auditPublicationIssue(result) === null;
}

/**
 * External links in confirmed answers whose relation to the brand is unknown
 * must not become source/channel advice. Score and mention metrics stay valid.
 */
export function citationPrescriptionsRestricted(result: unknown): boolean {
  if (!(isRecord(result) && isRecord(result.metrics))) {
    return true;
  }
  const attribution = result.metrics.citationAttribution;
  return attribution !== "none_observed" && attribution !== "owned_only";
}

/** Public API must not expose provisional prescriptions as facts. */
export function publicAuditResult<T>(input: T): T {
  if (!isRecord(input)) {
    return input;
  }
  // A revalidated run keeps its pre-revalidation result for audit purposes.
  // That copy carries superseded verdicts and must never leave the server.
  const result: Record<string, unknown> = isRecord(input.revalidation)
    ? {
        ...input,
        revalidation: Object.fromEntries(
          Object.entries(input.revalidation).filter(
            ([key]) => key !== "original"
          )
        ),
      }
    : input;
  const status = auditPublicationStatus(result);
  if (status === "published") {
    return result as T;
  }
  const withheldDerivatives = {
    geoActions: [],
    topRecommendations: [],
    regions: undefined,
  };
  if (status === "provisional") {
    // Metrics already exclude unverified answers from the denominator. They
    // are shown labelled 잠정; advice built on them is not.
    return { ...result, ...withheldDerivatives } as T;
  }
  const metrics = isRecord(result.metrics) ? result.metrics : {};
  return {
    ...result,
    metrics: {
      ...metrics,
      sov: null,
      averageMentionListSize: null,
      averageMentionPosition: null,
      averageRelativePosition: null,
      enginesWithMention: [],
      sentimentDistribution: null,
      topCitedDomains: [],
    },
    ...withheldDerivatives,
  } as T;
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
    // Aggregation never reads the text; keep it anyway so a recomputed row is
    // never mistaken for one without source evidence.
    rawResponse: typeof row.rawResponse === "string" ? row.rawResponse : "",
    shareOfVoice: null,
    durationMs: typeof row.durationMs === "number" ? row.durationMs : 0,
    isStub: row.isStub === true,
    errorMessage:
      typeof row.errorMessage === "string" ? row.errorMessage : null,
  }));
  const corrected = {
    ...result,
    metrics: {
      ...result.metrics,
      ...aggregateAudit(
        responses,
        typeof storedResult.domain === "string"
          ? storedResult.domain
          : undefined
      ),
    },
    ...(requiresRevalidation
      ? {
          verificationState: "revalidation_required",
          // Preserve original rows in storage, but never expose old badges as
          // current verdicts alongside provisional aggregate metrics.
          engineResponses: raw.map((row) =>
            isRecord(row)
              ? {
                  ...row,
                  brandMentioned: false,
                  mentionQuality: "unverified",
                  verdictVia: "skipped",
                  mentionPosition: null,
                  mentionListSize: null,
                  sov: null,
                }
              : row
          ),
          geoActions: [],
          topRecommendations: [],
          regions: undefined,
          regionScoresOutdated: true,
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
  if (!isPublishableAuditResult(corrected)) {
    return true;
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
