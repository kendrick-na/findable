import { aggregateAudit } from "@repo/ai/lib/engines/aggregate";
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

/**
 * Rebuild displayed metrics from the immutable engine rows in saved jobs.
 * Old snapshots counted sentiment for unrelated answers and could carry a
 * ranking from a rejected entity. Naver AI Briefing stays a separate channel.
 * Stored raw data and the historical PDF are not mutated.
 */
export function withRecomputedAuditMetrics<T>(result: T): T {
  if (!isRecord(result) || !isRecord(result.metrics)) {
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
  const responses: EngineResponse[] = core.map((row) => ({
    engineId: row.engineId as EngineId,
    brandMentioned: row.brandMentioned === true,
    mentionPosition: positiveNumber(row.mentionPosition),
    mentionListSize: positiveNumber(row.mentionListSize),
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
  return {
    ...result,
    metrics: { ...result.metrics, ...aggregateAudit(responses) },
  } as T;
}
