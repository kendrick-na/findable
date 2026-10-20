// 증거 한 장 문구 사전·금칙어 검사·한계 3줄 (EV-c, S2) — 2026-10-21.
//
// 역할
//   1. 문구 사전 `EVIDENCE_COPY` (ko·en 틀). 5분류 문구는 `ANSWER_BUCKET_COPY_KO/EN` 을 재사용(새로 만들지 않음).
//   2. `buildEvidenceSheetView(input, opts)` — EV-a 가 만든 `EvidenceSheetInput` → 사람이 읽는 줄·표 묶음(순수 함수).
//      md/HTML 출력 스크립트가 이 묶음을 그대로 찍는다. 화면(UI) 코드는 이 파일에 없다.
//   3. 금칙어 검사 `scanBannedPhrases` — **이 파일이 목록의 단일 소유**(`PROOF_BANNED_PHRASES`·허용 목록).
//   4. 한계 3줄 고정 `buildLimits` — 항상 3줄이 나온다.
//
// 표시 규칙: 비율은 0~1 소수로 들어와 **표시 단계에서만** 정수 퍼센트로 반올림한다.
//   값 상태 4종(관측 0·미수집·미설정·확인 불가)과 기준일을 값마다 붙인다. 못 잰 값을 0 으로 쓰지 않는다.
//   효과·원인·지속 효과·트래픽·매출을 말하지 않는다.
//
// ⚠️ 금칙어 검사는 부분 문자열 단순 차단이 아니다: 필수 한계 문장 「독립이 아님」이 「독립」에 걸리지 않도록
//   **부정 표현 허용 목록**을 먼저 가린 뒤(마스킹) 금칙어를 찾는다. 허용 문장은 모두 부정형이어야 한다(시험으로 강제).

import {
  ANSWER_BUCKET_COPY_EN,
  ANSWER_BUCKET_COPY_KO,
  type AnswerBucket,
} from "./answer-buckets";
import type {
  EvidenceSheetInput,
  Known,
  LimitsBlock,
  NotComparableReason,
  ObservedValues,
  ProofLanguage,
  ProofMetricGroup,
  UnavailableReason,
} from "./proof-types";
import { NOT_COMPARABLE_REASONS } from "./proof-types";

// ───────────────────────── 금칙어 ─────────────────────────

/** 부분 문자열(소문자 비교) 금칙어. 효과 입증·최초·유일·독립 기관·정확도 보장 등. */
export const PROOF_BANNED_PHRASES: readonly string[] = [
  // 한국어
  "효과 입증",
  "덕분에 올랐",
  "노출을 높여드",
  "순위를 올려",
  "1위로",
  "매출을 늘려",
  "최초",
  "유일",
  "독립 기관",
  "독립기관",
  "독립 검증",
  "독립적으로",
  "정확도를 보장",
  "정확도 보장",
  "객관적입니다",
  "검증됨",
  "한국 전용",
  "글로벌 플랫폼",
  "대표 계정에서만",
  "동등",
  "대체",
  "호환",
  "soc 2",
  "soc2",
  "gdpr 준수",
  // 영어
  "proof of effect",
  "proof of the effect",
  "proves the effect",
  "guaranteed accuracy",
  "accuracy guarantee",
  "world's first",
  "first-ever",
  "first ever",
  "the only ",
  "independent audit",
  "independent verification",
  "independently verified",
  "independent body",
  "independent institution",
  "gdpr compliant",
  "gdpr-compliant",
  "korea-only",
  "global platform",
  "drop-in replacement",
  "compatible with",
  "boost your visibility",
  "raise your ranking",
];

/** 단어 경계가 필요한 영어 금칙어(부분 일치 오탐 방지). */
export const PROOF_BANNED_PATTERNS: readonly RegExp[] = [
  /\bverified\b/i,
  /\bvalidated\b/i,
  /\bguarantees?\b(?! accuracy)/i,
];

/**
 * 허용 문장(부정 표현). 이 문장 안의 금칙어는 통과시킨다. **모두 부정형**이어야 한다(시험이 확인).
 * 목록을 늘릴 때는 통합 전담이 최종 문구를 한 번 훑는다.
 */
export const PROOF_ALLOWED_SENTENCES: readonly string[] = [
  // 한국어
  "독립이 아님",
  "독립이 아닙니다",
  "독립 검증셋이 아님",
  "독립 검증셋이 아닙니다",
  "독립 표본으로 세지 않음",
  "독립 표본으로 세지 않습니다",
  "독립 기관이 아님",
  "독립 기관이 아닙니다",
  "독립 기관의 검증이 아님",
  "효과 입증 아님",
  "효과 입증이 아님",
  "효과 입증이 아닙니다",
  "정확도를 보장하지 않습니다",
  "정확도 보장이 아닙니다",
  "최초 측정",
  // 영어
  "not independent",
  "not an independent validation set",
  "not proof of effect",
  "not a guarantee",
  "does not guarantee",
];

