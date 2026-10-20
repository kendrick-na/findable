// packages/audit/paired-comparison.ts — B1-min 전후 짝짓기 최소판 (순수 함수, 2026-10-21)
//
// 하는 일: 처방 전·후 두 코호트(aggregateRepeats 결과의 코호트 1개씩)를 「같은 질문·엔진·언어」끼리 짝지어
//   전후 값·차이·반복 수·비교 불가 사유를 표(PairedComparisonSummary)로 낸다. **판정이 아니라 표다.**
// 하지 않는 일: 효과·원인 필드/문구, 고급 부트스트랩, 처방 카드, 새 화면. 기존 before-after.ts 는 읽기만 하고 합치지 않는다.
//
// 입력(PairedComparisonInput) — 숫자·배정은 전부 인자다(코드에 박지 않는다). 출처는 사전 등록 확정본
//   `19_사전등록_확정_20261020.md`(W_착수팩; 초안 16·후보 18 은 폐기)의 아래 칸이다:
//   · prereg_id            ← 문서 식별자(예: 「사전등록 확정 2026-10-20」)
//   · assignment           ← 19번 §3 「처방군·대조군」 표. 질문 ID(앞자리) → 질문 문구 → 정규화 지문(question_id)으로
//                              옮긴 {지문: "treated"|"control"}. 배정하지 않은 질문(「주요 분석에서 제외」·조치 3 보류분)은
//                              넣지 않는다 — 그러면 짝을 만들지 않고 unassigned_units 로 따로 남긴다.
//   · min_pairs_required   ← 19번 §3 말미 「짝 수는 탐색용 … 모자라면 비교 불가」 (확정 숫자는 문서가 정함)
//   · min_repeats          ← 칸별 최소 반복 수(19번 §6 / O4 3-7 ②)
//   · collection_shift_limit ← 수집률 급변 한계(0~1, 승인 후 값)
//   · group                ← 19번 §5 주 지표 = 처방군 질문 칸의 「제대로 앎」 비율 → 기본 "ai_brand"
//   · before / after       ← 기준선 회차 묶음 / 관찰 회차 묶음(aggregateRepeats 결과 코호트 각 1개, 없으면 null)
//
// 규칙(O4 3-7 ④, 지시서 3절):
//  1. 짝 = 같은 question_id·engine_id·언어의 전 값과 후 값. 짝 1개 = 질문×엔진×언어 1개(반복은 그 안의 변동성) —
//     같은 질문의 반복을 독립 표본으로 세지 않는다.
//  2. 코호트 키가 다르면 **그 짝은 계산하지 않고** 이유를 단다(순서: 판정 버전 → 엔진 세트 → 질문 세트 → 언어 →
//     측정 방식). 측정 방식은 기존 isSearchSamplingComparable 를 그대로 쓴다. 질문 세트 지문은 한쪽만 없어도(null↔값)
//     다른 것으로 본다(사전 등록 기간엔 질문 세트가 고정이어야 하므로 엄격).
//  3. 수집률 급변(그룹 수집률 변화 > 한계) → 전체 collection_rate_shift. 칸 반복 < min_repeats → repeats_insufficient.
//     분모 0 → denominator_zero. 전 칸 없음 → no_baseline, 후 칸 없음 → repeats_insufficient(반복 0).
//  4. 비교 불가 행은 before/after/delta 가 전부 null(숫자를 꾸며 넣지 않는다).
//  5. 비교 가능한 짝 수 < min_pairs_required → 전체 pairs_insufficient(difference null). 처방군 또는 대조군에
//     비교 가능한 짝이 없으면 no_control_pair. 개별 비교 불가 행은 목록에 남기되 평균에서 뺀다.
//  6. 전체가 비교 불가(코호트·수집률·짝 수·대조군)이면 팔별 mean_delta 도 null 이다(행별 delta 는 행에 남는다).
//     pair_count = 비교 가능한 짝 수(두 팔 합). 전체 행 수는 rows.length.
//  7. 「효과」「원인」 필드·문구를 만들지 않는다(문구는 EV-c 소관).
//
// ⚠️ 한계: 같은 질문을 여러 엔진에 물으면 짝이 질문 단위로는 독립이 아니다(짝 수는 탐색용 숫자). 그리고 일부 칸만
//   분모 0 이어서 빠지면 남은 짝의 평균이 달라질 수 있다 — 그래서 빠진 행을 rows 에 남긴다.

import type {
  ArmSummary,
  CohortKey,
  LanguageKey,
  NotComparableReason,
  PairArm,
  PairedComparisonRow,
  PairedComparisonSummary,
  ProofMetricGroup,
} from "./proof-types";
import type { CellAggregate, CohortAggregate } from "./repeat-aggregate";
import { kstDateOf, languageEquals } from "./repeat-aggregate";
import { isSearchSamplingComparable } from "./search-sampling-version";

