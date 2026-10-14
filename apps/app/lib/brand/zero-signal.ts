import {
  extractCompetitorLandscape,
  type KnownCompetitor,
} from "@repo/audit/competitor-extract";

/**
 * 「아직 어떤 브랜드도 안 나온」 질문(2026-10-14 · 대표 승인) — 최근 측정 1회 기준으로 가려 **참고용**으로 표시한다.
 * 점수 계산은 바꾸지 않고, 삭제도 하지 않는다(고객이 원하면 기존 「보관」으로 측정에서 뺄 수 있다).
 *
 * 이름 없는 질문의 답변은 Tracking 에 저장되지 않아서, 최근 측정 결과(AuditJob.result.engineResponses)의
 * `promptText`·`excerpt` 로 판단한다. 검색 노출(naver·daum)·브리핑·실패·스텁 답변은 보지 않는다.
 * 판단할 수 있는 AI 답변이 **2개 미만**이면 단정하지 않는다(표본 부족).
 */
const NON_AI = new Set(["naver", "daum", "naver-briefing", "hyperclova"]);
export const MIN_ANSWERS_FOR_ZERO_SIGNAL = 2;

interface Row {
  engineId?: unknown;
  errorMessage?: unknown;
  excerpt?: unknown;
  isStub?: unknown;
  promptKind?: unknown;
  promptText?: unknown;
}

export function zeroSignalPromptTexts(
  result: unknown,
  brand: {
    competitors?: readonly (KnownCompetitor | string)[];
    name: string;
    variants?: readonly string[];
  }
): Set<string> {
  const rows =
    result && typeof result === "object"
      ? (result as { engineResponses?: unknown }).engineResponses
      : null;
  if (!Array.isArray(rows)) {
    return new Set();
  }
  const byPrompt = new Map<string, string[]>();
  for (const raw of rows as Row[]) {
    if (
      !raw ||
      typeof raw.promptText !== "string" ||
      raw.promptKind === "brand" ||
      typeof raw.engineId !== "string" ||
      NON_AI.has(raw.engineId) ||
      raw.isStub === true ||
      (typeof raw.errorMessage === "string" && raw.errorMessage.length > 0) ||
      typeof raw.excerpt !== "string" ||
      raw.excerpt.length === 0
    ) {
      continue;
    }
    byPrompt.set(raw.promptText, [
      ...(byPrompt.get(raw.promptText) ?? []),
      raw.excerpt,
    ]);
  }
  const zero = new Set<string>();
  for (const [text, excerpts] of byPrompt) {
    if (excerpts.length < MIN_ANSWERS_FOR_ZERO_SIGNAL) {
      continue;
    }
    const landscape = extractCompetitorLandscape(
      excerpts,
      brand.name,
      [...(brand.variants ?? [])],
      [...(brand.competitors ?? [])]
    );
    if (landscape.ranking.length === 0 && !landscape.brandFound) {
      zero.add(text.trim());
    }
  }
  return zero;
}
