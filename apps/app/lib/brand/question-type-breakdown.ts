import {
  extractCompetitorLandscape,
  type KnownCompetitor,
} from "@repo/audit/competitor-extract";

/**
 * 질문 유형별 노출(2026-10-14 · 대표 승인) — 「우리 이름을 넣은 질문」과 「이름 없이 추천을 묻는 질문」을 나눠 본다.
 *
 * 이름 없는 질문의 답변은 Tracking 에 저장되지 않아(시계열 분모 보호) 메인 점수에는 안 들어간다. 이 카드는 메인 점수를
 * 바꾸지 않고, 측정 결과(AuditJob.result.engineResponses)의 `promptKind` 로 두 갈래를 따로 센다.
 * 검색 노출(naver·daum)·브리핑·실패·스텁 답변은 세지 않는다. 노출 판정은 측정이 이미 내린 `brandMentioned` 를 그대로 쓴다.
 */
const NON_AI = new Set(["naver", "daum", "naver-briefing", "hyperclova"]);

export interface KindStats {
  /** 판단에 쓴 AI 답변 수. */
  answers: number;
  /** 우리 브랜드가 나온 답변 수. */
  mentioned: number;
  /** 0~100, 답변이 없으면 null. */
  ratePct: number | null;
}

export interface QuestionTypeBreakdown {
  /** 이름 없는 질문에서 AI 가 같은 질문에 나열한 다른 브랜드의 평균 수(질문별). 계산할 답변이 없으면 null. */
  competitorsListedAvg: number | null;
  named: KindStats;
  nameless: KindStats;
  /** 같은 질문 세트로 측정했는지 비교하는 열쇠(없으면 null). */
  questionSetKey: string | null;
}

interface Row {
  brandMentioned?: unknown;
  engineId?: unknown;
  errorMessage?: unknown;
  excerpt?: unknown;
  isStub?: unknown;
  promptKind?: unknown;
  promptText?: unknown;
}

const stats = (answers: number, mentioned: number): KindStats => ({
  answers,
  mentioned,
  ratePct: answers === 0 ? null : Math.round((mentioned / answers) * 100),
});

export function questionTypeBreakdown(
  result: unknown,
  brand: {
    competitors?: readonly (KnownCompetitor | string)[];
    name: string;
    variants?: readonly string[];
  }
): QuestionTypeBreakdown | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const shape = result as {
    engineResponses?: unknown;
    measurementContext?: { questionSetKey?: unknown };
  };
  if (!Array.isArray(shape.engineResponses)) {
    return null;
  }
  const count = { named: [0, 0], nameless: [0, 0] };
  const byPrompt = new Map<string, string[]>();
  for (const raw of shape.engineResponses as Row[]) {
    if (
      !raw ||
      typeof raw.engineId !== "string" ||
      NON_AI.has(raw.engineId) ||
      raw.isStub === true ||
      (typeof raw.errorMessage === "string" && raw.errorMessage.length > 0)
    ) {
      continue;
    }
    const bucket =
      raw.promptKind === "discovery" ? count.nameless : count.named;
    bucket[0] += 1;
    if (raw.brandMentioned === true) {
      bucket[1] += 1;
    }
    if (
      raw.promptKind === "discovery" &&
      typeof raw.promptText === "string" &&
      typeof raw.excerpt === "string" &&
      raw.excerpt.length > 0
    ) {
      byPrompt.set(raw.promptText, [
        ...(byPrompt.get(raw.promptText) ?? []),
        raw.excerpt,
      ]);
    }
  }
  const listed = [...byPrompt.values()].map(
    (excerpts) =>
      extractCompetitorLandscape(
        excerpts,
        brand.name,
        [...(brand.variants ?? [])],
        [...(brand.competitors ?? [])]
      ).ranking.length
  );
  const key = shape.measurementContext?.questionSetKey;
  return {
    named: stats(count.named[0], count.named[1]),
    nameless: stats(count.nameless[0], count.nameless[1]),
    competitorsListedAvg:
      listed.length === 0
        ? null
        : Math.round((listed.reduce((a, b) => a + b, 0) / listed.length) * 10) /
          10,
    questionSetKey: typeof key === "string" && key.length > 0 ? key : null,
  };
}

export type BaselineState =
  | { kind: "first" }
  | { fromPct: number; kind: "same"; toPct: number }
  | { kind: "changed" };

/** 처음 측정과 지금을 견줄 수 있는지(같은 질문 세트일 때만 숫자를 비교한다). */
export function baselineStateOf(
  latest: QuestionTypeBreakdown,
  baseline: QuestionTypeBreakdown | null,
  sameJob: boolean
): BaselineState {
  if (!baseline || sameJob || baseline.nameless.ratePct === null) {
    return { kind: "first" };
  }
  if (
    !(latest.questionSetKey && baseline.questionSetKey) ||
    latest.questionSetKey !== baseline.questionSetKey ||
    latest.nameless.ratePct === null
  ) {
    return { kind: "changed" };
  }
  return {
    kind: "same",
    fromPct: baseline.nameless.ratePct,
    toPct: latest.nameless.ratePct,
  };
}