export interface PairedComparisonInput {
  after: CohortAggregate | null;
  /** 질문 지문(normalizeQuestionText) → 처방군/대조군. 여기 없는 질문은 짝을 만들지 않는다. */
  assignment: Readonly<Record<string, PairArm>>;
  before: CohortAggregate | null;
  /** 그룹 수집률 변화(절댓값, 0~1)가 이 값을 넘으면 비교 불가. */
  collection_shift_limit: number;
  /** 어느 묶음의 노출률을 비교하나. 기본 "ai_brand"(사전 등록 주 지표). */
  group?: ProofMetricGroup;
  min_pairs_required: number;
  /** 칸별 최소 반복 수(판정이 끝난 답이 있는 회차 수). */
  min_repeats: number;
  prereg_id: string | null;
}

export interface UnassignedUnit {
  engine_id: string;
  question_id: string;
}

export interface PairedComparisonDetailed {
  /** 수집률 변화 절댓값(양쪽 비율이 있을 때만, 없으면 null). */
  collection_shift: number | null;
  summary: PairedComparisonSummary;
  /** 배정에 없어 짝을 만들지 않은 칸 — 숨기지 않고 남긴다. */
  unassigned_units: UnassignedUnit[];
}

/** 두 코호트 키의 차이를 사유 하나로. 같으면 null. */
export function cohortMismatchReason(
  before: CohortKey,
  after: CohortKey
): NotComparableReason | null {
  if (before.verdict_version !== after.verdict_version) {
    return "verdict_version_differs";
  }
  if (before.engine_set_key !== after.engine_set_key) {
    return "engine_set_differs";
  }
  if (before.question_set_key !== after.question_set_key) {
    return "question_set_differs";
  }
  if (!languageEquals(before.language, after.language)) {
    return "language_differs";
  }
  if (
    !isSearchSamplingComparable(before.sampling_version, after.sampling_version)
  ) {
    return "sampling_version_differs";
  }
  return null;
}

function collectionRateOf(
  cohort: CohortAggregate,
  group: ProofMetricGroup
): number | null {
  const observed = cohort.observed[group];
  return observed.status === "known" ? observed.value.collection.rate : null;
}

function dateOf(cohort: CohortAggregate | null): string {
  if (cohort === null) {
    return "";
  }
  return cohort.date_last_kst ?? kstDateOf(cohort.last_completed_at);
}