const NEGATION_MARKERS = ["아님", "아닙", "않", "not "] as const;

/** 허용 문장 하나가 부정형인지(시험용). 「최초 측정」은 일반 용법이라 예외. */
export function isNegativeAllowedSentence(sentence: string): boolean {
  if (sentence === "최초 측정") {
    return true;
  }
  return NEGATION_MARKERS.some((marker) => sentence.includes(marker));
}

export interface BannedHit {
  phrase: string;
}

/** 금칙어를 찾는다. 허용 문장은 먼저 가린다. 빈 배열이면 통과. */
export function scanBannedPhrases(text: string): BannedHit[] {
  let masked = text.toLowerCase();
  for (const allowed of PROOF_ALLOWED_SENTENCES) {
    masked = masked.split(allowed.toLowerCase()).join("\u0000");
  }
  const hits: BannedHit[] = [];
  for (const phrase of PROOF_BANNED_PHRASES) {
    if (masked.includes(phrase)) {
      hits.push({ phrase });
    }
  }
  for (const pattern of PROOF_BANNED_PATTERNS) {
    if (pattern.test(masked)) {
      hits.push({ phrase: String(pattern) });
    }
  }
  return hits;
}

// ───────────────────────── 문구 사전 ─────────────────────────

export type SectionId =
  | "before_after"
  | "confounders"
  | "finding"
  | "footer"
  | "limits"
  | "method"
  | "numbers"
  | "sample"
  | "unmeasured";

export interface EvidenceCopyDict {
  as_of: string;
  as_of_unknown: string;
  ba_headers: readonly string[];
  ba_none: string;
  ba_not_applicable: string;
  ba_pairs: string;
  ba_row_arm_control: string;
  ba_row_arm_treated: string;
  ba_summary_difference: string;
  ba_summary_prereg: string;
  bucket_line: string;
  collection_line: string;
  collection_unit_cell: string;
  collection_unit_engine: string;
  conf_engine_model: string;
  conf_index_checked: string;
  conf_index_indexed: string;
  conf_index_none: string;
  conf_index_not_indexed: string;
  conf_region: string;
  conf_retrieval: string;
  conf_source_urls: string;
  conf_urls_more: string;
  conf_urls_none: string;
  draft_label: string;
  exposure_line: string;
  exposure_rate_null: string;
  finding_not_comparable: string;
  finding_observed: string;
  first_line: string;
  footer_line: string;
  group_label: Record<ProofMetricGroup, string>;
  heading: Record<SectionId, string>;
  interval_line: string;
  interval_unavailable: string;
  limits_1: string;
  limits_2: string;
  limits_3_none: string;
  limits_3_pilot: string;
  method_interval_bootstrap: string;
  method_interval_wilson: string;
  method_line: string;
  nc_repeats_only: string;
  not_comparable_labels: Record<NotComparableReason, string>;
  retrieval_labels: Record<string, string>;
  sample_brand: string;
  sample_engines: string;
  sample_jobs: string;
  sample_label: string;
  sample_language: string;
  sample_measured: string;
  sample_question_set: string;
  sample_questions_unknown: string;
  sample_repeats: string;
  sample_verdict: string;
  second_line: string;
  state_labels: {
    not_collected: string;
    not_configured: string;
    observed_zero: string;
    unavailable: string;
  };
  suppressed_line: string;
  title: string;
  un_empty: string;
  un_headers: readonly string[];
}

