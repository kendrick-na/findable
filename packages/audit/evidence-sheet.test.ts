import { describe, expect, it } from "vitest";
import {
  assembleEvidenceSheet,
  type EvidenceSheetParts,
  notComparableReasonsOf,
} from "./evidence-sheet";
import type {
  Known,
  ObservedValues,
  PairedComparisonSummary,
  UnmeasuredRow,
} from "./proof-types";

// 가짜 입력(S1 파일을 쓰지 않는다). 숫자는 전부 손계산:
//   정상: 시도 7·수집 6(0.857…), 반복 3, 분모 10, 노출 4 → 노출률 0.4

const LIMITS = { limits_en: "limits-en", limits_ko: "한계" };
const KO = { language: "ko", script: "Hang" } as const;

function observed(overrides: Partial<ObservedValues> = {}): ObservedValues {
  return {
    buckets: {
      confirmed: 4,
      different_entity: 1,
      engine_error: 1,
      unknown: 5,
      unverified: 0,
    },
    collection: {
      attempted: 7,
      measured: 6,
      rate: 6 / 7,
      repeat_count: 3,
      suppressed: false,
      suppression_threshold: null,
      unit: "engine",
    },
    denominator: 10,
    exposure_count: 4,
    exposure_rate: 0.4,
    group: "ai_brand",
    interval: {
      as_of: "2026-10-21",
      status: "known",
      value: { confidence: 0.95, high: 0.7, low: 0.17, method: "wilson" },
    },
    ...overrides,
  };
}

function known<T>(value: T): Known<T> {
  return { as_of: "2026-10-21", status: "known", value };
}

function parts(over: Partial<EvidenceSheetParts> = {}): EvidenceSheetParts {
  return {
    as_of: "2026-10-21",
    before_after: null,
    brand_ref: { brand_id: "A-30", display_name: null },
    language: KO,
    limits: LIMITS,
    min_repeats: 3,
    observed: known(observed()),
    ui_language: "ko",
    unmeasured: [],
    ...over,
  };
}

const unmeasuredRow: UnmeasuredRow = {
  action_ko: "다음 행동",
  code: "engine_error",
  count: 2,
  denominator: 0,
  label_ko: "엔진 오류",
  rate: 0.5,
};

function summary(
  over: Partial<PairedComparisonSummary> = {}
): PairedComparisonSummary {
  return {
    control: { comparable_pairs: 2, mean_delta: 0.05, pairs: 2 },
    difference: 0.1,
    min_pairs_required: 2,
    not_comparable: null,
    pair_count: 4,
    prereg_id: null,
    rows: [
      {
        after: 0.5,
        arm: "treated",
        before: 0.3,
        date_after: "2026-10-27",
        date_before: "2026-10-21",
        delta: 0.2,
        not_comparable: null,
        pair_id: "p1",
        repeats_after: 3,
        repeats_before: 3,
        unit_key: {
          engine_id: "chatgpt",
          language: KO,
          question_id: "q1",
        },
      },
    ],
    treated: { comparable_pairs: 2, mean_delta: 0.15, pairs: 2 },
    ...over,
  };
}

