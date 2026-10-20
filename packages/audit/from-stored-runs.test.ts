import { describe, expect, it } from "vitest";
import {
  buildEvidenceSheetView,
  buildLimitsBlock,
  flattenView,
  scanBannedPhrases,
} from "./evidence-copy";
import { fromStoredRuns, fromStoredRunsDetailed } from "./from-stored-runs";
import { GAP_LABEL_KO } from "./measurement-gap";
import type { PairArm } from "./proof-types";
import { normalizeQuestionText, type StoredRun } from "./repeat-aggregate";

// 저장 모양을 흉내 낸 고정 fixture(익명·가짜): 한 회차 = 질문 8 × 엔진 6 = 48응답, 3회차 = 144응답.
//   AI 엔진 4개(chatgpt·claude·perplexity·gemini) + 검색 엔진 2개(naver·daum).
//   처방군 q1·q2 / 대조군 q3·q4 / 배정 안 함 q5~q8 (배정은 입력으로 넘긴다 — 코드에 박지 않음).
// 손계산(후 3회): AI 칸 = 4엔진 × 8질문 = 32칸, 회차당 확인 = 처방군 8(2질문×4엔진) + 대조군 4(2질문×chatgpt·claude) = 12
//   → 3회 합 판정이 끝난 96건 중 확인 36건. 전(3회): 대조군 4칸만 확인 → 처방군 변화 +1(8칸), 대조군 변화 0(8칸) → 차이 1.
const QUESTIONS = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"].map(
  (q) => `질문 ${q} 가나다`
);
const AI = ["chatgpt", "claude", "perplexity", "gemini"];
const SEARCH = ["naver", "daum"];
const ASSIGNMENT: Record<string, PairArm> = {
  [normalizeQuestionText(QUESTIONS[0] ?? "")]: "treated",
  [normalizeQuestionText(QUESTIONS[1] ?? "")]: "treated",
  [normalizeQuestionText(QUESTIONS[2] ?? "")]: "control",
  [normalizeQuestionText(QUESTIONS[3] ?? "")]: "control",
};

type Row = Record<string, unknown>;

function rowsFor(
  confirmed: (engine: string, qIndex: number) => boolean,
  extra: (engine: string, qIndex: number) => Row = () => ({})
): Row[] {
  const rows: Row[] = [];
  for (const engine of [...AI, ...SEARCH]) {
    QUESTIONS.forEach((q, i) => {
      const yes = confirmed(engine, i);
      rows.push({
        brandMentioned: yes,
        engineId: engine,
        errorMessage: null,
        isStub: false,
        mentionQuality: yes ? "confirmed" : undefined,
        promptKind: "brand",
        promptLang: "ko",
        promptText: q,
        ...extra(engine, i),
      });
    });
  }
  return rows;
}

const BEFORE = (engine: string, i: number) =>
  (engine === "chatgpt" || engine === "claude") && (i === 2 || i === 3);
const AFTER = (engine: string, i: number) =>
  i < 2 ||
  ((engine === "chatgpt" || engine === "claude") && (i === 2 || i === 3));

function runs(
  prefix: string,
  days: string[],
  rows: Row[] | (() => Row[]),
  result: Record<string, unknown> = {}
): StoredRun[] {
  return days.map((d, i) => ({
    completed_at: `2026-10-${d}T01:00:00Z`,
    job_id: `${prefix}${i + 1}`,
    result: {
      engineResponses:
        typeof rows === "function" ? rows() : rows.map((r) => ({ ...r })),
      mentionVerdictVersion: 2,
      ...result,
    },
  }));
}

const OPTIONS = {
  assignment: ASSIGNMENT,
  as_of: "2026-10-27",
  brand_ref: { brand_id: "brand-1", display_name: "시험브랜드" },
  collection_shift_limit: 0.2,
  is_publishable: () => true,
  limits: buildLimitsBlock(),
  min_pairs_required: 8,
  min_repeats: 3,
  prereg_id: "test",
  ui_language: "ko" as const,
};

const before3 = () => runs("b", ["20", "21", "22"], rowsFor(BEFORE));
const after3 = () => runs("a", ["25", "26", "27"], rowsFor(AFTER));