const KO: EvidenceCopyDict = {
  as_of: "기준일 {date}",
  as_of_unknown: "기준일 불명",
  ba_headers: [
    "짝",
    "구분",
    "전",
    "후",
    "차이",
    "반복(전/후)",
    "비교 불가 사유",
  ],
  ba_none: "-",
  ba_not_applicable: "이 장에는 전후 비교가 없습니다.",
  ba_pairs:
    "같은 조건 짝 {pairs}개(사전 등록 최소 {min}개) · 처방군 비교 가능 {tPairs}쌍 · 대조군 비교 가능 {cPairs}쌍",
  ba_row_arm_control: "대조군",
  ba_row_arm_treated: "처방군",
  ba_summary_difference:
    "처방군 평균 변화와 대조군 평균 변화의 차이: {diff} (표이며 판정이 아닙니다)",
  ba_summary_prereg: "사전 등록 {id}",
  bucket_line: "답변 분류: {parts}",
  collection_line:
    "{attempted}건 중 {measured}건 수집{rate}, 반복 {repeats}회 (단위: {unit})",
  collection_unit_cell: "질문×엔진 칸",
  collection_unit_engine: "엔진 수",
  conf_engine_model: "엔진·모델 버전",
  conf_index_checked: "색인 확인",
  conf_index_none: "색인 확인 방법 없음",
  conf_index_not_indexed: "색인 확인 결과: 색인 안 됨",
  conf_index_indexed: "색인 확인 결과: 색인됨",
  conf_region: "지역: 기록 칸 없음(확인 불가)",
  conf_retrieval: "검색 호출(retrieval_used)",
  conf_source_urls: "출처 URL",
  conf_urls_more: "외 {n}개",
  conf_urls_none: "없음",
  draft_label: "시안·시연용 문구 — 확정 전",
  exposure_line: "{label}: {rate} ({count}/{denominator}건)",
  exposure_rate_null: "{label}: 계산 불가(분모 0)",
  finding_not_comparable:
    "비교 불가({reasons}). 이 장은 발견을 말하지 않습니다.",
  finding_observed:
    "이 표본에서 관찰된 값: {label} {rate} ({count}/{denominator}건), 반복 {repeats}회.",
  first_line:
    "AI가 우리 브랜드를 어떻게 말하고, 무엇을 빠뜨리는지 한 장으로 확인하세요.",
  footer_line:
    "기준일 {as_of} · 출처 식별자 {ids} · 코호트 키 {cohort} · 효과 입증 아님",
  group_label: {
    ai_brand: "제대로 앎 비율",
    discovery: "이름 없이 추천된 비율",
    search: "검색 결과 노출 비율",
  },
  heading: {
    before_after: "전후",
    confounders: "교란",
    finding: "발견",
    footer: "푸터",
    limits: "한계 3줄",
    method: "방법",
    numbers: "수치",
    sample: "표본",
    unmeasured: "못 잰 사유",
  },
  interval_line: "95% 구간 {low}~{high}",
  interval_unavailable: "구간: 계산 불가",
  limits_1:
    "이 표본은 대표 본인과 영업 목적의 측정에 치우쳐 있어, 다른 브랜드나 고객 전체의 모습으로 읽을 수 없습니다.",
  limits_2:
    "같은 질문을 반복한 답변은 독립이 아닙니다. 반복 횟수를 표본 수로 세지 않고 변동으로만 봅니다.",
  limits_3_none:
    "판정은 AI가 합니다. 이 장에는 사람 검수 결과가 포함되어 있지 않습니다.",
  limits_3_pilot:
    "판정은 AI가 합니다. 사람 검수는 한 명의 검수자가 {n}건을 본 파일럿입니다.",
  method_interval_bootstrap: "문항 단위 부트스트랩 95% 구간",
  method_interval_wilson: "Wilson 95% 구간",
  method_line:
    "판정: 규칙 → AI(LLM) 순서 · 구간: {interval} · 같은 조건끼리만 합침",
  nc_repeats_only: "반복 {repeats}회뿐",
  not_comparable_labels: {
    collection_rate_shift: "수집률 급변",
    denominator_zero: "분모 0",
    engine_set_differs: "엔진 세트 다름",
    language_differs: "언어 다름",
    mixed_cohort: "조건이 섞임",
    no_baseline: "기준선 없음",
    no_control_pair: "대조군 짝 없음",
    pairs_insufficient: "짝 부족",
    question_set_differs: "질문 세트 다름",
    repeats_insufficient: "반복 부족",
    sampling_version_differs: "측정 방식 다름",
    verdict_version_differs: "판정 버전 다름",
  },
  retrieval_labels: {
    mixed: "엔진마다 다름",
    not_used: "사용 안 함",
    unknown: "알 수 없음",
    used: "사용함",
  },
  sample_brand: "브랜드: {brand}",
  sample_engines: "AI 엔진·칸: {n}",
  sample_jobs: "회차 {n}개",
  sample_language: "측정 언어: {language}",
  sample_measured: "측정일(한국 시간): {range}",
  sample_question_set: "질문 세트 지문: {key}",
  sample_questions_unknown: "질문 수: 계약에 칸 없음(확인 불가)",
  sample_repeats: "반복: {k}회",
  sample_verdict: "판정 버전: {v}",
  sample_label: "샘플 — 실제 고객 자료가 아닙니다",
  second_line: "측정한 결과와 아직 확인하지 못한 항목을 구분해 보여줍니다.",
  state_labels: {
    not_collected: "미수집",
    not_configured: "미설정",
    observed_zero: "관측 0",
    unavailable: "확인 불가",
  },
  suppressed_line:
    "표본이 표시 기준에 못 미쳐 비율을 숨겼습니다(건수는 위 줄 참고).",
  title: "증거 한 장",
  un_empty: "기록된 못 잰 항목이 없습니다.",
  un_headers: ["사유", "칸 수", "비율", "다음 행동"],
};

