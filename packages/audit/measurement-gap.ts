/**
 * 측정 구멍 기록(2026-10-19) — 「왜 못 쟀나·왜 질문이 적나」를 코드로 분류해 결과에 남긴다.
 *
 * 왜: 52곳 동기 측정에서 6곳이 측정되지 못하고 12곳이 질문 8개 미만이었는데, 원인(robots 차단·인증서 오류·
 *   확신 없음으로 질문 폐기·이름 질문 전멸)을 **사후에 사람이 로그를 뒤져서** 알아냈다. 같은 일이 또 나면 시작 전·후에 바로 보이게 한다.
 * 규칙
 *  - 순수 계산·기록 전용. 점수·집계·측정 흐름을 바꾸지 않는다(호출부 게이트는 따로).
 *  - 플래그 MEASUREMENT_GAP_LOG_ENABLED 가 꺼져 있으면 결과에 아무 키도 붙지 않는다(기존 JSON 과 동일).
 *  - 오류 문구 원문·질문 문장·회사명·도메인은 담지 않는다(코드·개수만).
 */
import type { SiteReadOutcome } from "./site-profile";

const ON_VALUES = new Set(["1", "true"]);

export function isMeasurementGapLogEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return ON_VALUES.has(
    (env.MEASUREMENT_GAP_LOG_ENABLED ?? "").trim().toLowerCase()
  );
}

/** 질문 세트가 이 수보다 적으면 경고한다(기본 질문 4개 + 이름 없는 질문이 거의 없다는 뜻). */
export const MIN_HEALTHY_QUESTION_COUNT = 8;

export type GapCode =
  | "all_engines_failed"
  | "certificate_error"
  | "few_questions"
  | "no_brand_question"
  | "render_needed"
  | "robots_blocked"
  | "site_timeout"
  | "site_unreachable"
  | "zero_questions";

export const GAP_LABEL_KO: Record<GapCode, string> = {
  all_engines_failed: "엔진 응답을 하나도 못 받음",
  certificate_error: "사이트 HTTPS 인증서 오류",
  few_questions: `질문 ${MIN_HEALTHY_QUESTION_COUNT}개 미만`,
  no_brand_question: "이름 질문 0개",
  render_needed: "JS 사이트인데 렌더링으로도 재료 부족",
  robots_blocked: "사이트가 AI 접근을 막음(robots)",
  site_timeout: "사이트 읽기 시간 초과",
  site_unreachable: "사이트 접속 실패(기타)",
  zero_questions: "질문 0개",
};

export type GapWarning = Extract<
  GapCode,
  "few_questions" | "no_brand_question" | "zero_questions"
>;

export interface QuestionCounts {
  /** 이름 질문(brand) 수. */
  brandQuestionCount: number;
  questionCount: number;
}

/** 측정 시작 전·후에 같은 규칙으로 질문 세트 경고를 낸다(순수). */
export function questionSetWarnings(counts: QuestionCounts): GapWarning[] {
  if (counts.questionCount <= 0) {
    return ["zero_questions"];
  }
  const out: GapWarning[] = [];
  if (counts.questionCount < MIN_HEALTHY_QUESTION_COUNT) {
    out.push("few_questions");
  }
  if (counts.brandQuestionCount <= 0) {
    out.push("no_brand_question");
  }
  return out;
}

const SITE_CODE: Partial<Record<SiteReadOutcome, GapCode>> = {
  certificate_error: "certificate_error",
  fetch_failed: "site_unreachable",
  not_html: "site_unreachable",
  render_needed: "render_needed",
  robots_blocked: "robots_blocked",
  timeout: "site_timeout",
};

export interface GapClassifyInput extends QuestionCounts {
  engine?: { attempted: number; measured: number };
  siteOutcome?: SiteReadOutcome;
}

