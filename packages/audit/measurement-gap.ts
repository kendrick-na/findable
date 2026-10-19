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
/** 이름 질문(우리 이름이 들어간 질문) 최소 수 — 0개는 이름 인식 지표가 아예 없다. 1개는 한 번의 흔들림에 취약하다. */
export const MIN_BRAND_QUESTION_COUNT = 2;

export type GapCode =
  | "all_engines_failed"
  | "cert_chain_error"
  | "cert_expired"
  | "cert_host_mismatch"
  | "cert_self_signed"
  | "certificate_error"
  | "few_brand_questions"
  | "few_questions"
  | "image_text_failed"
  | "no_brand_question"
  | "prepare_error"
  | "render_needed"
  | "robots_blocked"
  | "site_timeout"
  | "site_unreachable"
  | "thin_after_render"
  | "unclassified"
  | "zero_questions";

export const GAP_LABEL_KO: Record<GapCode, string> = {
  all_engines_failed: "엔진 응답을 하나도 못 받음",
  cert_chain_error: "사이트 HTTPS 인증서 체인 오류(중간 인증서 누락·신뢰 불가)",
  cert_expired: "사이트 HTTPS 인증서 만료",
  cert_host_mismatch: "사이트 HTTPS 인증서가 접속 호스트 이름을 포함하지 않음",
  cert_self_signed: "사이트 HTTPS 인증서가 자체 서명",
  certificate_error: "사이트 HTTPS 인증서 오류",
  few_brand_questions: `이름 질문 ${MIN_BRAND_QUESTION_COUNT}개 미만`,
  few_questions: `질문 ${MIN_HEALTHY_QUESTION_COUNT}개 미만`,
  image_text_failed:
    "글이 이미지 안에 있는데 이미지 글자 읽기로도 재료를 못 채움",
  no_brand_question: "이름 질문 0개",
  prepare_error: "측정 준비 단계 오류",
  render_needed: "JS 사이트인데 렌더링으로도 재료 부족",
  robots_blocked: "사이트가 AI 접근을 막음(robots)",
  site_timeout: "사이트 읽기 시간 초과",
  site_unreachable: "사이트 접속 실패(기타)",
  thin_after_render:
    "렌더링 후에도 글자 거의 없음(글이 이미지 안에 있는 사이트)",
  unclassified: "사유 미분류(기록 누락 — 점검 필요)",
  zero_questions: "질문 0개",
};

/**
 * 사유별 다음 행동 안내(운영자·측정 담당용 — 고객 화면 문구가 아니다). 결과 JSON·보고 표에서만 쓴다.
 * 「정직한 측정 불가」(우회하지 않는 것)와 「코드로 풀 수 있는 것」을 가른다.
 */
export const GAP_ACTION_KO: Record<GapCode, string> = {
  all_engines_failed: "엔진 키·한도·장애 확인 후 재측정(엔진별 오류 기록 참고)",
  cert_chain_error:
    "측정 불가로 보고(사이트 운영자가 인증서 체인을 고쳐야 함 — 우회 금지). 한 줄 소개 입력으로 대체 가능",
  cert_expired:
    "측정 불가로 보고(사이트 운영자가 인증서를 갱신해야 함 — 우회 금지). 한 줄 소개 입력으로 대체 가능",
  cert_host_mismatch:
    "측정 불가로 보고(인증서가 이 호스트 이름을 포함하지 않음 — 검증을 끄지 않는다). 공개 읽기 전용에 한해 http 폴백(SITE_HTTP_FALLBACK_ENABLED, 정책 판단 필요) 또는 한 줄 소개 입력",
  cert_self_signed:
    "측정 불가로 보고(자체 서명 인증서 — 우회 금지). 한 줄 소개 입력으로 대체 가능",
  certificate_error:
    "측정 불가로 보고(사이트 운영자의 인증서 수리 외 방법 없음 — 우회 금지). 한 줄 소개 입력으로 대체 가능",
  few_brand_questions:
    "이름 질문 보증(QUESTION_BRAND_GUARANTEE_ENABLED) 켜고 재생성",
  image_text_failed:
    "한 줄 소개 입력으로 대체 측정(이미지 글자 읽기 상한·형식·모델 응답 확인 — 실호출 검증 필요)",
  few_questions:
    "단계적 폴백(QUESTION_STEPWISE_FALLBACK_ENABLED)·소프트 확신 켜고 재생성, 그래도 모자라면 측정 불가로 보고",
  no_brand_question:
    "이름 질문 보증(QUESTION_BRAND_GUARANTEE_ENABLED) 켜고 재생성",
  prepare_error: "준비 단계 오류 메시지 확인 후 재시도",
  render_needed:
    "SITE_RENDER_ENABLED 를 운영과 같게 켜고 재시도, 안 되면 한 줄 소개 입력",
  robots_blocked:
    "측정 불가로 보고(robots 우회 금지). 한 줄 소개 입력으로 대체 측정은 가능하며 별도 표기",
  site_timeout:
    "재시도(큰 페이지는 앞 500KB만 읽음), 반복되면 사이트 응답 속도 문제로 보고",
  site_unreachable:
    "접속 실패 원인 확인(DNS·차단) 후 재시도, 한 줄 소개 입력으로 대체 가능",
  thin_after_render:
    "한 줄 소개 입력으로 대체 측정(렌더링으로는 풀리지 않음 — 이미지 읽기는 보류 기능)",
  unclassified: "사유 기록 누락 — 코드 점검 필요(이 값이 나오면 버그)",
  zero_questions: "한 줄 소개 입력 또는 업종 직접 지정 후 재생성",
};

