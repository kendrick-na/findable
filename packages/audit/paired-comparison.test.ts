import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cohortMismatchReason,
  type PairedComparisonInput,
  pairComparison,
  pairComparisonDetailed,
} from "./paired-comparison";
import {
  aggregateRepeats,
  normalizeQuestionText,
  type RepeatAggregateOptions,
  type StoredRun,
} from "./repeat-aggregate";

const T1 = "처방 질문 하나";
const T2 = "처방 질문 둘";
const C1 = "대조 질문 하나";
const C2 = "대조 질문 둘";

const ASSIGNMENT = {
  [normalizeQuestionText(T1)]: "treated",
  [normalizeQuestionText(T2)]: "treated",
  [normalizeQuestionText(C1)]: "control",
  [normalizeQuestionText(C2)]: "control",
} as const;

const AGG: RepeatAggregateOptions = {
  is_publishable: () => true,
  min_repeats: 3,
  suppression_threshold: null,
};

type CellSpec = Record<string, number | "error">;

/** 질문마다 3회 중 앞 k회 노출(confirmed), 나머지 unknown. "error" 면 3회 전부 오류. */
function makeRuns(
  prefix: string,
  spec: CellSpec,
  options: {
    count?: number;
    extraResult?: Record<string, unknown>;
    lang?: "ko" | "en";
    extraRows?: Record<string, unknown>[];
  } = {}
): StoredRun[] {
  const count = options.count ?? 3;
  return Array.from({ length: count }, (_, i) => {
    const rows = Object.entries(spec).map(([text, k]) => {
      const base = {
        engineId: "chatgpt",
        promptKind: "brand",
        promptLang: options.lang ?? "ko",
        promptText: text,
      };
      if (k === "error") {
        return { ...base, errorMessage: "429" };
      }
      return i < k
        ? { ...base, brandMentioned: true, mentionQuality: "confirmed" }
        : { ...base, brandMentioned: false };
    });
    return {
      completed_at: `2026-10-${prefix === "b" ? 21 : 25}T01:00:00Z`,
      job_id: `${prefix}${i}`,
      result: {
        engineResponses: [...rows, ...(options.extraRows ?? [])],
        mentionVerdictVersion: 2,
        ...options.extraResult,
      },
    };
  });
}

function cohortOf(runs: StoredRun[]) {
  const c = aggregateRepeats(runs, AGG).cohorts[0];
  if (!c) {
    throw new Error("코호트가 있어야 함");
  }
  return c;
}

// 전: T1 1/3, T2 0/3, C1 1/3, C2 2/3 → 후: T1 3/3, T2 2/3, C1 1/3, C2 1/3
// 차이: T1 +2/3, T2 +2/3 → 처방군 평균 2/3 / C1 0, C2 −1/3 → 대조군 평균 −1/6
// difference = 2/3 − (−1/6) = 5/6
const BEFORE_SPEC: CellSpec = { [T1]: 1, [T2]: 0, [C1]: 1, [C2]: 2 };
const AFTER_SPEC: CellSpec = { [T1]: 3, [T2]: 2, [C1]: 1, [C2]: 1 };

function baseInput(
  over: Partial<PairedComparisonInput> = {}
): PairedComparisonInput {
  return {
    after: cohortOf(makeRuns("a", AFTER_SPEC)),
    assignment: ASSIGNMENT,
    before: cohortOf(makeRuns("b", BEFORE_SPEC)),
    collection_shift_limit: 0.2,
    min_pairs_required: 4,
    min_repeats: 3,
    prereg_id: "사전등록 확정 2026-10-20",
    ...over,
  };
}

/** 모든 행이 비교 불가이고 전·후·차이가 전부 null 인가. */
function allRowsBlank(summary: ReturnType<typeof pairComparison>): boolean {
  return summary.rows.every(
    (r) =>
      r.not_comparable !== null &&
      r.before === null &&
      r.after === null &&
      r.delta === null
  );
}