function unitKey(cell: CellAggregate): string {
  return `${cell.question_id}\u0000${cell.engine_id}`;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function rowReason(
  before: CellAggregate | undefined,
  after: CellAggregate | undefined,
  minRepeats: number
): NotComparableReason | null {
  if (before === undefined) {
    return "no_baseline";
  }
  if (after === undefined) {
    return "repeats_insufficient";
  }
  if (before.denominator === 0 || after.denominator === 0) {
    return "denominator_zero";
  }
  if (
    before.repeats_measured < minRepeats ||
    after.repeats_measured < minRepeats
  ) {
    return "repeats_insufficient";
  }
  return null;
}

function buildRow(
  before: CellAggregate | undefined,
  after: CellAggregate | undefined,
  context: {
    arm: PairArm;
    blocked: NotComparableReason | null;
    dateAfter: string;
    dateBefore: string;
    language: LanguageKey;
    minRepeats: number;
  }
): PairedComparisonRow {
  const sample = before ?? after;
  const questionId = sample?.question_id ?? "";
  const engineId = sample?.engine_id ?? "";
  const reason =
    context.blocked ?? rowReason(before, after, context.minRepeats);
  const comparable =
    reason === null &&
    before?.exposure_rate != null &&
    after?.exposure_rate != null;
  const base = {
    arm: context.arm,
    date_after: context.dateAfter,
    date_before: context.dateBefore,
    pair_id: `${engineId}|${context.language.language}|${questionId}`,
    repeats_after: after?.repeats_measured ?? 0,
    repeats_before: before?.repeats_measured ?? 0,
    unit_key: {
      engine_id: engineId,
      language: context.language,
      question_id: questionId,
    },
  };
  if (!comparable) {
    return {
      ...base,
      after: null,
      before: null,
      delta: null,
      not_comparable: reason ?? "denominator_zero",
    };
  }
  const b = before?.exposure_rate ?? 0;
  const a = after?.exposure_rate ?? 0;
  return { ...base, after: a, before: b, delta: a - b, not_comparable: null };
}

function armSummary(
  rows: readonly PairedComparisonRow[],
  arm: PairArm,
  blockAll: boolean
): ArmSummary {
  const armRows = rows.filter((r) => r.arm === arm);
  const deltas = armRows
    .filter((r) => r.not_comparable === null && r.delta !== null)
    .map((r) => r.delta as number);
  return {
    comparable_pairs: deltas.length,
    mean_delta: blockAll ? null : mean(deltas),
    pairs: armRows.length,
  };
}

function pairCells(
  input: PairedComparisonInput,
  group: ProofMetricGroup
): {
  beforeCells: Map<string, CellAggregate>;
  afterCells: Map<string, CellAggregate>;
  keys: string[];
} {
  const pick = (c: CohortAggregate | null) =>
    new Map(
      (c?.cells ?? [])
        .filter((cell) => cell.group === group)
        .map((cell) => [unitKey(cell), cell] as const)
    );
  const beforeCells = pick(input.before);
  const afterCells = pick(input.after);
  const keys = [
    ...new Set([...beforeCells.keys(), ...afterCells.keys()]),
  ].sort();
  return { afterCells, beforeCells, keys };
}

/** 전체 차단 사유: 코호트 조건 → 수집률 급변. 없으면 null. */
function globalBlock(
  input: PairedComparisonInput,
  group: ProofMetricGroup
): { reason: NotComparableReason | null; shift: number | null } {
  const { after, before } = input;
  if (before === null) {
    return { reason: "no_baseline", shift: null };
  }
  if (after === null) {
    return { reason: "repeats_insufficient", shift: null };
  }
  const mismatch = cohortMismatchReason(before.cohort, after.cohort);
  const rateBefore = collectionRateOf(before, group);
  const rateAfter = collectionRateOf(after, group);
  const shift =
    rateBefore === null || rateAfter === null
      ? null
      : Math.abs(rateAfter - rateBefore);
  if (mismatch !== null) {
    return { reason: mismatch, shift };
  }
  if (shift !== null && shift > input.collection_shift_limit) {
    return { reason: "collection_rate_shift", shift };
  }
  return { reason: null, shift };
}

function summaryReason(
  blocked: NotComparableReason | null,
  treated: ArmSummary,
  control: ArmSummary,
  minPairs: number
): NotComparableReason | null {
  if (blocked !== null) {
    return blocked;
  }
  if (treated.comparable_pairs + control.comparable_pairs < minPairs) {
    return "pairs_insufficient";
  }
  if (treated.comparable_pairs === 0 || control.comparable_pairs === 0) {
    return "no_control_pair";
  }
  return null;
}

/** 전후 짝짓기 + 배정에 없어 빠진 칸 목록 + 수집률 변화량. */
export function pairComparisonDetailed(
  input: PairedComparisonInput
): PairedComparisonDetailed {
  const group = input.group ?? "ai_brand";
  const { reason: blocked, shift } = globalBlock(input, group);
  const { afterCells, beforeCells, keys } = pairCells(input, group);
  const language = (input.before ?? input.after)?.cohort.language ?? {
    language: "ko" as const,
    script: null,
  };
  const rows: PairedComparisonRow[] = [];
  const unassigned: UnassignedUnit[] = [];
  for (const key of keys) {
    const before = beforeCells.get(key);
    const after = afterCells.get(key);
    const sample = before ?? after;
    const arm = sample ? input.assignment[sample.question_id] : undefined;
    if (sample === undefined) {
      continue;
    }
    if (arm === undefined) {
      unassigned.push({
        engine_id: sample.engine_id,
        question_id: sample.question_id,
      });
      continue;
    }
    rows.push(
      buildRow(before, after, {
        arm,
        blocked,
        dateAfter: dateOf(input.after),
        dateBefore: dateOf(input.before),
        language,
        minRepeats: input.min_repeats,
      })
    );
  }
  rows.sort(
    (a, b) => a.arm.localeCompare(b.arm) || a.pair_id.localeCompare(b.pair_id)
  );

  // 1차: 팔별 개수만(평균 보류)으로 전체 사유를 정하고, 사유가 있으면 평균을 비운다.
  const probeTreated = armSummary(rows, "treated", false);
  const probeControl = armSummary(rows, "control", false);
  const notComparable = summaryReason(
    blocked,
    probeTreated,
    probeControl,
    input.min_pairs_required
  );
  const treated = armSummary(rows, "treated", notComparable !== null);
  const control = armSummary(rows, "control", notComparable !== null);
  const difference =
    notComparable === null &&
    treated.mean_delta !== null &&
    control.mean_delta !== null
      ? treated.mean_delta - control.mean_delta
      : null;

  return {
    collection_shift: shift,
    summary: {
      control,
      difference,
      min_pairs_required: input.min_pairs_required,
      not_comparable: notComparable,
      pair_count: treated.comparable_pairs + control.comparable_pairs,
      prereg_id: input.prereg_id,
      rows,
      treated,
    },
    unassigned_units: unassigned,
  };
}

/** B1-min: 같은 질문·엔진·언어·판정 버전끼리만 전후 짝짓기. 판정이 아니라 표. */
export function pairComparison(
  input: PairedComparisonInput
): PairedComparisonSummary {
  return pairComparisonDetailed(input).summary;
}
