import { aggregateAudit } from "@repo/ai/lib/engines/aggregate";
import type {
  CitedSource,
  EngineId,
  EngineResponse,
} from "@repo/ai/lib/engines/types";
import { MENTION_VERDICT_VERSION } from "@repo/ai/lib/mention-verdict-version";
import {
  answerShareOfVoice,
  type BucketableAnswer,
  isDiscoveryAnswer,
  summarizeAnswerBuckets,
} from "./answer-buckets";
import {
  filterStoredGeoActions,
  filterStoredTopRecommendations,
} from "./action-display-filter";
import { checkBrandNameAgainstSite } from "./brand-name-check";
import { questionCoverage } from "./question-coverage";

const CORE_ENGINES = new Set<EngineId>([
  "chatgpt",
  "chatgpt-web",
  "claude",
  "perplexity",
  "gemini",
  // (2026-09-29) hyperclova 제외 — 서비스 종료. 과거 행은 원문 표에만 남고 점수 분모에 넣지 않는다.
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
  | "insufficient_sample"
  /** Some planned brand questions received no successful AI answer. */
  | "incomplete_execution"
  /** Stored evidence has no reconstructable question plan. */
  | "question_plan_unverified";

function countOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** Publication is about brand-question AI answers, not search exposure or discovery. */
function publicationAnswerCounts(
  result: Record<string, unknown>
): { verified: number; unverified: number } | null {
  const metrics = result.metrics;
  if (!isRecord(metrics)) {
    return null;
  }
  const buckets = metrics.answerBuckets;
  if (isRecord(buckets)) {
    const ai = buckets.ai;
    if (!isRecord(ai)) {
      return null;
    }
    const verified = countOf(ai.adjudicated);
    const unverified = countOf(ai.unverified);
    return verified === null || unverified === null
      ? null
      : { verified, unverified };
  }
  // Some stored snapshots predate answerBuckets. Prefer their immutable rows
  // over the mixed AI/search aggregate whenever those rows are available.
  if (Array.isArray(result.engineResponses)) {
    // Incomplete legacy rows cannot prove a successful answer. In particular,
    // an excerpt alone must not override stored zero-verdict counters.
    if (
      result.engineResponses.some(
        (row) =>
          !isRecord(row) ||
          typeof row.engineId !== "string" ||
          !("errorMessage" in row) ||
          !("isStub" in row)
      )
    ) {
      return null;
    }
    const rows = result.engineResponses as Array<
      Record<string, unknown> & BucketableAnswer
    >;
    const ai = summarizeAnswerBuckets(rows).ai;
    return { verified: ai.adjudicated, unverified: ai.unverified };
  }
  // A version stamp and mixed totals are not proof of any brand AI answer.
  // Current product runs carry rows; metrics-only snapshots fail closed.
  return null;
}

/** Brand-question AI verdicts only; search/discovery rows never inflate the label. */
export function publicationVerifiedAnswerCount(result: unknown): number | null {
  return isRecord(result)
    ? (publicationAnswerCounts(result)?.verified ?? null)
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
  const counts = publicationAnswerCounts(result);
  // Without a trustworthy AI bucket or complete rows, mixed counters cannot
  // prove how many brand AI answers were adjudicated (fail closed).
  if (counts === null) {
    return "brand_verification";
  }
  const { unverified, verified } = counts;
  const coverage = questionCoverage(result);
  if (
    coverage === null &&
    (result.promptsCount !== undefined ||
      result.measurementContext !== undefined ||
      (Array.isArray(result.engineResponses) &&
        result.engineResponses.some(
          (row) => isRecord(row) && row.promptIndex !== undefined
        )))
  ) {
    // A stored question plan with unidentifiable core rows cannot prove that
    // every planned question was measured. Keep metrics-only legacy fixtures
    // on their existing version gate, but fail closed for plan-bearing runs.
    return "question_plan_unverified";
  }
  if (
    coverage !== null &&
    coverage.brand.withSuccessfulAiAnswer < coverage.brand.planned
  ) {
    return "incomplete_execution";
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
 * provisional — some brand AI answers were adjudicated, but the run is not
 *               publishable. Evidence remains visible; mixed aggregate score
 *               and derivatives are withheld.
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
    (issue === "unverified_share" ||
      issue === "insufficient_sample" ||
      issue === "incomplete_execution" ||
      issue === "question_plan_unverified") &&
    isRecord(result) &&
    (publicationAnswerCounts(result)?.verified ?? 0) > 0
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
  // Provisional runs can have a brand-AI sample but their aggregate may still
  // blend search exposure. Never offer that number as a provisional AI score.
  // Keep answerBuckets and raw rows so AI verdicts and search remain distinct.
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
  // 이름 없는 질문(discovery)의 응답은 점수 분모에 넣지 않는다 — 러너와 같은 규칙.
  //   (answer-buckets.ts · runner.ts `brandFlat` 주석)
  const core = raw.filter(
    (row): row is Record<string, unknown> =>
      isRecord(row) &&
      CORE_ENGINES.has(row.engineId as EngineId) &&
      !isDiscoveryAnswer(row as { promptKind?: string })
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
  const displayedRows = requiresRevalidation
    ? raw.map((row) =>
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
      )
    : raw.map((row) =>
        isRecord(row)
          ? {
              ...row,
              // 🔴 제대로 안 답변에만 점유율(2026-09-29). 과거 행은 다른 회사·모름 답변에도
              //   sov 1 이 저장돼 있다 — 원본은 두고 내보내는 값만 바로잡는다.
              sov: answerShareOfVoice(
                row as unknown as BucketableAnswer,
                typeof row.sov === "number" ? row.sov : null
              ),
            }
          : row
      );
  const bucketRows = displayedRows.filter(
    (row): row is Record<string, unknown> & BucketableAnswer =>
      isRecord(row) && typeof row.engineId === "string"
  );
  const coverage = questionCoverage(storedResult);
  const measurementContext = isRecord(storedResult.measurementContext)
    ? storedResult.measurementContext
    : null;
  const site = isRecord(measurementContext?.officialSiteIdentity)
    ? (measurementContext.officialSiteIdentity as Parameters<
        typeof checkBrandNameAgainstSite
      >[2])
    : null;
  const corrected = {
    ...result,
    engineResponses: displayedRows,
    // 입력 브랜드명 ↔ 사이트 표기 대조 — 과거 회차도 저장된 사이트 근거로 계산한다.
    ...(measurementContext &&
    typeof storedResult.brandName === "string" &&
    typeof storedResult.domain === "string"
      ? {
          measurementContext: {
            ...measurementContext,
            brandNameCheck: checkBrandNameAgainstSite(
              storedResult.brandName,
              storedResult.domain,
              site
            ),
          },
        }
      : {}),
    metrics: {
      ...result.metrics,
      ...aggregateAudit(
        responses,
        typeof storedResult.domain === "string"
          ? storedResult.domain
          : undefined
      ),
      // 헤드라인 4분류 — 러너가 저장한 값이 아니라 **행에서 다시 센다**(판정이 바뀌면 따라간다).
      answerBuckets: summarizeAnswerBuckets(bucketRows, {
        brandDomain:
          typeof storedResult.domain === "string" ? storedResult.domain : null,
      }),
      ...(coverage ? { questionCoverage: coverage } : {}),
    },
    ...(requiresRevalidation
      ? {
          verificationState: "revalidation_required",
          // Preserve original rows in storage, but never expose old badges as
          // current verdicts alongside provisional aggregate metrics
          // (displayedRows above already carries the neutralised rows).
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

/**
 * Stored figures can differ from the current read-time projection even when no
 * PDF was ever generated. Let every public surface disclose that correction.
 * This is a disclosure signal, not proof that an old email or Blob was recalled.
 */
export function hasRecomputedAuditMetricsChanged(
  original: unknown,
  corrected: unknown
): boolean {
  if (!(isRecord(original) && isRecord(corrected))) {
    return false;
  }
  const stored = original.metrics;
  const current = corrected.metrics;
  if (!(isRecord(stored) && isRecord(current))) {
    return false;
  }
  const displayed = [
    "sov",
    "averageMentionPosition",
    "enginesCovered",
    "enginesWithMention",
    "sentimentDistribution",
    "stubCount",
    "topCitedDomains",
    "answerBuckets",
    "verifiedCount",
    "unverifiedCount",
  ];
  return (
    displayed.some(
      (key) => semanticJson(stored[key]) !== semanticJson(current[key])
    ) || hasChangedAnswerDisplay(original, corrected)
  );
}

/** Fields corrected on read that the one-page PDF renders per answer. */
function hasChangedAnswerDisplay(
  original: unknown,
  corrected: unknown
): boolean {
  if (!(isRecord(original) && isRecord(corrected))) {
    return false;
  }
  const savedRows = original.engineResponses;
  const currentRows = corrected.engineResponses;
  if (!(Array.isArray(savedRows) && Array.isArray(currentRows))) {
    return false;
  }
  const projection = (rows: unknown[]) =>
    rows.map((row) => {
      if (!isRecord(row)) {
        return row;
      }
      return {
        brandMentioned: row.brandMentioned,
        mentionQuality: row.mentionQuality,
        mentionPosition: row.mentionPosition,
        sov: row.sov,
      };
    });
  return (
    semanticJson(projection(savedRows)) !==
    semanticJson(projection(currentRows))
  );
}

/** Report when previously saved advice is suppressed or revised at display time. */
export function hasFilteredStoredAuditAdvice(original: unknown): boolean {
  if (!isRecord(original)) {
    return false;
  }
  if (
    Array.isArray(original.geoActions) &&
    semanticJson(
      filterStoredGeoActions(original.geoActions as Record<string, unknown>[])
    ) !==
      semanticJson(original.geoActions)
  ) {
    return true;
  }
  return (
    Array.isArray(original.topRecommendations) &&
    semanticJson(filterStoredTopRecommendations(original.topRecommendations)) !==
      semanticJson(original.topRecommendations)
  );
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
  // The PDF renders topRecommendations derived from the saved actions. An
  // action may be revised even when the string-only filter misses its claim.
  if (hasFilteredStoredAuditAdvice(original)) {
    return true;
  }
  if (hasChangedAnswerDisplay(original, corrected)) {
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

/** Only PDFs generated by the current versioned writer are linkable. */
export function isCurrentAuditPdfUrl(pdfUrl: string | null | undefined): boolean {
  return typeof pdfUrl === "string" && /\/audits\/audit-v3-[^/?#]+\.pdf(?:[?#]|$)/.test(pdfUrl);
}