/** 못 쟀거나 부족했던 이유를 코드 목록으로(원인 순서: 사이트 → 질문 → 엔진). */
export function classifyGaps(input: GapClassifyInput): GapCode[] {
  const out: GapCode[] = [];
  const site = input.siteOutcome ? SITE_CODE[input.siteOutcome] : undefined;
  if (site) {
    out.push(site);
  }
  out.push(...questionSetWarnings(input));
  if (
    input.engine &&
    input.engine.attempted > 0 &&
    input.engine.measured === 0
  ) {
    out.push("all_engines_failed");
  }
  return out;
}

/** 질문 생성 기록(@repo/ai 의 QuestionGenerationLog)을 그대로 담는 느슨한 형태 — 순환 의존을 피한다. */
export type StoredQuestionGeneration = Record<string, unknown>;

/** 시작 전에 만들어 체크포인트에 보관하는 값(이어가기·재개에서도 같은 값이 결과에 남는다). */
export interface GapPreflight {
  brandQuestionCount: number;
  questionCount: number;
  questionGeneration?: StoredQuestionGeneration;
  siteOutcome?: SiteReadOutcome;
  /** 시작 전 경고(질문 세트 기준). */
  warnings: GapWarning[];
}

export function buildGapPreflight(input: {
  prompts: readonly { kind?: "brand" | "discovery" }[];
  questionGeneration?: StoredQuestionGeneration;
  siteOutcome?: SiteReadOutcome;
}): GapPreflight {
  const counts: QuestionCounts = {
    brandQuestionCount: input.prompts.filter((p) => p.kind !== "discovery")
      .length,
    questionCount: input.prompts.length,
  };
  return {
    ...counts,
    ...(input.questionGeneration
      ? { questionGeneration: input.questionGeneration }
      : {}),
    ...(input.siteOutcome ? { siteOutcome: input.siteOutcome } : {}),
    warnings: questionSetWarnings(counts),
  };
}

/** 결과(measurementContext.gapDiagnostics)에 남기는 값 — 시작 전 기록 + 끝난 뒤 분류. */
export interface GapDiagnostics extends GapPreflight {
  /** 끝난 뒤 최종 분류. 비어 있으면(정상) 키 자체를 싣지 않는 쪽은 호출부가 정한다. */
  codes: GapCode[];
}

export function finalizeGapDiagnostics(
  pre: GapPreflight,
  engine: { attempted: number; measured: number }
): GapDiagnostics {
  return {
    ...pre,
    codes: classifyGaps({
      brandQuestionCount: pre.brandQuestionCount,
      engine,
      questionCount: pre.questionCount,
      siteOutcome: pre.siteOutcome,
    }),
  };
}

export interface GapReportRow {
  codes: readonly GapCode[];
  /** 익명 ID(예: A-30). 회사명·도메인을 넣지 않는다. */
  id: string;
}

/**
 * 측정 완료 보고용 「못 잰 곳 사유별 표」(마크다운). 한 곳이 사유를 여러 개 가지면 각 사유 줄에 모두 나온다.
 * 사유가 없는 곳은 표에 넣지 않고 맨 끝에 「정상 N곳」으로만 센다.
 */
export function formatUnmeasuredTable(rows: readonly GapReportRow[]): string {
  const byCode = new Map<GapCode, string[]>();
  for (const row of rows) {
    for (const code of new Set(row.codes)) {
      byCode.set(code, [...(byCode.get(code) ?? []), row.id]);
    }
  }
  const lines = ["| 사유 | 곳 수 | ID |", "|---|---|---|"];
  const order = Object.keys(GAP_LABEL_KO) as GapCode[];
  for (const code of order) {
    const ids = byCode.get(code);
    if (ids) {
      lines.push(
        `| ${GAP_LABEL_KO[code]} | ${ids.length} | ${[...ids].sort().join(", ")} |`
      );
    }
  }
  const clean = rows.filter((row) => row.codes.length === 0).length;
  lines.push("", `정상(사유 없음) ${clean}곳 / 전체 ${rows.length}곳`);
  return lines.join("\n");
}