describe("assembleEvidenceSheet", () => {
  it("정상: 반복 3회가 기준 3 이상이면 observed, 값이 그대로 실린다", () => {
    const sheet = assembleEvidenceSheet(parts());
    expect(sheet.finding_kind).toBe("observed");
    expect(sheet.footer).toEqual({
      as_of: "2026-10-21",
      not_effect_proof: true,
    });
    expect(sheet.envelope.schema_version).toBe(1);
    const obs = sheet.envelope.observed;
    expect(obs.status === "known" && obs.value.exposure_rate).toBe(0.4);
    // 안 준 조각은 0 이 아니라 확인 불가
    expect(sheet.envelope.retrieval.status).toBe("unavailable");
    expect(sheet.envelope.index_check).toMatchObject({
      reason: "not_configured",
      status: "unavailable",
    });
    expect(notComparableReasonsOf(parts())).toEqual([]);
  });

  it("반복 부족: 반복 2 < 기준 3 이면 not_comparable (발견을 만들지 않음)", () => {
    const base = observed();
    const sheet = assembleEvidenceSheet(
      parts({
        observed: known(
          observed({ collection: { ...base.collection, repeat_count: 2 } })
        ),
      })
    );
    expect(sheet.finding_kind).toBe("not_comparable");
    // 「효과」 종류 같은 필드가 없다
    expect(Object.keys(sheet).sort()).toEqual([
      "before_after",
      "brand_ref",
      "envelope",
      "finding_kind",
      "footer",
      "ui_language",
    ]);
    expect(
      notComparableReasonsOf(
        parts({
          observed: known(
            observed({ collection: { ...base.collection, repeat_count: 2 } })
          ),
        })
      )
    ).toEqual(["repeats_insufficient"]);
  });

  it("기준을 모르면(null) 안전 쪽으로 not_comparable", () => {
    expect(
      assembleEvidenceSheet(parts({ min_repeats: null })).finding_kind
    ).toBe("not_comparable");
  });

  it("값이 없으면(observed 확인 불가) not_comparable, 분모 0 사유는 구분", () => {
    const missing: Known<ObservedValues> = {
      as_of: null,
      detail_ko: "없음",
      reason: "source_missing",
      status: "unavailable",
    };
    expect(
      assembleEvidenceSheet(parts({ observed: missing })).finding_kind
    ).toBe("not_comparable");
    const zeroDen: Known<ObservedValues> = {
      ...missing,
      reason: "insufficient_sample",
    };
    expect(notComparableReasonsOf(parts({ observed: zeroDen }))).toEqual([
      "denominator_zero",
    ]);
    const base = observed();
    expect(
      notComparableReasonsOf(
        parts({
          observed: known(
            observed({ denominator: 0, exposure_rate: null, exposure_count: 0 })
          ),
        })
      )
    ).toEqual(["denominator_zero"]);
    expect(base.denominator).toBe(10);
  });

  it("미측정 있음: 사유·건수 그대로, 분모 0 이면 rate 는 0 이 아니라 null", () => {
    const sheet = assembleEvidenceSheet(
      parts({
        unmeasured: [
          unmeasuredRow,
          {
            ...unmeasuredRow,
            code: "stub_response",
            denominator: 4,
            rate: 0.25,
            count: 1,
          },
        ],
      })
    );
    const [a, b] = sheet.envelope.unmeasured;
    expect(a?.rate).toBeNull();
    expect(a?.count).toBe(2);
    expect(b?.rate).toBe(0.25);
    // 빈 배열도 명시적으로 유지된다
    expect(assembleEvidenceSheet(parts()).envelope.unmeasured).toEqual([]);
  });

  it("언어 다름: mixed 는 비교 불가, 측정 언어와 UI 언어는 별개", () => {
    const mixed = assembleEvidenceSheet(
      parts({ language: { language: "mixed", script: null } })
    );
    expect(mixed.finding_kind).toBe("not_comparable");
    expect(
      notComparableReasonsOf(
        parts({ language: { language: "mixed", script: null } })
      )
    ).toEqual(["mixed_cohort"]);
    const unknown = assembleEvidenceSheet(
      parts({ language: { language: "unknown", script: null } })
    );
    expect(unknown.finding_kind).toBe("not_comparable");
    expect(
      notComparableReasonsOf(
        parts({ language: { language: "unknown", script: null } })
      )
    ).toEqual(["mixed_cohort"]);
    const enUi = assembleEvidenceSheet(parts({ ui_language: "en" }));
    expect(enUi.ui_language).toBe("en");
    expect(enUi.envelope.language.language).toBe("ko");
    expect(enUi.finding_kind).toBe("observed");
  });

  it("전후: 정상 요약은 그대로, 비교 불가/짝 부족이면 차이·행 delta 가 null", () => {
    const ok = assembleEvidenceSheet(parts({ before_after: known(summary()) }));
    const okSummary = ok.before_after;
    expect(okSummary?.status === "known" && okSummary.value.difference).toBe(
      0.1
    );

    // 짝 수 1 < 최소 2 → 사유 채움, 차이 null
    const few = assembleEvidenceSheet(
      parts({ before_after: known(summary({ pair_count: 1 })) })
    );
    const fs = few.before_after;
    expect(fs?.status).toBe("known");
    if (fs?.status === "known") {
      expect(fs.value.not_comparable).toBe("pairs_insufficient");
      expect(fs.value.difference).toBeNull();
      expect(fs.value.rows.every((r) => r.delta === null)).toBe(true);
    }

    // 버전 다름으로 이미 비교 불가 → 그대로 유지하되 delta 는 null
    const diff = assembleEvidenceSheet(
      parts({
        before_after: known(
          summary({ not_comparable: "verdict_version_differs" })
        ),
      })
    );
    const ds = diff.before_after;
    if (ds?.status === "known") {
      expect(ds.value.not_comparable).toBe("verdict_version_differs");
      expect(ds.value.difference).toBeNull();
    }
    // 해당 없음은 null 그대로
    expect(assembleEvidenceSheet(parts()).before_after).toBeNull();
  });
});