const EN: EvidenceCopyDict = {
  as_of: "as of {date}",
  as_of_unknown: "date unknown",
  ba_headers: [
    "Pair",
    "Arm",
    "Before",
    "After",
    "Change",
    "Repeats (before/after)",
    "Not comparable because",
  ],
  ba_none: "-",
  ba_not_applicable: "This sheet has no before/after comparison.",
  ba_pairs:
    "Same-condition pairs: {pairs} (preregistered minimum {min}) · comparable treated pairs {tPairs} · comparable control pairs {cPairs}",
  ba_row_arm_control: "control",
  ba_row_arm_treated: "treated",
  ba_summary_difference:
    "Treated mean change minus control mean change: {diff} (a table, not a verdict)",
  ba_summary_prereg: "Preregistration {id}",
  bucket_line: "Answer classes: {parts}",
  collection_line:
    "{measured} of {attempted} collected{rate}, {repeats} repeats (unit: {unit})",
  collection_unit_cell: "question x engine cells",
  collection_unit_engine: "engines",
  conf_engine_model: "Engine and model version",
  conf_index_checked: "Index check",
  conf_index_none: "No index-check method",
  conf_index_not_indexed: "Index check result: not indexed",
  conf_index_indexed: "Index check result: indexed",
  conf_region: "Region: no field recorded (unavailable)",
  conf_retrieval: "Web search used (retrieval_used)",
  conf_source_urls: "Source URLs",
  conf_urls_more: "and {n} more",
  conf_urls_none: "none",
  draft_label: "Draft and demo wording - not final",
  exposure_line: "{label}: {rate} ({count}/{denominator})",
  exposure_rate_null: "{label}: cannot be computed (denominator 0)",
  finding_not_comparable:
    "Not comparable ({reasons}). This sheet states no finding.",
  finding_observed:
    "Observed in this sample: {label} {rate} ({count}/{denominator}), {repeats} repeats.",
  first_line:
    "See how AI describes your brand, and what it leaves out, on one page.",
  footer_line:
    "As of {as_of} · Source IDs {ids} · Cohort key {cohort} · Not proof of effect",
  group_label: {
    ai_brand: "Share that knows the brand",
    discovery: "Share recommended without the name",
    search: "Share shown in search results",
  },
  heading: {
    before_after: "Before and after",
    confounders: "Confounders",
    finding: "Finding",
    footer: "Footer",
    limits: "Three limits",
    method: "Method",
    numbers: "Numbers",
    sample: "Sample",
    unmeasured: "What could not be measured",
  },
  interval_line: "95% interval {low} to {high}",
  interval_unavailable: "Interval: cannot be computed",
  limits_1:
    "This sample leans toward measurements run by the founder and for sales, so it cannot be read as a picture of other brands or of customers in general.",
  limits_2:
    "Repeated answers to the same question are not independent. Repeats are treated as variation, not counted as extra samples.",
  limits_3_none:
    "Verdicts are made by AI. No human review result is included on this sheet.",
  limits_3_pilot:
    "Verdicts are made by AI. Human review is a single-reviewer pilot of {n} cases.",
  method_interval_bootstrap: "question-level bootstrap 95% interval",
  method_interval_wilson: "Wilson 95% interval",
  method_line:
    "Verdicts: rules, then AI (LLM) · Interval: {interval} · Only same-condition runs are combined",
  nc_repeats_only: "repeat count is only {repeats}",
  not_comparable_labels: {
    collection_rate_shift: "collection rate shifted",
    denominator_zero: "denominator 0",
    engine_set_differs: "engine set differs",
    language_differs: "language differs",
    mixed_cohort: "conditions mixed",
    no_baseline: "no baseline",
    no_control_pair: "no control pair",
    pairs_insufficient: "too few pairs",
    question_set_differs: "question set differs",
    repeats_insufficient: "too few repeats",
    sampling_version_differs: "measurement method differs",
    verdict_version_differs: "verdict version differs",
  },
  retrieval_labels: {
    mixed: "differs by engine",
    not_used: "not used",
    unknown: "unknown",
    used: "used",
  },
  sample_brand: "Brand: {brand}",
  sample_engines: "AI engines or cells: {n}",
  sample_jobs: "{n} runs",
  sample_language: "Measured language: {language}",
  sample_measured: "Measured on (Korea time): {range}",
  sample_question_set: "Question set fingerprint: {key}",
  sample_questions_unknown:
    "Question count: no field in the contract (unavailable)",
  sample_repeats: "Repeats: {k}",
  sample_verdict: "Verdict version: {v}",
  sample_label: "Sample - not real customer data",
  second_line:
    "We separate what was measured from what could not be confirmed yet.",
  state_labels: {
    not_collected: "not collected",
    not_configured: "not configured",
    observed_zero: "observed 0",
    unavailable: "unavailable",
  },
  suppressed_line:
    "The sample is below the display threshold, so the rate is hidden (counts are on the line above).",
  title: "Evidence sheet",
  un_empty: "No unmeasured items were recorded.",
  un_headers: ["Reason", "Cells", "Rate", "Next action"],
};