describe("pairComparison — 같은 조건 짝만 계산, 손계산 일치", () => {
  it("짝 4개, 처방군 평균 +2/3, 대조군 평균 −1/6, 차이 5/6", () => {
    const s = pairComparison(baseInput());
    expect(s.not_comparable).toBeNull();
    expect(s.pair_count).toBe(4);
    expect(s.min_pairs_required).toBe(4);
    expect(s.prereg_id).toBe("사전등록 확정 2026-10-20");
    expect(s.treated).toMatchObject({ comparable_pairs: 2, pairs: 2 });
    expect(s.control).toMatchObject({ comparable_pairs: 2, pairs: 2 });
    expect(s.treated.mean_delta).toBeCloseTo(2 / 3, 12);
    expect(s.control.mean_delta).toBeCloseTo(-1 / 6, 12);
    expect(s.difference).toBeCloseTo(5 / 6, 12);
  });

  it("행: 전·후 값(0~1)·차이·반복 수·날짜·단위 키", () => {
    const s = pairComparison(baseInput());
    const t1 = s.rows.find(
      (r) => r.unit_key.question_id === normalizeQuestionText(T1)
    );
    expect(t1).toMatchObject({
      arm: "treated",
      date_after: "2026-10-25",
      date_before: "2026-10-21",
      not_comparable: null,
      repeats_after: 3,
      repeats_before: 3,
    });
    expect(t1?.before).toBeCloseTo(1 / 3, 12);
    expect(t1?.after).toBe(1);
    expect(t1?.delta).toBeCloseTo(2 / 3, 12);
    expect(t1?.unit_key).toEqual({
      engine_id: "chatgpt",
      language: { language: "ko", script: "Hang" },
      question_id: normalizeQuestionText(T1),
    });
  });

  it("같은 입력 재계산 일치", () => {
    expect(pairComparison(baseInput())).toEqual(pairComparison(baseInput()));
  });

  it("출력에 효과·원인 필드가 없다(K0 키 그대로)", () => {
    const s = pairComparison(baseInput());
    expect(Object.keys(s).sort()).toEqual(
      [
        "control",
        "difference",
        "min_pairs_required",
        "not_comparable",
        "pair_count",
        "prereg_id",
        "rows",
        "treated",
      ].sort()
    );
    expect(JSON.stringify(s)).not.toMatch(/effect|cause|효과|원인/);
  });
});

