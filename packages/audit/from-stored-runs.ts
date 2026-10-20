// 저장된 AuditJob.result → 증거 한 장 입력 (fromStoredRuns, 2026-10-20 통합 전담)
//
// 하는 일: DB 에서 읽어 온 저장 회차(엔진 응답 배열 포함)를 S1 집계(aggregateRepeats)·짝짓기(pairComparison)·
//   측정하지 못한 이유 집계(buildUnmeasuredBreakdown)에 통과시키고, S2 조립기(assembleEvidenceSheet)로 `EvidenceSheetInput` 을 만든다.
// 하지 않는 일: DB·네트워크·환경변수·시계 읽기, 새 계산(분모·구간은 S1 그대로), 문구 만들기(EV-c 몫),
//   처방군·대조군 하드코딩(assignment 는 호출자가 사전 등록 문서에서 넘긴다).
// 전파 규칙: 반복 부족·질문 언어 기록 없음·게시 불가는 숫자를 만들지 않고 「비교 불가/확인 불가」로 둔다(0 아님).
// 한계: 검색 호출 여부·엔진 모델·색인 확인은 이 함수가 채우지 않는다(조각 없음 → 확인 불가). 앱 쪽 MCP 가 저장 필드에서 채운다.
//
// ⚠️ 반복은 독립 표본이 아니고, 이 함수의 결과는 계산·표기 규칙의 산출물이다(효과 입증이 아님).

import { assembleEvidenceSheet } from "./evidence-sheet";
import { pairComparison } from "./paired-comparison";
import type {
  EvidenceSheetInput,
  Known,
  LanguageKey,
  LimitsBlock,
  ObservedValues,
  PairArm,
  PairedComparisonSummary,
  ProofLanguage,
  UnavailableReason,
} from "./proof-types";
import {
  aggregateRepeats,
  type CohortAggregate,
  type ExcludedRun,
  type RepeatAggregateResult,
  type StoredRun,
} from "./repeat-aggregate";
import { buildUnmeasuredBreakdown } from "./unmeasured-breakdown";

export interface FromStoredRunsOptions {
  /** 기준일 ISO — 푸터에 찍힌다. 함수가 시계를 읽지 않는다. */
  as_of: string;
  /** 질문 지문(normalizeQuestionText) → 처방군/대조군. 사전 등록 문서에서 온 값을 넘긴다(여기서 정하지 않음). */
  assignment: Readonly<Record<string, PairArm>>;
  brand_domain?: string | null;
  brand_ref: { brand_id: string; display_name: string | null };
  collection_shift_limit: number;
  /** 게시 가능 판정(기본: 기존 isPublishableAuditResult). 시험에서 주입한다. */
  is_publishable?: (result: unknown) => boolean;
  limits: LimitsBlock;
  min_pairs_required: number;
  /** 사전 등록 확정값(최소 반복 수). */
  min_repeats: number;
  prereg_id: string | null;
  ui_language: ProofLanguage;
}

export interface StoredRunsByPeriod {
  /** 처방 후 회차(관찰값은 여기서 나온다). */
  after: readonly StoredRun[];
  /** 처방 전 회차. 비어 있으면 「기준선 없음」으로 비교 불가. */
  before: readonly StoredRun[];
}

export interface OtherCohortReport {
  cohort_id: string;
  job_ids: string[];
  reason: "not_latest_cohort";
}

export interface FromStoredRunsDetailed {
  /** 처방 후 회차 중 집계에 넣지 못한 회차(언어 기록 없음 등)와 사유. */
  excluded_runs: ExcludedRun[];
  /** 처방 후 회차에서 선택하지 않은 코호트(조건이 달라 합치지 않음). */
  other_cohorts: OtherCohortReport[];
  selected_cohort_id: string | null;
  sheet: EvidenceSheetInput;
}

const UNKNOWN_LANGUAGE: LanguageKey = { language: "unknown", script: null };

function gone<T>(
  reason: UnavailableReason,
  detail_ko: string,
  asOf: string | null
): Known<T> {
  return { as_of: asOf, detail_ko, reason, status: "unavailable" };
}

/**
 * 최신 코호트 선택 규칙(결정적): ① 마지막 완료 시각이 가장 늦은 것 → ② 같으면 반복 수가 많은 것 → ③ 같으면 cohort_id 사전순.
 * 선택되지 않은 코호트는 합치지 않고 `other_cohorts` 로 보고한다(조용히 버리지 않는다).
 */
function rankedCohorts(agg: RepeatAggregateResult): CohortAggregate[] {
  return [...agg.cohorts].sort(
    (a, b) =>
      Date.parse(b.last_completed_at) - Date.parse(a.last_completed_at) ||
      b.repeat_count - a.repeat_count ||
      a.cohort_id.localeCompare(b.cohort_id)
  );
}

function reasonOfExcluded(excluded: readonly ExcludedRun[]): {
  detail: string;
  reason: UnavailableReason;
} {
  const first = excluded[0];
  if (!first) {
    return { detail: "처방 후 회차가 없습니다.", reason: "source_missing" };
  }
  return {
    detail: `처방 후 회차를 집계에 넣지 못했습니다(${first.detail_ko}).`,
    reason: first.reason === "mixed_cohort" ? "not_recorded" : first.reason,
  };
}