export const EVIDENCE_COPY: Record<ProofLanguage, EvidenceCopyDict> = {
  en: EN,
  ko: KO,
};

/** 사전의 모든 문자열(시험이 금칙어를 훑을 때 쓴다). */
export function allCopyStrings(lang: ProofLanguage): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      out.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) {
        walk(item);
      }
    }
  };
  walk(EVIDENCE_COPY[lang]);
  return out;
}

function fill(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}

// ───────────────────────── 한계 3줄 ─────────────────────────

export interface LimitsOptions {
  /** 사람 검수 파일럿 건수. 없으면(null/undefined) 「검수 결과 없음」 문장이 나온다. */
  pilot_review_count?: number | null;
}

/** 한계 3줄 — 항상 3줄이다. (1) 표본 편중 (2) 반복은 독립 아님 (3) AI 판정·단일 검수자 파일럿 */
export function buildLimits(
  lang: ProofLanguage,
  opts: LimitsOptions = {}
): readonly [string, string, string] {
  const dict = EVIDENCE_COPY[lang];
  const n = opts.pilot_review_count;
  const third =
    typeof n === "number" && Number.isFinite(n) && n > 0
      ? fill(dict.limits_3_pilot, { n })
      : dict.limits_3_none;
  return [dict.limits_1, dict.limits_2, third];
}

/** K0 `LimitsBlock`(근거 봉투용) — 한국어·영어 각각 3줄을 줄바꿈으로 합친다. */
export function buildLimitsBlock(opts: LimitsOptions = {}): LimitsBlock {
  return {
    limits_en: buildLimits("en", opts).join("\n"),
    limits_ko: buildLimits("ko", opts).join("\n"),
  };
}

// ───────────────────────── 표시 도우미 ─────────────────────────

/** 0~1 소수 → 정수 퍼센트(표시 단계의 유일한 반올림). */
export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** ISO → 한국 시간 날짜(YYYY-MM-DD). 읽을 수 없으면 원문. */
export function kstDateOf(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return iso;
  }
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type ValueState =
  | "not_collected"
  | "not_configured"
  | "observed"
  | "observed_zero"
  | "unavailable";

/** 값 상태 4종(+일반 관측). 관측 0 은 「쟀더니 0」일 때만이다. */
export function valueStateOf<T>(
  known: Known<T>,
  isZero: (value: T) => boolean = () => false
): ValueState {
  if (known.status === "known") {
    return isZero(known.value) ? "observed_zero" : "observed";
  }
  const reason: UnavailableReason = known.reason;
  if (reason === "not_collected") {
    return "not_collected";
  }
  if (reason === "not_configured") {
    return "not_configured";
  }
  return "unavailable";
}

function asOfText(dict: EvidenceCopyDict, asOf: string | null): string {
  return asOf === null
    ? dict.as_of_unknown
    : fill(dict.as_of, { date: asOf.slice(0, 10) });
}

/** 값 하나를 「값(또는 상태 라벨 + 사유) · 기준일」 한 조각으로. */
export function describeKnown<T>(
  known: Known<T>,
  lang: ProofLanguage,
  format: (value: T) => string,
  isZero?: (value: T) => boolean
): string {
  const dict = EVIDENCE_COPY[lang];
  const state = valueStateOf(known, isZero);
  const date = asOfText(dict, known.as_of);
  if (known.status === "known") {
    const body = format(known.value);
    return state === "observed_zero"
      ? `${dict.state_labels.observed_zero}: ${body} (${date})`
      : `${body} (${date})`;
  }
  const label =
    state === "not_collected" || state === "not_configured"
      ? dict.state_labels[state]
      : dict.state_labels.unavailable;
  const why = lang === "ko" ? known.detail_ko : known.reason;
  return `${label}: ${why} (${date})`;
}

// ───────────────────────── 증거 한 장 묶음 ─────────────────────────

export interface ViewTable {
  headers: readonly string[];
  rows: string[][];
}

export interface ViewSection {
  heading: string;
  id: SectionId;
  lines: string[];
  table?: ViewTable;
}

export interface EvidenceSheetView {
  draft_label: string;
  first_line: string;
  footer_line: string;
  language: ProofLanguage;
  limits: readonly [string, string, string];
  /** 정적 샘플이면 「샘플」 표기, 아니면 null */
  sample_label: string | null;
  second_line: string;
  sections: ViewSection[];
  title: string;
}

export interface ViewOptions extends LimitsOptions {
  /** true 면 「샘플」 표기를 붙인다(L0-EX) */
  sample?: boolean;
}

function percentOrNull(rate: number | null): string {
  return rate === null ? "" : formatPercent(rate);
}