describe("pairComparison — 비교 불가", () => {
  it("짝 수가 사전 등록 최소선 미만 → pairs_insufficient, 차이·평균 null, 행 값은 남김", () => {
    const s = pairComparison(baseInput({ min_pairs_required: 5 }));
    expect(s.not_comparable).toBe("pairs_insufficient");
    expect(s.difference).toBeNull();
    expect(s.treated.mean_delta).toBeNull();
    expect(s.control.mean_delta).toBeNull();
    expect(s.pair_count).toBe(4);
    expect(s.rows.every((r) => r.delta !== null)).toBe(true);
  });

  it("판정 버전이 다르면 → verdict_version_differs, 모든 행 값 null", () => {
    const after = cohortOf(
      makeRuns("a", AFTER_SPEC, {
        extraResult: { mentionVerdictVersion: 1 },
      })
    );
    const s = pairComparison(baseInput({ after }));
    expect(s.not_comparable).toBe("verdict_version_differs");
    expect(s.difference).toBeNull();
    expect(s.rows).toHaveLength(4);
    expect(allRowsBlank(s)).toBe(true);
    expect(
      s.rows.every((r) => r.not_comparable === "verdict_version_differs")
    ).toBe(true);
  });

  it("측정 방식(검색 표본)이 다르면 → sampling_version_differs", () => {
    const naver = (marker: boolean) => ({
      engineId: "naver",
      promptKind: "brand",
      promptLang: "ko",
      promptText: T1,
      brandMentioned: true,
      mentionQuality: "confirmed",
      naverSource: "search_results",
      ...(marker ? { naverSamplingVersion: "interleave-v1" } : {}),
    });
    const before = cohortOf(
      makeRuns("b", BEFORE_SPEC, { extraRows: [naver(false)] })
    );
    const after = cohortOf(
      makeRuns("a", AFTER_SPEC, { extraRows: [naver(true)] })
    );
    const s = pairComparison(baseInput({ after, before }));
    expect(s.not_comparable).toBe("sampling_version_differs");
    expect(allRowsBlank(s)).toBe(true);
  });

  it("엔진 세트가 다르면 → engine_set_differs", () => {
    const after = cohortOf(
      makeRuns("a", AFTER_SPEC, {
        extraResult: { measurementContext: { engineSetKey: "weekly-full-v1" } },
      })
    );
    const before = cohortOf(
      makeRuns("b", BEFORE_SPEC, {
        extraResult: {
          measurementContext: { engineSetKey: "daily-noclaude-v1" },
        },
      })
    );
    expect(pairComparison(baseInput({ after, before })).not_comparable).toBe(
      "engine_set_differs"
    );
  });

  it("질문 세트 지문이 다르거나 한쪽만 없어도 → question_set_differs", () => {
    const withKey = (key: string | null, prefix: string, spec: CellSpec) =>
      cohortOf(
        makeRuns(prefix, spec, {
          extraResult: key
            ? { measurementContext: { questionSetKey: key } }
            : {},
        })
      );
    expect(
      pairComparison(
        baseInput({
          after: withKey("bbbbbbbb", "a", AFTER_SPEC),
          before: withKey("aaaaaaaa", "b", BEFORE_SPEC),
        })
      ).not_comparable
    ).toBe("question_set_differs");
    expect(
      pairComparison(
        baseInput({
          after: withKey("bbbbbbbb", "a", AFTER_SPEC),
          before: withKey(null, "b", BEFORE_SPEC),
        })
      ).not_comparable
    ).toBe("question_set_differs");
  });

  it("언어가 다르면 → language_differs", () => {
    const after = cohortOf(makeRuns("a", AFTER_SPEC, { lang: "en" }));
    const s = pairComparison(baseInput({ after }));
    expect(s.not_comparable).toBe("language_differs");
    expect(allRowsBlank(s)).toBe(true);
  });

  it("수집률 급변 → collection_rate_shift (칸 4개 중 2개가 전부 오류: 1 → 0.5)", () => {
    const after = cohortOf(
      makeRuns("a", { [T1]: 3, [T2]: "error", [C1]: 1, [C2]: "error" })
    );
    const detailed = pairComparisonDetailed(baseInput({ after }));
    expect(detailed.summary.not_comparable).toBe("collection_rate_shift");
    expect(detailed.collection_shift).toBeCloseTo(0.5, 12);
    expect(allRowsBlank(detailed.summary)).toBe(true);
  });

  it("수집률 변화가 한계 이내면 막지 않는다(1 → 0.75, 한계 0.3)", () => {
    const after = cohortOf(
      makeRuns("a", { [T1]: 3, [T2]: "error", [C1]: 1, [C2]: 1 })
    );
    const s = pairComparison(
      baseInput({ after, collection_shift_limit: 0.3, min_pairs_required: 3 })
    );
    expect(s.not_comparable).toBeNull();
  });

  it("개별 비교 불가 행(분모 0)은 목록에 남기되 평균에서 제외한다", () => {
    const after = cohortOf(
      makeRuns("a", { [T1]: 3, [T2]: "error", [C1]: 1, [C2]: 1 })
    );
    const s = pairComparison(
      baseInput({ after, collection_shift_limit: 0.3, min_pairs_required: 3 })
    );
    expect(s.rows).toHaveLength(4);
    const t2 = s.rows.find(
      (r) => r.unit_key.question_id === normalizeQuestionText(T2)
    );
    expect(t2).toMatchObject({
      after: null,
      before: null,
      delta: null,
      not_comparable: "denominator_zero",
    });
    expect(s.treated).toMatchObject({ comparable_pairs: 1, pairs: 2 });
    // 남은 처방군 짝은 T1 하나 → 평균 2/3, 대조군 −1/6, 차이 5/6
    expect(s.treated.mean_delta).toBeCloseTo(2 / 3, 12);
    expect(s.difference).toBeCloseTo(5 / 6, 12);
    expect(s.pair_count).toBe(3);
  });

  it("칸 반복이 모자라면 → repeats_insufficient(행·전체)", () => {
    const after = cohortOf(makeRuns("a", AFTER_SPEC, { count: 2 }));
    const s = pairComparison(baseInput({ after }));
    expect(
      s.rows.every((r) => r.not_comparable === "repeats_insufficient")
    ).toBe(true);
    expect(s.rows.every((r) => r.repeats_after === 2)).toBe(true);
    expect(s.not_comparable).toBe("pairs_insufficient");
    expect(allRowsBlank(s)).toBe(true);
  });

  it("처방군 또는 대조군에 비교 가능한 짝이 없으면 → no_control_pair", () => {
    const allTreated = Object.fromEntries(
      Object.keys(ASSIGNMENT).map((q) => [q, "treated" as const])
    );
    const s = pairComparison(
      baseInput({ assignment: allTreated, min_pairs_required: 1 })
    );
    expect(s.not_comparable).toBe("no_control_pair");
    expect(s.difference).toBeNull();
    expect(s.control.pairs).toBe(0);
  });

  it("기준선이 없으면 → no_baseline", () => {
    const s = pairComparison(baseInput({ before: null }));
    expect(s.not_comparable).toBe("no_baseline");
    expect(s.difference).toBeNull();
    expect(allRowsBlank(s)).toBe(true);
  });

  it("관찰 회차가 없으면 비교 불가(반복 0)", () => {
    const s = pairComparison(baseInput({ after: null }));
    expect(s.not_comparable).toBe("repeats_insufficient");
    expect(allRowsBlank(s)).toBe(true);
  });

  it("not_comparable 이 있는 행은 항상 delta===null, 없는 행은 delta 가 있다(불변식)", () => {
    const variants = [
      baseInput(),
      baseInput({ min_pairs_required: 9 }),
      baseInput({ before: null }),
      baseInput({
        after: cohortOf(
          makeRuns("a", { [T1]: 3, [T2]: "error", [C1]: 1, [C2]: 1 })
        ),
        collection_shift_limit: 0.3,
        min_pairs_required: 3,
      }),
    ];
    for (const input of variants) {
      for (const r of pairComparison(input).rows) {
        if (r.not_comparable !== null) {
          expect(r.delta).toBeNull();
        } else {
          expect(r.delta).not.toBeNull();
        }
      }
    }
  });
});

