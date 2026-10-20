// 증거 한 장 조립기 (EV-a, S2) — 2026-10-21 (착수 10/20).
//
// 역할: **이미 계산된 조각**(K0 타입)을 받아 `EvidenceSheetInput` 한 덩어리로 조립한다.
//   · 계산하지 않는다(비율·구간·Wilson 은 S1 몫). 조각을 고르고, 비어 있으면 「확인 불가」로 채우고,
//     반복이 모자라면 「발견」 대신 `finding_kind: "not_comparable"` 로 둔다.
//   · 문구를 만들지 않는다(문구는 evidence-copy.ts). 단, K0 가 요구하는 `Known.detail_ko` 기본 사유 한 줄은 여기 둔다.
//   · S1 파일을 import 하지 않는다. DB·네트워크·환경변수 없음. 순수 함수.
//   · 이름 주의: 기존 `evidence-series.ts`(조치 완료 기록용)와 다른 파일이다.
//
// 규칙(헷갈리지 않게):
//   1. 못 잰 값은 0 이 아니다. 비어 있으면 `Known.unavailable` + 사유, 분모 0 이면 rate=null.
//   2. 반복 횟수가 기준(`min_repeats`, 사전 등록 문서에서 온 값)에 못 미치면 반드시 not_comparable.
//      기준을 모르면(null) 판단할 수 없으므로 마찬가지로 not_comparable(안전 쪽).
//   3. `footer.not_effect_proof` 는 항상 true.

import type {
  EngineModelInfo,
  EvidenceEnvelope,
  EvidenceSheetInput,
  FindingKind,
  IndexCheck,
  Known,
  LanguageKey,
  LimitsBlock,
  MeasuredAtRange,
  MethodVersion,
  NotComparableReason,
  ObservedValues,
  PairedComparisonRow,
  PairedComparisonSummary,
  ProofLanguage,
  RetrievalInfo,
  SourceIds,
  UnmeasuredRow,
} from "./proof-types";

/** 조립에 필요한 조각들. 전부 K0 타입 — S1 이 계산한 값을 그대로 넣는다. */
export interface EvidenceSheetParts {
  /** 기준일 ISO — 푸터에 찍힌다. 호출자가 정한다(함수가 시계를 읽지 않는다) */
  as_of: string;
  /** 전후 비교(B1-min 출력). null = 이 장에 전후 비교가 해당 없음 */
  before_after: Known<PairedComparisonSummary> | null;
  brand_ref: { brand_id: string; display_name: string | null };
  engine_model?: Known<EngineModelInfo[]>;
  index_check?: Known<IndexCheck>;
  language: LanguageKey;
  limits: LimitsBlock;
  measured_at?: Known<MeasuredAtRange>;
  method_version?: Known<MethodVersion>;
  /** 사전 등록에서 온 최소 반복 횟수. 코드에 숫자를 박지 않는다. null = 아직 모름 */
  min_repeats: number | null;
  observed: Known<ObservedValues>;
  retrieval?: Known<RetrievalInfo>;
  source_ids?: Known<SourceIds>;
  ui_language: ProofLanguage;
  unmeasured: readonly UnmeasuredRow[];
}

function unavailableNotRecorded<T>(): Known<T> {
  return {
    as_of: null,
    detail_ko: "조각이 전달되지 않음",
    reason: "not_recorded",
    status: "unavailable",
  };
}

function unavailableNotConfigured<T>(): Known<T> {
  return {
    as_of: null,
    detail_ko: "색인 확인 방법이 설정되지 않음",
    reason: "not_configured",
    status: "unavailable",
  };
}

/**
 * 비교 불가 사유를 모은다(반복 부족·언어 섞임·분모 0·조각 없음 등). 비어 있으면 「관찰값」으로 낼 수 있다.
 * 화면·문서가 「비교 불가(반복 N회뿐)」 같은 문구를 만들 때 이 목록을 쓴다.
 */
export function notComparableReasonsOf(
  parts: Pick<EvidenceSheetParts, "language" | "min_repeats" | "observed">
): NotComparableReason[] {
  const reasons: NotComparableReason[] = [];
  const { observed } = parts;
  if (observed.status === "unavailable") {
    // 값이 없으면 발견을 만들 재료가 없다. 분모·표본 문제는 사유로 구분한다.
    reasons.push(
      observed.reason === "insufficient_sample"
        ? "denominator_zero"
        : "repeats_insufficient"
    );
    return reasons;
  }
  const { collection, denominator } = observed.value;
  if (
    parts.min_repeats === null ||
    collection.repeat_count < parts.min_repeats
  ) {
    reasons.push("repeats_insufficient");
  }
  if (denominator === 0) {
    reasons.push("denominator_zero");
  }
  if (parts.language.language === "mixed") {
    reasons.push("mixed_cohort");
  }
  return reasons;
}

/** 전후 비교 요약을 방어적으로 정리: 비교 불가면 차이는 null(K0 규칙), 짝 수가 모자라면 사유를 채운다. */
function sanitizeComparison(
  known: Known<PairedComparisonSummary> | null
): Known<PairedComparisonSummary> | null {
  if (known === null || known.status === "unavailable") {
    return known;
  }
  const summary = known.value;
  let reason: NotComparableReason | null = summary.not_comparable;
  if (reason === null && summary.pair_count < summary.min_pairs_required) {
    reason = "pairs_insufficient";
  }
  if (reason === null) {
    return known;
  }
  const rows: PairedComparisonRow[] = summary.rows.map((row) => ({
    ...row,
    delta: null,
  }));
  return {
    ...known,
    value: {
      ...summary,
      difference: null,
      not_comparable: reason,
      rows,
    },
  };
}

/** 못 잰 사유 행 정리: 순서·건수는 그대로, 분모 0 이면 rate 를 0 이 아니라 null 로 둔다. */
function normalizeUnmeasured(rows: readonly UnmeasuredRow[]): UnmeasuredRow[] {
  return rows.map((row) => ({
    ...row,
    rate: row.denominator === 0 ? null : row.rate,
  }));
}

export function assembleEvidenceSheet(
  parts: EvidenceSheetParts
): EvidenceSheetInput {
  const comparison = sanitizeComparison(parts.before_after);
  const envelope: EvidenceEnvelope = {
    comparison,
    engine_model: parts.engine_model ?? unavailableNotRecorded(),
    index_check: parts.index_check ?? unavailableNotConfigured(),
    language: parts.language,
    limits: parts.limits,
    measured_at: parts.measured_at ?? unavailableNotRecorded(),
    method_version: parts.method_version ?? unavailableNotRecorded(),
    observed: parts.observed,
    retrieval: parts.retrieval ?? unavailableNotRecorded(),
    schema_version: 1,
    source_ids: parts.source_ids ?? unavailableNotRecorded(),
    unmeasured: normalizeUnmeasured(parts.unmeasured),
  };
  const finding_kind: FindingKind =
    notComparableReasonsOf(parts).length > 0 ? "not_comparable" : "observed";
  return {
    before_after: comparison,
    brand_ref: parts.brand_ref,
    envelope,
    finding_kind,
    footer: { as_of: parts.as_of, not_effect_proof: true },
    ui_language: parts.ui_language,
  };
}