describe("fromStoredRuns — 정상(반복 3회)", () => {
  it("48응답 × 3회 = 144응답에서 손계산과 같은 숫자를 낸다", () => {
    const a = after3();
    const total = a.reduce(
      (n, r) => n + ((r.result as Row).engineResponses as Row[]).length,
      0
    );
    expect(total).toBe(144);
    const sheet = fromStoredRuns({ after: a, before: before3() }, OPTIONS);
    expect(sheet.finding_kind).toBe("observed");
    const obs = sheet.envelope.observed;
    expect(obs.status).toBe("known");
    if (obs.status === "known") {
      expect(obs.value.denominator).toBe(96);
      expect(obs.value.exposure_count).toBe(36);
      expect(obs.value.exposure_rate).toBeCloseTo(36 / 96, 12);
      expect(obs.value.collection.repeat_count).toBe(3);
    }
    const ba = sheet.before_after;
    expect(ba?.status).toBe("known");
    if (ba?.status === "known") {
      expect(ba.value.not_comparable).toBeNull();
      expect(ba.value.treated.mean_delta).toBeCloseTo(1, 12);
      expect(ba.value.control.mean_delta).toBeCloseTo(0, 12);
      expect(ba.value.difference).toBeCloseTo(1, 12);
      expect(ba.value.pair_count).toBe(16);
    }
    expect(sheet.question_count).toMatchObject({ status: "known", value: 8 });
    expect(sheet.region?.status).toBe("unavailable");
    expect(sheet.envelope.source_ids).toMatchObject({ status: "known" });
    expect(sheet.footer.not_effect_proof).toBe(true);
  });

  it("질문당 1~2회 반복: 한 회차에 같은 질문이 두 번 있으면 분모에 그대로 들어간다", () => {
    const a = after3();
    const dup = (a[1]?.result as Row).engineResponses as Row[];
    dup.push({ ...(dup[0] as Row) }); // chatgpt·q1 한 번 더
    const sheet = fromStoredRuns({ after: a, before: before3() }, OPTIONS);
    const obs = sheet.envelope.observed;
    expect(obs.status === "known" && obs.value.denominator).toBe(97);
    expect(obs.status === "known" && obs.value.exposure_count).toBe(37);
  });
});

describe("fromStoredRuns — 비교 불가·확인 불가 전파(0 아님)", () => {
  it("반복이 2회뿐이면 비교 불가이고 차이는 null", () => {
    const sheet = fromStoredRuns(
      { after: after3().slice(0, 2), before: before3() },
      OPTIONS
    );
    expect(sheet.finding_kind).toBe("not_comparable");
    const ba = sheet.before_after;
    expect(ba?.status === "known" && ba.value.difference).toBeNull();
    expect(ba?.status === "known" && ba.value.not_comparable).not.toBeNull();
  });

  it("질문 언어 기록이 없으면 관찰값은 확인 불가이고 언어는 unknown", () => {
    const noLang = runs("n", ["25", "26", "27"], () =>
      rowsFor(AFTER).map(({ promptLang: _p, ...r }) => r)
    );
    const sheet = fromStoredRuns({ after: noLang, before: before3() }, OPTIONS);
    expect(sheet.envelope.observed).toMatchObject({
      reason: "not_recorded",
      status: "unavailable",
    });
    expect(sheet.envelope.language).toEqual({
      language: "unknown",
      script: null,
    });
    expect(sheet.finding_kind).toBe("not_comparable");
  });

  it("게시 불가 회차(실제 게시 기준)는 숫자 없이 확인 불가", () => {
    const few = runs("f", ["25", "26", "27"], rowsFor(AFTER).slice(0, 4));
    const sheet = fromStoredRuns(
      { after: few, before: before3() },
      { ...OPTIONS, is_publishable: undefined }
    );
    expect(sheet.envelope.observed).toMatchObject({
      reason: "withheld_not_publishable",
      status: "unavailable",
    });
    expect(sheet.finding_kind).toBe("not_comparable");
  });

  it("처방 전 회차가 없으면 기준선 없음으로 비교 불가", () => {
    const sheet = fromStoredRuns({ after: after3(), before: [] }, OPTIONS);
    const ba = sheet.before_after;
    expect(ba?.status === "known" && ba.value.not_comparable).toBe(
      "no_baseline"
    );
    expect(ba?.status === "known" && ba.value.difference).toBeNull();
  });

  it("배정(assignment)을 넘기지 않으면 짝을 만들지 않고 비교 불가", () => {
    const sheet = fromStoredRuns(
      { after: after3(), before: before3() },
      { ...OPTIONS, assignment: {} }
    );
    const ba = sheet.before_after;
    expect(ba?.status === "known" && ba.value.difference).toBeNull();
    expect(ba?.status === "known" && ba.value.not_comparable).not.toBeNull();
  });

  it("엔진 오류 응답은 0 이 아니라 측정하지 못한 이유 표에 남고 분모에서 빠진다", () => {
    const err = runs(
      "e",
      ["25", "26", "27"],
      rowsFor(AFTER, (engine, i) =>
        engine === "gemini" && i === 7
          ? {
              errorMessage: "429",
              mentionQuality: undefined,
              brandMentioned: false,
            }
          : {}
      )
    );
    const sheet = fromStoredRuns({ after: err, before: before3() }, OPTIONS);
    const gap = sheet.envelope.unmeasured.find(
      (u) => u.code === "engine_error"
    );
    expect(gap).toMatchObject({ count: 3 });
    const obs = sheet.envelope.observed;
    expect(obs.status === "known" && obs.value.denominator).toBe(93);
  });
});