function bucketParts(
  lang: ProofLanguage,
  buckets: Record<AnswerBucket, number>
): string {
  const copy = lang === "ko" ? ANSWER_BUCKET_COPY_KO : ANSWER_BUCKET_COPY_EN;
  const order: AnswerBucket[] = [
    "confirmed",
    "different_entity",
    "unknown",
    "engine_error",
    "unverified",
  ];
  return order.map((key) => `${copy[key].label} ${buckets[key]}`).join(" · ");
}

function notComparableTexts(input: EvidenceSheetInput, lang: ProofLanguage) {
  const dict = EVIDENCE_COPY[lang];
  const { observed } = input.envelope;
  const out: string[] = [];
  if (observed.status === "unavailable") {
    out.push(
      dict.not_comparable_labels[
        observed.reason === "insufficient_sample"
          ? "denominator_zero"
          : "repeats_insufficient"
      ]
    );
    return out;
  }
  if (observed.value.denominator === 0) {
    out.push(dict.not_comparable_labels.denominator_zero);
  }
  if (input.envelope.language.language === "mixed") {
    out.push(dict.not_comparable_labels.mixed_cohort);
  }
  if (out.length === 0) {
    out.push(
      fill(dict.nc_repeats_only, {
        repeats: observed.value.collection.repeat_count,
      })
    );
  }
  return out;
}

function findingSection(input: EvidenceSheetInput, lang: ProofLanguage) {
  const dict = EVIDENCE_COPY[lang];
  const { observed } = input.envelope;
  let line: string;
  if (input.finding_kind === "not_comparable" || observed.status !== "known") {
    line = fill(dict.finding_not_comparable, {
      reasons: notComparableTexts(input, lang).join(" · "),
    });
  } else {
    const o = observed.value;
    line =
      o.exposure_rate === null
        ? fill(dict.exposure_rate_null, { label: dict.group_label[o.group] })
        : fill(dict.finding_observed, {
            count: o.exposure_count,
            denominator: o.denominator,
            label: dict.group_label[o.group],
            rate: formatPercent(o.exposure_rate),
            repeats: o.collection.repeat_count,
          });
  }
  return line;
}

function languageText(
  lang: ProofLanguage,
  key: EvidenceSheetInput["envelope"]["language"]
): string {
  const names =
    lang === "ko"
      ? { en: "영어", ko: "한국어", mixed: "섞임(한국어+영어)" }
      : { en: "English", ko: "Korean", mixed: "mixed (Korean + English)" };
  return names[key.language];
}

function sampleSection(input: EvidenceSheetInput, lang: ProofLanguage) {
  const dict = EVIDENCE_COPY[lang];
  const env = input.envelope;
  const lines: string[] = [];
  lines.push(
    fill(dict.sample_brand, {
      brand: input.brand_ref.display_name ?? input.brand_ref.brand_id,
    })
  );
  lines.push(dict.sample_questions_unknown);
  if (env.observed.status === "known") {
    const c = env.observed.value.collection;
    lines.push(fill(dict.sample_engines, { n: c.attempted }));
    lines.push(fill(dict.sample_repeats, { k: c.repeat_count }));
  } else {
    lines.push(
      fill(dict.sample_engines, {
        n: describeKnown(env.observed, lang, () => ""),
      })
    );
  }
  lines.push(
    fill(dict.sample_measured, {
      range: describeKnown(env.measured_at, lang, (r) =>
        r.first === r.last
          ? kstDateOf(r.first)
          : `${kstDateOf(r.first)}~${kstDateOf(r.last)}`
      ),
    })
  );
  lines.push(
    fill(dict.sample_language, { language: languageText(lang, env.language) })
  );
  lines.push(
    fill(dict.sample_verdict, {
      v: describeKnown(env.method_version, lang, (m) =>
        m.cohort.verdict_version === null
          ? dict.state_labels.unavailable
          : String(m.cohort.verdict_version)
      ),
    })
  );
  if (
    env.source_ids.status === "known" &&
    env.source_ids.value.kind === "audit_jobs"
  ) {
    const src = env.source_ids.value;
    lines.push(fill(dict.sample_jobs, { n: src.sample_count }));
    if (src.question_set_key) {
      lines.push(fill(dict.sample_question_set, { key: src.question_set_key }));
    }
  }
  return lines;
}

function methodSection(input: EvidenceSheetInput, lang: ProofLanguage) {
  const dict = EVIDENCE_COPY[lang];
  const { observed } = input.envelope;
  let interval = dict.interval_unavailable;
  if (
    observed.status === "known" &&
    observed.value.interval.status === "known"
  ) {
    interval =
      observed.value.interval.value.method === "wilson"
        ? dict.method_interval_wilson
        : dict.method_interval_bootstrap;
  }
  return [fill(dict.method_line, { interval })];
}

