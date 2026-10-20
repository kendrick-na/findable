// packages/audit/proof-types.ts — K0 계약 파일 (2026-10-20 초안)
//
// 규칙(이 파일 맨 위 주석으로 남긴다):
//  1. 타입·인터페이스·열거 값 목록(as const 튜플)만. 함수·class·계산·문구·환경변수·zod·DB 금지.
//  2. import 는 `import type` 만.
//  3. 값이 없으면 0 이 아니라 Known<T> 의 unavailable(+사유). 「측정하지 못함」과 「0건」은 다른 상태다.
//  4. 비율은 0~1 소수(반올림 없음). answer-buckets 의 bucketRate(0~100 정수)와 섞지 않는다.
//  5. 20:00 고정 뒤 변경은 통합 전담만, 필드 추가(선택 필드)만 허용. 필드 삭제·이름 변경·의미 변경 금지.

import type { AnswerBucket } from "./answer-buckets";
import type { MeasurementCoverage } from "./measurement-coverage";
import type { GapCode } from "./measurement-gap";

// [1. 값이 없을 때: 「확인 불가」]

export const UNAVAILABLE_REASONS = [
  "not_recorded", // 저장 결과에 그 칸이 아예 없음(옛 회차·기록 도입 전)
  "not_collected", // 미수집: 수집을 시도했지만 값이 안 왔음(예: webSearchRequests === null)
  "not_configured", // 미설정: 애초에 측정·확인을 설정하지 않음(예: 색인 확인 방법 없음, 질문 세트 미지정)
  "not_applicable", // 이 엔진·경로에는 해당 개념이 없음
  "source_missing", // 원자료(회차)를 찾지 못함
  "engine_error", // 엔진 오류로 측정하지 못함
  "withheld_not_publishable", // 게시 불가 판정(isPublishableAuditResult 가 아님)이라 숫자를 내지 않음
  "insufficient_sample", // 표본·반복·분모가 모자라 계산하지 않음(분모 0 포함)
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/**
 * 값 상태 4종: 관측 0(known, value 가 0) / 미수집(not_collected) / 미설정(not_configured) / 확인 불가(그 밖의 사유).
 * 값마다 기준일(as_of, ISO)을 둔다 — 「값이 아니라 날짜」(오래된 값은 표시 단계에서 숨기거나 낡음 표기).
 * as_of 가 null 이면 기준일을 모른다는 뜻이며 최신이라는 뜻이 아니다. as_of 포함은 CiteLadder·fire-your-seo-agency식을
 * 검토해 넣은 제안이다(X 리서치 5-4 #2, 우리 환경 적합성은 [확인 필요]).
 */
export type Known<T> =
  | {
      as_of: string | null;
      detail_ko: string;
      reason: UnavailableReason;
      status: "unavailable";
    }
  | { as_of: string | null; status: "known"; value: T };

// [2. 언어 키]

/** 현재 검증된 언어는 한국어뿐이다. 값 추가는 계약 변경(통합 전담 + 대표 확인). */
export const PROOF_LANGUAGES = ["ko", "en"] as const;
export type ProofLanguage = (typeof PROOF_LANGUAGES)[number];
export type ProofScript = "Hang" | "Latn";

export interface LanguageKey {
  /**
   * "mixed" = 한 회차가 ko·en 을 섞어 물음(questionLanguagesOf 가 "ko-en"). 어떤 코호트와도 합치지 않는다.
   * "unknown" = 언어를 모르거나 언어와 무관한 응답(저장 기록에 언어 칸이 없음 등). 「섞임」이 아니다.
   * 어떤 코호트와도 합치지 않는다(2026-10-20 대표 관제탑 승인, 하위 호환 추가).
   */
  language: ProofLanguage | "mixed" | "unknown";
  script: ProofScript | null;
}

// [3. 코호트·실험 단위]

/** 같은 조건끼리만 합치기 위한 꼬리표. 하나라도 다르면 합치지 않고 「비교 불가」. */
export interface CohortKey {
  engine_set_key: string | null; // measurementContext.engineSetKey
  language: LanguageKey;
  question_set_key: string | null; // questionSetKeyOf(...) 8자리, 없으면 null
  /** searchSamplingVersionOf(result) 전체 문자열 — 엔진 세트·qs:·l:·m:·plan: 포함. 비교는 isSearchSamplingComparable 재사용. */
  sampling_version: string;
  verdict_version: number | null; // result.mentionVerdictVersion
}

/** 실험 단위 = 질문 × 엔진 × 언어 × 날짜. 같은 질문의 반복은 독립 표본이 아니다(변동성으로 다룬다). */
export interface ExperimentUnit {
  date_kst: string; // "YYYY-MM-DD" (한국 시간)
  engine_id: string; // EngineId 그대로
  language: LanguageKey;
  question_id: string; // promptId 우선, 없으면 정규화한 질문 지문 — A1-a 첫 2시간에 확정
}

// [4. 수치: 구간·수집률·관측값]

export type IntervalMethod = "wilson" | "question_bootstrap"; // 부트스트랩은 2차(A0b)
export interface Interval {
  confidence: 0.95;
  high: number; // 0~1
  low: number; // 0~1
  method: IntervalMethod;
}

/** 「N건 중 M건 수집, 반복 K회」의 재료. attempted/measured 이름은 기존 MeasurementCoverage 와 같다. */
export interface CollectionRate extends MeasurementCoverage {
  rate: number | null; // measured/attempted, attempted===0 이면 null(0 이 아님)
  repeat_count: number;
  /** 표시만 억제하는 기준(대표 승인 #7). 점수·판정에 쓰지 않는다. */
  suppressed: boolean;
  suppression_threshold: number | null;
  /** engine = 엔진 수 기준(현재 코드), question_engine_cell = 질문×엔진 칸 기준 */
  unit: "engine" | "question_engine_cell";
}

/** 어느 묶음의 비율인가 — summarizeAnswerBuckets 의 그룹과 같다(새 분모 규칙 금지). */
export type ProofMetricGroup = "ai_brand" | "discovery" | "search";

export interface ObservedValues {
  buckets: Record<AnswerBucket, number>;
  collection: CollectionRate;
  /** 비율의 분모 = 해당 그룹의 adjudicated(판정이 끝난 답변 수). 0 이면 exposure_rate 는 null. */
  denominator: number;
  /** ai_brand·search: confirmed(제대로 앎) 건수 / discovery: recommended 건수 */
  exposure_count: number;
  exposure_rate: number | null;
  group: ProofMetricGroup;
  interval: Known<Interval>;
}

// [5. 측정하지 못한 이유]

/** GapCode(사이트·질문 수준 18개)에 엔진 응답 수준 사유 3개를 더한다. */
export type UnmeasuredReasonCode =
  | GapCode
  | "engine_error" // 응답 행의 errorMessage
  | "search_unavailable" // usage.searchUnavailable (검색을 원했지만 검색 없이 답함 → 「출처 0」은 미수집)
  | "stub_response"; // isStub (키 없어 만든 가짜 응답 — 「측정한 것」이 아님)

export interface UnmeasuredRow {
  action_ko: string; // 기존 GAP_ACTION_KO 재사용(없으면 A4 가 정의)
  code: UnmeasuredReasonCode;
  count: number;
  denominator: number;
  label_ko: string; // 기존 GAP_LABEL_KO 재사용
  rate: number | null; // 분모 0 이면 null
}

// [6. 교란(섞여 들어오는 요인) 기록]

/** 웹 검색을 붙인 엔진 vs 모델 지식 기반 엔진. 사전 등록에서 분리 표기. */
export type EngineClass =
  | "web_search"
  | "model_knowledge"
  | "mixed"
  | "unknown";
export type RetrievalState = "used" | "not_used" | "unknown";

export interface RetrievalInfo {
  by_engine: Record<
    string,
    { engine_class: EngineClass; retrieval: RetrievalState }
  >;
  retrieval_used: RetrievalState | "mixed";
  source_urls: string[]; // 도메인이 아니라 URL, 사업자번호·이메일 등 개인정보 제외
}

export interface EngineModelInfo {
  call_source: "web" | "api" | "api_fallback" | null;
  engine_id: string;
  engine_set: string | null;
  model_id: Known<string>; // 대부분 not_recorded 가 정상
}

export interface IndexCheck {
  checked_at: string | null; // ISO
  indexed: boolean | null;
  method: "search_console" | "site_query" | "manual" | "none";
  page_urls: string[];
}

// [7. 비교 불가 사유와 전후 짝짓기(B1-min 출력)]

export const NOT_COMPARABLE_REASONS = [
  "pairs_insufficient", // 짝 수가 사전 등록 최소선 미만
  "repeats_insufficient", // 반복이 모자람
  "verdict_version_differs", // 판정 버전 다름
  "sampling_version_differs", // 측정 방식 다름(기존 search_sampling_changed 매핑)
  "question_set_differs", // 질문 세트 지문 다름
  "language_differs", // 언어 다름(mixed 포함)
  "engine_set_differs", // 엔진 세트 다름
  "collection_rate_shift", // 수집률이 기준 이상 급변
  "mixed_cohort", // 한 회차 안에서 조건이 섞임
  "no_baseline", // 기준선 회차 없음
  "no_control_pair", // 대조군 짝 없음
  "denominator_zero", // 분모 0
] as const;
export type NotComparableReason = (typeof NOT_COMPARABLE_REASONS)[number];

export type PairArm = "treated" | "control"; // 처방군 / 대조군

export interface PairedComparisonRow {
  after: number | null; // 0~1
  arm: PairArm;
  before: number | null; // 0~1
  date_after: string; // YYYY-MM-DD KST
  date_before: string;
  delta: number | null; // not_comparable 이 있으면 반드시 null
  not_comparable: NotComparableReason | null;
  pair_id: string;
  repeats_after: number;
  repeats_before: number;
  unit_key: Omit<ExperimentUnit, "date_kst">;
}

export interface ArmSummary {
  comparable_pairs: number;
  mean_delta: number | null;
  pairs: number;
}

/** B1-min 출력. 「판정」이 아니라 표다. 인과·효과 필드를 두지 않는다. */
export interface PairedComparisonSummary {
  control: ArmSummary;
  /** treated.mean_delta − control.mean_delta. not_comparable 이 있으면 null. */
  difference: number | null;
  /** 사전 등록 문서(#19)에서 온 값 — 코드에 숫자를 박지 않는다. */
  min_pairs_required: number;
  not_comparable: NotComparableReason | null;
  pair_count: number;
  prereg_id: string | null; // 사전 등록 문서 식별자
  rows: PairedComparisonRow[];
  treated: ArmSummary;
}

// [8. 근거 봉투]

export type SourceIds =
  | {
      audit_job_ids: string[];
      kind: "audit_jobs";
      question_set_key: string | null;
      sample_count: number;
    }
  | { checked_url: string; kind: "live_fetch" }; // check_official_facts 처럼 저장 결과가 아닌 즉석 확인

export interface MethodVersion {
  cohort: CohortKey;
  interval_method: IntervalMethod | null;
}

export interface MeasuredAtRange {
  first: string; // ISO
  last: string; // ISO
}

/**
 * 답변 원문 보존 참조(선택). 원문 자체를 응답에 싣지 않고 보관 위치의 식별자만 둔다.
 * [확인 필요] 원문 저장은 개인정보·저장 기간 정책 확인 전에는 새로 저장하지 않는다. 지금은 기존 저장분
 * (`engineResponses[].rawResponse`)을 가리키는 것까지만. 사업자번호·이메일·법인명이 섞일 수 있어 MCP 응답에는 제외(화이트리스트).
 */
export interface RawAnswerRef {
  audit_job_id: string;
  retention_policy_checked: boolean; // false 인 동안 외부 응답·문서에 원문을 내보내지 않는다
  row_index: number;
}

export interface LimitsBlock {
  limits_en: string; // 영어 정적 문구 한 벌(S3 상수) — 영어 검증 없음을 뜻하지 않는다
  limits_ko: string;
}

/**
 * 근거 봉투 최소형. 「형태가 있다」는 것이지 「값이 맞다」는 보증이 아니다.
 * 없는 칸은 오류가 아니라 Known.unavailable 로 표시한다. unmeasured 는 빈 배열도 명시(측정하지 못한 것 0건).
 */
export interface EvidenceEnvelope {
  comparison: Known<PairedComparisonSummary> | null; // null = 이 응답에 전후 비교가 해당 없음
  engine_model: Known<EngineModelInfo[]>;
  index_check: Known<IndexCheck>;
  language: LanguageKey; // 필수
  limits: LimitsBlock;
  measured_at: Known<MeasuredAtRange>;
  method_version: Known<MethodVersion>;
  observed: Known<ObservedValues>;
  raw_answer_refs?: RawAnswerRef[]; // 선택. 정책 확인 전 생략
  retrieval: Known<RetrievalInfo>;
  schema_version: 1;
  source_ids: Known<SourceIds>;
  unmeasured: UnmeasuredRow[];
}

// [9. 증거 한 장 입력 (EV-a 의 입력, EV-c 가 문구로 바꿈)]

/** 한계 3줄 고정: (1) 표본 편중 (2) 반복은 독립 아님 (3) AI 판정·단일 검수자. 문장은 EV-c 가 정의. */
export type EvidenceLimits = readonly [string, string, string];

export type FindingKind = "observed" | "not_comparable"; // 「효과」 종류를 두지 않는다

export interface EvidenceSheetInput {
  before_after: Known<PairedComparisonSummary> | null;
  brand_ref: { brand_id: string; display_name: string | null };
  envelope: EvidenceEnvelope;
  finding_kind: FindingKind; // 반복값이 기준 미달이면 반드시 "not_comparable"
  footer: { as_of: string; not_effect_proof: true }; // true 리터럴 — 「효과 입증」으로 쓸 수 없게 타입으로 막음
  /** 선택(2026-10-20 추가). 표시용 질문 수. 못 세면 unavailable — 0 이 아니다. */
  question_count?: Known<number>;
  /** 선택(2026-10-20 추가). 측정 지역 표기(예: 호출 지역). 기록 칸이 없으면 unavailable. */
  region?: Known<string>;
  ui_language: ProofLanguage; // 문구 틀 언어(ko|en) — 측정 언어와 별개
}

// [10. 읽기 전용 MCP 응답]

export const MCP_READONLY_TOOL_NAMES = [
  "get_brand_measurement_summary",
  "get_answer_verdict_breakdown",
  "check_official_facts",
] as const;
export type McpReadonlyToolName = (typeof MCP_READONLY_TOOL_NAMES)[number];

/** 정상 응답: 근거 봉투 필수. */
export interface McpReadonlyOk<T> {
  data: T;
  evidence: EvidenceEnvelope;
  language: LanguageKey;
  limits_en: string;
  limits_ko: string;
  message_ko: string;
  status: "ok";
  tool: McpReadonlyToolName;
}

/** 봉투를 만들 재료가 없을 때: 응답을 거부하지 않고 「확인 불가」로 표시(관제탑 입장, O4 13-4 #2). data 는 null. */
export interface McpReadonlyUnverifiable {
  data: null;
  evidence: EvidenceEnvelope; // 모든 Known 이 unavailable 이어도 봉투는 반드시 붙는다
  language: LanguageKey;
  limits_en: string;
  limits_ko: string;
  message_ko: string;
  reason: UnavailableReason;
  status: "unverifiable";
  tool: McpReadonlyToolName;
}

export type McpReadonlyResponse<T> = McpReadonlyOk<T> | McpReadonlyUnverifiable;

/** 오류는 「확인 불가」가 아니다. 허용 목록 밖 브랜드는 존재하지 않는 브랜드와 **같은** not_available 을 낸다. */
export interface McpReadonlyError {
  error: {
    code: "disabled" | "internal" | "not_available" | "unauthorized";
    message_ko: string;
  };
}
