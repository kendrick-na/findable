import { answerGroup, isDiscoveryAnswer } from "./answer-buckets";

interface CoverageCount {
  attempted: number;
  planned: number;
  withSuccessfulAiAnswer: number;
}

export interface QuestionCoverage {
  brand: CoverageCount;
  discovery: CoverageCount;
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function isRow(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function questionKey(row: Record<string, unknown>): string | null {
  const index = nonnegativeInteger(row.promptIndex);
  if (index !== null) {
    return `index:${index}`;
  }
  return typeof row.promptText === "string" && row.promptText.trim()
    ? `text:${row.promptText}`
    : null;
}

/** Search exposure and failed AI calls cannot complete a planned AI question. */
export function questionCoverage(
  result: Record<string, unknown>
): QuestionCoverage | null {
  const planned = nonnegativeInteger(result.promptsCount);
  const context = isRow(result.measurementContext)
    ? result.measurementContext
    : null;
  const discoveryPlanned =
    nonnegativeInteger(context?.discoveryPromptCount) ?? 0;
  if (
    planned === null ||
    discoveryPlanned > planned ||
    !Array.isArray(result.engineResponses)
  ) {
    return null;
  }
  const attempted = { brand: new Set<string>(), discovery: new Set<string>() };
  const successful = { brand: new Set<string>(), discovery: new Set<string>() };
  for (const candidate of result.engineResponses) {
    if (!isRow(candidate) || typeof candidate.engineId !== "string") {
      return null;
    }
    const group = answerGroup(candidate.engineId);
    // On-demand briefing and retired historical engines are not part of the
    // question plan; briefing rows may legitimately omit prompt identity.
    if (group === "briefing" || group === "retired") {
      continue;
    }
    const key = questionKey(candidate);
    if (key === null) {
      return null;
    }
    const kind = isDiscoveryAnswer(candidate) ? "discovery" : "brand";
    attempted[kind].add(key);
    if (
      group === "ai" &&
      !candidate.errorMessage &&
      candidate.isStub !== true
    ) {
      successful[kind].add(key);
    }
  }
  return {
    brand: {
      attempted: attempted.brand.size,
      planned: planned - discoveryPlanned,
      withSuccessfulAiAnswer: successful.brand.size,
    },
    discovery: {
      attempted: attempted.discovery.size,
      planned: discoveryPlanned,
      withSuccessfulAiAnswer: successful.discovery.size,
    },
  };
}