function numbersSection(input: EvidenceSheetInput, lang: ProofLanguage) {
  const dict = EVIDENCE_COPY[lang];
  const { observed } = input.envelope;
  if (observed.status !== "known") {
    return [describeKnown(observed, lang, () => "")];
  }
  const o: ObservedValues = observed.value;
  const c = o.collection;
  const lines: string[] = [];
  const rateText = c.rate === null ? "" : `(${formatPercent(c.rate)})`;
  lines.push(
    fill(dict.collection_line, {
      attempted: c.attempted,
      measured: c.measured,
      rate: rateText,
      repeats: c.repeat_count,
      unit:
        c.unit === "engine"
          ? dict.collection_unit_engine
          : dict.collection_unit_cell,
    })
  );
  const label = dict.group_label[o.group];
  if (c.suppressed) {
    lines.push(dict.suppressed_line);
  } else if (o.exposure_rate === null) {
    lines.push(fill(dict.exposure_rate_null, { label }));
  } else {
    const zeroNote =
      o.exposure_count === 0 ? ` [${dict.state_labels.observed_zero}]` : "";
    lines.push(
      fill(dict.exposure_line, {
        count: o.exposure_count,
        denominator: o.denominator,
        label,
        rate: percentOrNull(o.exposure_rate),
      }) + zeroNote
    );
  }
  lines.push(
    o.interval.status === "known"
      ? `${fill(dict.interval_line, {
          high: formatPercent(o.interval.value.high),
          low: formatPercent(o.interval.value.low),
        })} (${asOfText(dict, o.interval.as_of)})`
      : describeKnown(o.interval, lang, () => "")
  );
  lines.push(fill(dict.bucket_line, { parts: bucketParts(lang, o.buckets) }));
  lines.push(`(${asOfText(dict, observed.as_of)})`);
  return lines;
}

function beforeAfterSection(
  input: EvidenceSheetInput,
  lang: ProofLanguage
): { lines: string[]; table?: ViewTable } {
  const dict = EVIDENCE_COPY[lang];
  const ba = input.before_after;
  if (ba === null) {
    return { lines: [dict.ba_not_applicable] };
  }
  if (ba.status === "unavailable") {
    return { lines: [describeKnown(ba, lang, () => "")] };
  }
  const s = ba.value;
  const lines = [
    fill(dict.ba_pairs, {
      cPairs: s.control.comparable_pairs,
      min: s.min_pairs_required,
      pairs: s.pair_count,
      tPairs: s.treated.comparable_pairs,
    }),
  ];
  if (s.prereg_id) {
    lines.push(fill(dict.ba_summary_prereg, { id: s.prereg_id }));
  }
  if (s.not_comparable !== null) {
    lines.push(
      fill(dict.finding_not_comparable, {
        reasons: dict.not_comparable_labels[s.not_comparable],
      })
    );
  } else if (s.difference !== null) {
    lines.push(
      fill(dict.ba_summary_difference, {
        diff: formatPercent(s.difference),
      })
    );
  }
  lines.push(`(${asOfText(dict, ba.as_of)})`);
  const cell = (n: number | null) =>
    n === null ? dict.ba_none : formatPercent(n);
  const rows = s.rows.map((r) => [
    r.pair_id,
    r.arm === "treated" ? dict.ba_row_arm_treated : dict.ba_row_arm_control,
    cell(r.before),
    cell(r.after),
    cell(r.delta),
    `${r.repeats_before}/${r.repeats_after}`,
    r.not_comparable === null
      ? dict.ba_none
      : dict.not_comparable_labels[r.not_comparable],
  ]);
  return { lines, table: { headers: dict.ba_headers, rows } };
}

const MAX_URLS = 5;

function confoundersSection(input: EvidenceSheetInput, lang: ProofLanguage) {
  const dict = EVIDENCE_COPY[lang];
  const env = input.envelope;
  const lines: string[] = [];
  lines.push(
    `${dict.conf_retrieval}: ${describeKnown(env.retrieval, lang, (r) => dict.retrieval_labels[r.retrieval_used] ?? r.retrieval_used)}`
  );
  lines.push(
    `${dict.conf_engine_model}: ${describeKnown(
      env.engine_model,
      lang,
      (list) =>
        list.length === 0
          ? dict.conf_urls_none
          : list
              .map(
                (e) =>
                  `${e.engine_id}${e.model_id.status === "known" ? ` ${e.model_id.value}` : ""}`
              )
              .join(", ")
    )}`
  );
  lines.push(
    `${dict.conf_index_checked}: ${describeKnown(
      env.index_check,
      lang,
      (ic) => {
        if (ic.method === "none" || ic.indexed === null) {
          return dict.conf_index_none;
        }
        return ic.indexed
          ? dict.conf_index_indexed
          : dict.conf_index_not_indexed;
      }
    )}`
  );
  const urls =
    env.retrieval.status === "known" ? env.retrieval.value.source_urls : null;
  if (urls === null) {
    lines.push(`${dict.conf_source_urls}: ${dict.state_labels.unavailable}`);
  } else if (urls.length === 0) {
    lines.push(`${dict.conf_source_urls}: ${dict.conf_urls_none}`);
  } else {
    const shown = urls.slice(0, MAX_URLS).join(", ");
    const more =
      urls.length > MAX_URLS
        ? ` ${fill(dict.conf_urls_more, { n: urls.length - MAX_URLS })}`
        : "";
    lines.push(`${dict.conf_source_urls}: ${shown}${more}`);
  }
  lines.push(dict.conf_region);
  return lines;
}