describe("증거 한 장 최종 출력 금칙어 훑기", () => {
  it("측정하지 못한 이유 표에 모든 회차 수준 사유 문구가 들어가도 ko·en 출력에 금칙어가 없다", () => {
    const sheet = fromStoredRuns(
      { after: after3(), before: before3() },
      OPTIONS
    );
    const codes = Object.keys(GAP_LABEL_KO);
    const withAll = {
      ...sheet,
      envelope: {
        ...sheet.envelope,
        unmeasured: [
          ...sheet.envelope.unmeasured,
          ...codes.map((code) => ({
            action_ko: "",
            code: code as never,
            count: 1,
            denominator: 3,
            label_ko: GAP_LABEL_KO[code as keyof typeof GAP_LABEL_KO],
            rate: 1 / 3,
          })),
        ],
      },
    };
    // 실제 상수 문구(GAP_ACTION_KO)를 그대로 싣는다 — 상수 파일은 고치지 않는다.
    return import("./measurement-gap").then(({ GAP_ACTION_KO }) => {
      withAll.envelope.unmeasured = withAll.envelope.unmeasured.map((u) =>
        u.code in GAP_ACTION_KO
          ? {
              ...u,
              action_ko: GAP_ACTION_KO[u.code as keyof typeof GAP_ACTION_KO],
            }
          : u
      );
      for (const ui of ["ko", "en"] as const) {
        const view = buildEvidenceSheetView(
          { ...withAll, ui_language: ui },
          {}
        );
        expect(scanBannedPhrases(flattenView(view))).toEqual([]);
      }
    });
  });
});

describe("여러 코호트·게시 불가 봉투 일관성", () => {
  it("최신 코호트 규칙: 마지막 완료 시각이 가장 늦은 묶음을 고르고 나머지는 합치지 않고 보고한다", () => {
    const old3 = after3(); // 판정 버전 2, 10/25~27
    const newer = runs("v", ["28", "29"], rowsFor(AFTER), {
      mentionVerdictVersion: 3,
    });
    const out = fromStoredRunsDetailed(
      { after: [...old3, ...newer], before: before3() },
      OPTIONS
    );
    expect(out.other_cohorts).toHaveLength(1);
    expect(out.other_cohorts[0]).toMatchObject({
      job_ids: ["a1", "a2", "a3"],
      reason: "not_latest_cohort",
    });
    // 선택된 묶음은 v1·v2 두 회차뿐이라 반복 부족 → 비교 불가(옛 3회와 합치지 않는다)
    expect(out.sheet.finding_kind).toBe("not_comparable");
    const obs = out.sheet.envelope.observed;
    expect(obs.status === "known" && obs.value.collection.repeat_count).toBe(2);
    expect(out.selected_cohort_id).not.toBeNull();
    expect(out.excluded_runs).toEqual([]);
  });

  it("마지막 완료 시각이 같으면 반복 수가 많은 묶음을 고른다(결정적)", () => {
    const three = runs("x", ["25", "26", "27"], rowsFor(AFTER));
    const two = runs("y", ["26", "27"], rowsFor(AFTER), {
      mentionVerdictVersion: 3,
    });
    const out = fromStoredRunsDetailed(
      { after: [...two, ...three], before: before3() },
      OPTIONS
    );
    expect(out.other_cohorts[0]?.job_ids).toEqual(["y1", "y2"]);
    const obs = out.sheet.envelope.observed;
    expect(obs.status === "known" && obs.value.collection.repeat_count).toBe(3);
    // 입력 순서를 바꿔도 같은 선택
    const again = fromStoredRunsDetailed(
      { after: [...three, ...two], before: before3() },
      OPTIONS
    );
    expect(again.selected_cohort_id).toBe(out.selected_cohort_id);
  });

  it("게시 불가 묶음이면 측정 시각·방식·출처·질문 수도 모두 확인 불가로 낮춘다", () => {
    const few = runs("f", ["25", "26", "27"], rowsFor(AFTER).slice(0, 4));
    const sheet = fromStoredRuns(
      { after: few, before: before3() },
      { ...OPTIONS, is_publishable: undefined }
    );
    const env = sheet.envelope;
    for (const key of [
      "observed",
      "measured_at",
      "method_version",
      "source_ids",
    ] as const) {
      expect(env[key], key).toMatchObject({
        reason: "withheld_not_publishable",
        status: "unavailable",
      });
    }
    expect(sheet.question_count).toMatchObject({
      reason: "withheld_not_publishable",
      status: "unavailable",
    });
    expect(sheet.finding_kind).toBe("not_comparable");
  });
});