describe("pairComparisonDetailed — 배정에 없는 칸은 숨기지 않는다", () => {
  it("배정하지 않은 질문은 짝을 만들지 않고 unassigned_units 로 남긴다", () => {
    const extra = "배정 안 한 질문";
    const detailed = pairComparisonDetailed(
      baseInput({
        after: cohortOf(makeRuns("a", { ...AFTER_SPEC, [extra]: 1 })),
        before: cohortOf(makeRuns("b", { ...BEFORE_SPEC, [extra]: 1 })),
      })
    );
    expect(detailed.summary.rows).toHaveLength(4);
    expect(detailed.unassigned_units).toEqual([
      { engine_id: "chatgpt", question_id: normalizeQuestionText(extra) },
    ]);
  });
});

describe("cohortMismatchReason", () => {
  it("같은 키는 null", () => {
    const k = cohortOf(makeRuns("b", BEFORE_SPEC)).cohort;
    expect(cohortMismatchReason(k, { ...k })).toBeNull();
  });
});

// S1 신규 파일이 순수 함수인지 소스를 훑어 확인한다(지시서 4절).
describe("S1 신규 파일 — 순수 함수 보장(소스 훑기)", () => {
  const FILES = [
    "measurement-stats.ts",
    "repeat-aggregate.ts",
    "paired-comparison.ts",
    "collection-rate.ts",
    "unmeasured-breakdown.ts",
  ];
  for (const file of FILES) {
    it(`${file}: console.log·any·process.env·@repo/database import 없음`, () => {
      const src = readFileSync(join(import.meta.dirname, file), "utf8");
      expect(src).not.toMatch(/console\.log/);
      expect(src).not.toMatch(/process\.env/);
      expect(src).not.toMatch(/@repo\/database/);
      expect(src).not.toMatch(/:\s*any\b|<any>|\bas any\b|\bany\[\]/);
    });
  }

  it("금칙어(효과 입증·최초·유일·독립 기관·정확도 보장)가 코드·문구에 없다", () => {
    for (const file of FILES) {
      const src = readFileSync(join(import.meta.dirname, file), "utf8");
      expect(src, file).not.toMatch(
        /효과 입증|최초|유일|독립 기관|정확도 보장/
      );
    }
  });
});