function unmeasuredSection(
  input: EvidenceSheetInput,
  lang: ProofLanguage
): { lines: string[]; table?: ViewTable } {
  const dict = EVIDENCE_COPY[lang];
  const rows = input.envelope.unmeasured;
  if (rows.length === 0) {
    return { lines: [dict.un_empty] };
  }
  return {
    lines: [],
    table: {
      headers: dict.un_headers,
      rows: rows.map((r) => [
        r.label_ko,
        String(r.count),
        r.rate === null ? dict.ba_none : formatPercent(r.rate),
        r.action_ko,
      ]),
    },
  };
}

function footerLine(input: EvidenceSheetInput, lang: ProofLanguage): string {
  const dict = EVIDENCE_COPY[lang];
  const env = input.envelope;
  let ids = describeKnown(env.source_ids, lang, () => "");
  if (env.source_ids.status === "known") {
    const src = env.source_ids.value;
    ids =
      src.kind === "audit_jobs"
        ? src.audit_job_ids.join(", ") || dict.ba_none
        : src.checked_url;
  }
  const cohort =
    env.method_version.status === "known"
      ? [
          env.method_version.value.cohort.sampling_version,
          `qs:${env.method_version.value.cohort.question_set_key ?? "-"}`,
        ].join(" ")
      : describeKnown(env.method_version, lang, () => "");
  return fill(dict.footer_line, {
    as_of: input.footer.as_of.slice(0, 10),
    cohort,
    ids,
  });
}

/** 증거 한 장 → 줄·표 묶음. 한계 3줄·푸터의 「효과 입증 아님」은 항상 들어간다. */
export function buildEvidenceSheetView(
  input: EvidenceSheetInput,
  opts: ViewOptions = {}
): EvidenceSheetView {
  const lang = input.ui_language;
  const dict = EVIDENCE_COPY[lang];
  const ba = beforeAfterSection(input, lang);
  const un = unmeasuredSection(input, lang);
  const limits = buildLimits(lang, opts);
  const sections: ViewSection[] = [
    {
      heading: dict.heading.finding,
      id: "finding",
      lines: [findingSection(input, lang)],
    },
    {
      heading: dict.heading.sample,
      id: "sample",
      lines: sampleSection(input, lang),
    },
    {
      heading: dict.heading.method,
      id: "method",
      lines: methodSection(input, lang),
    },
    {
      heading: dict.heading.numbers,
      id: "numbers",
      lines: numbersSection(input, lang),
    },
    {
      heading: dict.heading.before_after,
      id: "before_after",
      lines: ba.lines,
      table: ba.table,
    },
    {
      heading: dict.heading.confounders,
      id: "confounders",
      lines: confoundersSection(input, lang),
    },
    { heading: dict.heading.limits, id: "limits", lines: [...limits] },
    {
      heading: dict.heading.unmeasured,
      id: "unmeasured",
      lines: un.lines,
      table: un.table,
    },
  ];
  return {
    draft_label: dict.draft_label,
    first_line: dict.first_line,
    footer_line: footerLine(input, lang),
    language: lang,
    limits,
    sample_label: opts.sample ? dict.sample_label : null,
    second_line: dict.second_line,
    sections,
    title: dict.title,
  };
}

/** 묶음 전체를 한 문자열로(금칙어 훑기용). 못 잰 표의 「다음 행동」 같은 외부 상수 문구도 포함한다. */
export function flattenView(view: EvidenceSheetView): string {
  const parts: string[] = [
    view.title,
    view.draft_label,
    view.sample_label ?? "",
    view.first_line,
    view.second_line,
  ];
  for (const s of view.sections) {
    parts.push(s.heading, ...s.lines);
    if (s.table) {
      parts.push(...s.table.headers, ...s.table.rows.flat());
    }
  }
  parts.push(view.footer_line);
  return parts.join("\n");
}

/** 비교 불가 사유 열거(문서·시험용). */
export const ALL_NOT_COMPARABLE_REASONS = NOT_COMPARABLE_REASONS;