export type GapWarning = Extract<
  GapCode,
  | "few_brand_questions"
  | "few_questions"
  | "no_brand_question"
  | "zero_questions"
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
  } else if (counts.brandQuestionCount < MIN_BRAND_QUESTION_COUNT) {
    out.push("few_brand_questions");
  }
  return out;
}

/**
 * 측정 시작 불변식(2026-10-19) — 질문 ≥ 8 이고 이름 질문 ≥ 2 이거나, 아니면 **사유 코드가 붙은 측정 불가**다.
 * 조용한 0문항·4문항·이름 0개로 측정이 진행되는 경로를 없애는 기준이다(경고 규칙과 같은 판정을 쓴다).
 */
export function checkQuestionInvariant(
  counts: QuestionCounts
): { ok: true } | { codes: GapWarning[]; ok: false } {
  const codes = questionSetWarnings(counts);
  return codes.length === 0 ? { ok: true } : { codes, ok: false };
}

/** 측정 불가로 끝낼 때 오류 문구 머리표. 사유 코드가 뒤따른다(예: `UNMEASURABLE:few_questions,no_brand_question`). */
export const UNMEASURABLE_PREFIX = "UNMEASURABLE:";

export function unmeasurableMessage(codes: readonly GapCode[]): string {
  return `${UNMEASURABLE_PREFIX}${ensureReasonCodes(codes).join(",")}`;
}

/** 실패인데 사유가 비어 있으면 `unclassified` 를 붙인다 — 「사유 없는 실패」를 만들지 않는 마지막 보증. */
export function ensureReasonCodes(codes: readonly GapCode[]): GapCode[] {
  return codes.length > 0 ? [...codes] : ["unclassified"];
}

const PREFIXED_CODE_RE = /^UNMEASURABLE:([a-z_,]+)/;
const NO_PROMPTS_RE = /no prompts|no_questions/i;
const PREPARE_ERROR_RE = /^prepare_error/i;

/**
 * 실패 메시지(작업 오류·스크립트 사유 문자열)를 사유 코드로 옮긴다 — **항상 코드가 1개 이상** 나온다(마지막 보증 = prepare_error/unclassified).
 * `UNMEASURABLE:` 머리표가 있으면 그 코드들을 그대로 읽는다.
 */
export function classifyFailureMessage(
  message: string | null | undefined
): GapCode[] {
  const text = (message ?? "").trim();
  const prefixed = PREFIXED_CODE_RE.exec(text);
  if (prefixed?.[1]) {
    const known = prefixed[1]
      .split(",")
      .filter((c): c is GapCode => c in GAP_LABEL_KO);
    return ensureReasonCodes(known);
  }
  if (NO_PROMPTS_RE.test(text)) {
    return ["zero_questions"];
  }
  if (PREPARE_ERROR_RE.test(text)) {
    return ["prepare_error"];
  }
  return text ? ["unclassified"] : ensureReasonCodes([]);
}

const INVARIANT_ON_VALUES = new Set(["1", "true"]);

/** 시작 불변식 강제(플래그 MEASUREMENT_INVARIANT_ENABLED, 기본 꺼짐) — 호출부가 `requireQuestionInvariant` 로 opt-in 해야 적용된다. */
export function isMeasurementInvariantEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return INVARIANT_ON_VALUES.has(
    (env.MEASUREMENT_INVARIANT_ENABLED ?? "").trim().toLowerCase()
  );
}

const SITE_CODE: Partial<Record<SiteReadOutcome, GapCode>> = {
  cert_chain_error: "cert_chain_error",
  cert_expired: "cert_expired",
  cert_host_mismatch: "cert_host_mismatch",
  cert_self_signed: "cert_self_signed",
  certificate_error: "certificate_error",
  image_text_failed: "image_text_failed",
  fetch_failed: "site_unreachable",
  not_html: "site_unreachable",
  render_needed: "render_needed",
  robots_blocked: "robots_blocked",
  thin_after_render: "thin_after_render",
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
  /** 인증서 오류로 평문 http 폴백 읽기를 썼다(기록 전용). */
  siteHttpFallback?: true;
  /** 이미지 속 글자 읽기 집계(시도·성공·추정 원가). 원본 이미지·글자 원문은 담지 않는다. */
  siteImageText?: Record<string, number>;
  siteOutcome?: SiteReadOutcome;
  /** 시작 전 경고(질문 세트 기준). */
  warnings: GapWarning[];
}

export function buildGapPreflight(input: {
  prompts: readonly { kind?: "brand" | "discovery" }[];
  questionGeneration?: StoredQuestionGeneration;
  siteHttpFallback?: boolean;
  siteImageText?: Record<string, number>;
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
    ...(input.siteHttpFallback ? { siteHttpFallback: true as const } : {}),
    ...(input.siteImageText ? { siteImageText: input.siteImageText } : {}),
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