function observedOf(
  cohort: CohortAggregate | null,
  excluded: readonly ExcludedRun[],
  asOf: string
): Known<ObservedValues> {
  if (cohort === null) {
    const { detail, reason } = reasonOfExcluded(excluded);
    return gone(reason, detail, asOf);
  }
  return cohort.observed.ai_brand;
}

function questionCountOf(cohort: CohortAggregate | null): Known<number> {
  if (cohort === null) {
    return gone("source_missing", "질문 수를 셀 회차가 없습니다.", null);
  }
  const ids = new Set(
    cohort.cells.filter((c) => c.group === "ai_brand").map((c) => c.question_id)
  );
  return { as_of: cohort.last_completed_at, status: "known", value: ids.size };
}

function pairOf(
  before: CohortAggregate | null,
  after: CohortAggregate | null,
  options: FromStoredRunsOptions
): PairedComparisonSummary {
  return pairComparison({
    after,
    assignment: options.assignment,
    before,
    collection_shift_limit: options.collection_shift_limit,
    min_pairs_required: options.min_pairs_required,
    min_repeats: options.min_repeats,
    prereg_id: options.prereg_id,
  });
}

/**
 * 저장 회차(전·후) → 증거 한 장 입력. 순수 함수.
 * - 후 회차의 가장 최근 코호트가 관찰값이 된다. 코호트가 없으면(언어 기록 없음 등) 관찰값은 확인 불가.
 * - 전후 짝짓기는 같은 조건끼리만 하고, 아니면 사유와 함께 비교 불가.
 */
export function fromStoredRuns(
  runs: StoredRunsByPeriod,
  options: FromStoredRunsOptions
): EvidenceSheetInput {
  return fromStoredRunsDetailed(runs, options).sheet;
}

/** fromStoredRuns + 선택한 코호트·선택하지 않은 코호트·제외 회차 보고. */
export function fromStoredRunsDetailed(
  runs: StoredRunsByPeriod,
  options: FromStoredRunsOptions
): FromStoredRunsDetailed {
  const aggOptions = {
    brand_domain: options.brand_domain ?? null,
    is_publishable: options.is_publishable,
    min_repeats: options.min_repeats,
    suppression_threshold: null,
  };
  const beforeAgg = aggregateRepeats(runs.before, aggOptions);
  const afterAgg = aggregateRepeats(runs.after, aggOptions);
  const before = rankedCohorts(beforeAgg)[0] ?? null;
  const afterRanked = rankedCohorts(afterAgg);
  const afterAny = afterRanked[0] ?? null;
  // 숫자를 못 낸 코호트(게시 불가 등)에서는 시각·질문 수·출처 같은 봉투 칸도 같이 「확인 불가」로 낮춘다.
  const after =
    afterAny && afterAny.observed.ai_brand.status === "known" ? afterAny : null;
  const withheld =
    afterAny && afterAny.observed.ai_brand.status === "unavailable"
      ? afterAny.observed.ai_brand
      : null;
  const lowered = <T>(): Known<T> | undefined =>
    withheld
      ? gone<T>(
          withheld.reason,
          "숫자를 내지 못한 묶음이라 이 칸도 확인 불가로 둡니다.",
          null
        )
      : undefined;

  const pair = pairOf(before, afterAny, options);
  const unmeasured = buildUnmeasuredBreakdown(
    runs.after.map((r) => ({ job_id: r.job_id, result: r.result }))
  ).rows;

  const built = assembleEvidenceSheet({
    as_of: options.as_of,
    before_after: { as_of: options.as_of, status: "known", value: pair },
    brand_ref: options.brand_ref,
    language: (after ?? afterAny)?.cohort.language ?? UNKNOWN_LANGUAGE,
    limits: options.limits,
    measured_at: after
      ? {
          as_of: after.last_completed_at,
          status: "known",
          value: {
            first: after.first_completed_at,
            last: after.last_completed_at,
          },
        }
      : lowered(),
    method_version: after
      ? {
          as_of: after.last_completed_at,
          status: "known",
          value: {
            cohort: after.cohort,
            interval_method:
              after.observed.ai_brand.status === "known" &&
              after.observed.ai_brand.value.interval.status === "known"
                ? after.observed.ai_brand.value.interval.value.method
                : null,
          },
        }
      : lowered(),
    min_repeats: options.min_repeats,
    observed: observedOf(afterAny, afterAgg.excluded_runs, options.as_of),
    source_ids: after
      ? {
          as_of: after.last_completed_at,
          status: "known",
          value: {
            audit_job_ids: after.used_job_ids,
            kind: "audit_jobs",
            question_set_key: after.cohort.question_set_key,
            sample_count: after.repeat_count,
          },
        }
      : lowered(),
    ui_language: options.ui_language,
    unmeasured,
  });
  const sheet: EvidenceSheetInput = {
    ...built,
    question_count: withheld
      ? gone(
          withheld.reason,
          "숫자를 내지 못한 묶음이라 질문 수도 확인 불가로 둡니다.",
          null
        )
      : questionCountOf(after),
    region: gone(
      "not_recorded",
      "측정 지역은 저장 결과에 기록되어 있지 않습니다.",
      null
    ),
  };
  return {
    excluded_runs: afterAgg.excluded_runs,
    other_cohorts: afterRanked.slice(1).map((c) => ({
      cohort_id: c.cohort_id,
      job_ids: c.job_ids,
      reason: "not_latest_cohort" as const,
    })),
    selected_cohort_id: afterAny?.cohort_id ?? null,
    sheet,
  };
}
