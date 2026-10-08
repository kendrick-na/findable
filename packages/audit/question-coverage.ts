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

/**
 * 이름 없는 질문(discovery) 중 **실제로 물어본** 질문 수(2026-10-06).
 *
 * 질문 시작 마감이 일부 질문을 잘라도 회차는 공개된다(discovery 는 점수에 안 들어간다).
 * 화면이 「질문 n개 중 m개만 측정했어요」라고 말하려면 계획 수(measurementContext
 * .discoveryPromptCount)와 이 값이 필요하다. 엔진 실패 답도 「물어본 것」으로 센다 —
 * 실패는 기존 「측정 실패 n개는 뺐어요」 문구가 따로 말한다.
 */
export function askedDiscoveryQuestionCount(rows: unknown): number {
  if (!Array.isArray(rows)) {
    return 0;
  }
  const asked = new Set<string>();
  for (const candidate of rows) {
    if (
      !(
        isRow(candidate) &&
        typeof candidate.engineId === "string" &&
        isDiscoveryAnswer(candidate)
      )
    ) {
      continue;
    }
    const group = answerGroup(candidate.engineId);
    if (group === "briefing" || group === "retired") {
      continue;
    }
    const key = questionKey(candidate);
    if (key !== null) {
      asked.add(key);
    }
  }
  return asked.size;
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
