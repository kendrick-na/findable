import { describe, expect, it } from "vitest";
import { summarizeAnswerBuckets } from "./answer-buckets";
import {
  aggregateRepeats,
  kstDateOf,
  normalizeQuestionText,
  type RepeatAggregateOptions,
  type StoredRun,
} from "./repeat-aggregate";

// 고정 입력 — 모든 기대값은 손계산이다(아래 주석).
type Verdict = "confirmed" | "error" | "unknown";

const Q1 = "AI 검색 도구 뭐가 있어?";
const Q2 = "  ai 검색   도구를 추천해줘 ";

function row(
  engineId: string,
  question: string,
  verdict: Verdict,
  extra: Record<string, unknown> = {}
) {
  const base: Record<string, unknown> = {
    engineId,
    promptKind: "brand",
    promptLang: "ko",
    promptText: question,
    ...extra,
  };
  if (verdict === "confirmed") {
    return { ...base, brandMentioned: true, mentionQuality: "confirmed" };
  }
  if (verdict === "error") {
    return { ...base, errorMessage: "429" };
  }
  return { ...base, brandMentioned: false };
}

function run(
  id: string,
  completedAt: string,
  rows: unknown[],
  result: Record<string, unknown> = {}
): StoredRun {
  return {
    completed_at: completedAt,
    job_id: id,
    result: { engineResponses: rows, mentionVerdictVersion: 2, ...result },
  };
}

const OPTIONS: RepeatAggregateOptions = {
  is_publishable: () => true,
  min_repeats: 3,
  suppression_threshold: null,
};

// 3회 반복. 칸 4개(chatgpt·claude × Q1·Q2).
//  chatgpt/Q1: 확인 2 / 판정 3 → 2/3     chatgpt/Q2: 0/3
//  claude/Q1 : 확인 2 / 판정 3 → 2/3     claude/Q2 : 확인 2 / 판정 2(1회는 오류) → 1
//  합산: 확인 6, 판정 끝 11, 오류 1, 전체 12 → 6/11
//  칸 단위: n=4, k=2/3+0+2/3+1=7/3, 칸 평균 0.58333
function threeRuns(): StoredRun[] {
  return [
    run("j1", "2026-10-21T01:00:00Z", [
      row("chatgpt", Q1, "confirmed"),
      row("chatgpt", Q2, "unknown"),
      row("claude", Q1, "confirmed"),
      row("claude", Q2, "confirmed"),
    ]),
    run("j2", "2026-10-22T01:00:00Z", [
      row("chatgpt", Q1, "confirmed"),
      row("chatgpt", Q2, "unknown"),
      row("claude", Q1, "unknown"),
      row("claude", Q2, "error"),
    ]),
    run("j3", "2026-10-23T01:00:00Z", [
      row("chatgpt", Q1, "unknown"),
      row("chatgpt", Q2, "unknown"),
      row("claude", Q1, "confirmed"),
      row("claude", Q2, "confirmed"),
    ]),
  ];
}

function must<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("값이 있어야 함");
  }
  return value;
}

function onlyCohort(runs: StoredRun[], options = OPTIONS) {
  const result = aggregateRepeats(runs, options);
  if (result.cohorts.length !== 1) {
    throw new Error(`코호트 1개여야 함: ${result.cohorts.length}`);
  }
  return must(result.cohorts[0]);
}

describe("aggregateRepeats — 손계산 일치", () => {
  it("합산 노출률 6/11, 칸 4개, 반복 3", () => {
    const c = onlyCohort(threeRuns());
    expect(c.repeat_count).toBe(3);
    expect(c.comparable).toBe(true);
    expect(c.not_comparable).toBeNull();
    const ai = c.observed.ai_brand;
    expect(ai.status).toBe("known");
    if (ai.status !== "known") {
      return;
    }
    expect(ai.value.denominator).toBe(11);
    expect(ai.value.exposure_count).toBe(6);
    expect(ai.value.exposure_rate).toBeCloseTo(6 / 11, 12);
    expect(ai.value.buckets).toEqual({
      confirmed: 6,
      different_entity: 0,
      engine_error: 1,
      unknown: 5,
      unverified: 0,
    });
    expect(ai.value.group).toBe("ai_brand");
  });

  it("점추정은 summarizeAnswerBuckets 합산과 정확히 같다(단일 계산처)", () => {
    const runs = threeRuns();
    const pooled = summarizeAnswerBuckets(
      runs.flatMap(
        (r) => (r.result as { engineResponses: never[] }).engineResponses
      )
    );
    const ai = onlyCohort(runs).observed.ai_brand;
    expect(ai.status === "known" && ai.value.denominator).toBe(
      pooled.ai.adjudicated
    );
    expect(ai.status === "known" && ai.value.exposure_count).toBe(
      pooled.ai.confirmed
    );
  });

  it("칸: 질문 정규화 지문(공백·대소문자 무시), 칸별 비율·반복 수", () => {
    const c = onlyCohort(threeRuns());
    expect(c.cells).toHaveLength(4);
    const claudeQ2 = c.cells.find(
      (x) =>
        x.engine_id === "claude" && x.question_id === normalizeQuestionText(Q2)
    );
    expect(claudeQ2).toMatchObject({
      collected: true,
      denominator: 2,
      exposure_count: 2,
      exposure_rate: 1,
      repeats_attempted: 3,
      repeats_measured: 2,
    });
    expect(normalizeQuestionText(Q2)).toBe("ai 검색 도구를 추천해줘");
    const gptQ2 = c.cells.find(
      (x) =>
        x.engine_id === "chatgpt" && x.question_id === normalizeQuestionText(Q2)
    );
    expect(gptQ2).toMatchObject({ exposure_rate: 0, denominator: 3 });
  });

  it("칸 합계 = 합산 분모(칸 분해가 새 분모 규칙을 만들지 않음)", () => {
    const c = onlyCohort(threeRuns());
    const sum = c.cells.reduce((s, x) => s + x.denominator, 0);
    const ai = c.observed.ai_brand;
    expect(ai.status === "known" && ai.value.denominator).toBe(sum);
  });

  it("Wilson 구간은 칸 단위: n=4, k=7/3 → 약 0.195~0.890 (손계산)", () => {
    const c = onlyCohort(threeRuns());
    expect(c.cell_level.ai_brand.cells).toBe(4);
    expect(c.cell_level.ai_brand.mean_cell_rate).toBeCloseTo(7 / 12, 12);
    const ai = c.observed.ai_brand;
    if (ai.status !== "known" || ai.value.interval.status !== "known") {
      throw new Error("known 이어야 함");
    }
    expect(ai.value.interval.value.low).toBeCloseTo(0.195, 2);
    expect(ai.value.interval.value.high).toBeCloseTo(0.89, 2);
    expect(ai.value.interval.value.method).toBe("wilson");
  });

  it("칸 수집률: 4칸 중 4칸(칸 안 성공 1개면 수집), 반복 3, 칸 기준", () => {
    const c = onlyCohort(threeRuns());
    const ai = c.observed.ai_brand;
    expect(ai.status === "known" && ai.value.collection).toMatchObject({
      attempted: 4,
      measured: 4,
      rate: 1,
      repeat_count: 3,
      unit: "question_engine_cell",
    });
  });

  it("전부 오류인 칸은 미수집으로 세고 분모에서 빠진다", () => {
    const runs = threeRuns().map((r, i) => ({
      ...r,
      result: {
        ...(r.result as object),
        engineResponses: [
          ...(r.result as { engineResponses: unknown[] }).engineResponses,
          row("perplexity", Q1, "error"),
        ],
      },
      job_id: `k${i}`,
    }));
    const c = onlyCohort(runs);
    const ai = c.observed.ai_brand;
    if (ai.status !== "known") {
      throw new Error("known 이어야 함");
    }
    expect(ai.value.collection).toMatchObject({ attempted: 5, measured: 4 });
    expect(ai.value.collection.rate).toBeCloseTo(0.8, 12);
    // 분모는 그대로(오류 3건은 0 으로 세지 않고 뺌), 오류 칸은 칸 n 에도 안 들어감
    expect(ai.value.denominator).toBe(11);
    expect(ai.value.buckets.engine_error).toBe(4);
    expect(c.cell_level.ai_brand.cells).toBe(4);
    const pplx = c.cells.find((x) => x.engine_id === "perplexity");
    expect(pplx).toMatchObject({
      collected: false,
      denominator: 0,
      exposure_rate: null,
      repeats_measured: 0,
    });
  });

  it("같은 입력은 같은 출력, 입력 순서가 달라도 같다", () => {
    const a = aggregateRepeats(threeRuns(), OPTIONS);
    const b = aggregateRepeats([...threeRuns()].reverse(), OPTIONS);
    expect(a).toEqual(b);
  });

  it("완료일은 한국 시간 기준(KST)", () => {
    expect(kstDateOf("2026-10-20T16:00:00.000Z")).toBe("2026-10-21");
    expect(onlyCohort(threeRuns()).date_last_kst).toBe("2026-10-23");
  });
});

describe("aggregateRepeats — 기준 미달은 비교 불가", () => {
  it("반복이 min_repeats 미만이면 repeats_insufficient(숫자는 남김)", () => {
    const c = onlyCohort(threeRuns(), { ...OPTIONS, min_repeats: 4 });
    expect(c.comparable).toBe(false);
    expect(c.not_comparable).toBe("repeats_insufficient");
    expect(c.min_repeats).toBe(4);
    expect(c.observed.ai_brand.status).toBe("known");
  });

  it("회차 1개뿐이어도 억지로 비교 가능이라 하지 않는다", () => {
    const c = onlyCohort(threeRuns().slice(0, 1), OPTIONS);
    expect(c.not_comparable).toBe("repeats_insufficient");
    expect(c.repeat_count).toBe(1);
  });

  it("기준값은 인자다(같은 데이터가 min_repeats=1 이면 비교 가능)", () => {
    const c = onlyCohort(threeRuns().slice(0, 1), {
      ...OPTIONS,
      min_repeats: 1,
    });
    expect(c.comparable).toBe(true);
  });
});

describe("aggregateRepeats — 다른 조건은 합치지 않는다", () => {
  it("언어가 다른 두 회차는 합쳐지지 않는다(ko / en 코호트 분리)", () => {
    const ko = run("ko1", "2026-10-21T01:00:00Z", [
      row("chatgpt", Q1, "confirmed"),
    ]);
    const en = run("en1", "2026-10-21T02:00:00Z", [
      row("chatgpt", "Which AI search tool?", "unknown", {
        promptLang: "en",
      }),
    ]);
    const result = aggregateRepeats([ko, en], {
      ...OPTIONS,
      min_repeats: 1,
    });
    expect(result.cohorts).toHaveLength(2);
    const langs = result.cohorts.map((c) => c.cohort.language.language).sort();
    expect(langs).toEqual(["en", "ko"]);
    for (const c of result.cohorts) {
      expect(c.repeat_count).toBe(1);
      expect(
        c.cells.every((x) => x.language.language === c.cohort.language.language)
      ).toBe(true);
    }
  });

  it("판정 버전이 다르면 갈린다(재판정으로 합치지 않음), 현재 버전이 아닌 코호트는 withheld", () => {
    const v2 = run("v2", "2026-10-21T01:00:00Z", [
      row("chatgpt", Q1, "confirmed"),
    ]);
    const v1 = run(
      "v1",
      "2026-10-21T02:00:00Z",
      [row("chatgpt", Q1, "confirmed")],
      { mentionVerdictVersion: 1 }
    );
    const result = aggregateRepeats([v2, v1], {
      ...OPTIONS,
      is_publishable: (r) =>
        (r as { mentionVerdictVersion: number }).mentionVerdictVersion === 2,
      min_repeats: 1,
    });
    expect(result.cohorts).toHaveLength(2);
    const old = must(
      result.cohorts.find((c) => c.cohort.verdict_version === 1)
    );
    const cur = must(
      result.cohorts.find((c) => c.cohort.verdict_version === 2)
    );
    expect(cur.comparable).toBe(true);
    expect(old.withheld_job_ids).toEqual(["v1"]);
    expect(old.used_job_ids).toEqual([]);
    expect(old.repeat_count).toBe(0);
    expect(old.comparable).toBe(false);
    for (const g of ["ai_brand", "discovery", "search"] as const) {
      const o = old.observed[g];
      expect(o.status).toBe("unavailable");
      if (o.status === "unavailable") {
        expect(o.reason).toBe("withheld_not_publishable");
      }
    }
  });

  it("기본 게시 판정(isPublishableAuditResult)을 그대로 쓴다: 메트릭 없는 저장 결과는 withheld", () => {
    const result = aggregateRepeats(threeRuns(), {
      min_repeats: 1,
      suppression_threshold: null,
    });
    expect(must(result.cohorts[0]).withheld_job_ids).toHaveLength(3);
    expect(must(result.cohorts[0]).observed.ai_brand.status).toBe(
      "unavailable"
    );
  });

  it("같은 코호트 안에서 게시 불가 회차만 빠진다", () => {
    const runs = threeRuns();
    const result = aggregateRepeats(runs, {
      ...OPTIONS,
      is_publishable: (r) =>
        (r as { engineResponses: unknown[] }).engineResponses !==
        (must(runs[1]).result as { engineResponses: unknown[] })
          .engineResponses,
    });
    const c = must(result.cohorts[0]);
    expect(c.used_job_ids).toEqual(["j1", "j3"]);
    expect(c.withheld_job_ids).toEqual(["j2"]);
    expect(c.repeat_count).toBe(2);
    expect(c.not_comparable).toBe("repeats_insufficient"); // 2 < 3
  });

  it("측정 방식(엔진 세트)이 다르면 갈린다", () => {
    const a = run(
      "a",
      "2026-10-21T01:00:00Z",
      [row("chatgpt", Q1, "confirmed")],
      { measurementContext: { engineSetKey: "daily-noclaude-v1" } }
    );
    const b = run(
      "b",
      "2026-10-21T02:00:00Z",
      [row("chatgpt", Q1, "confirmed")],
      { measurementContext: { engineSetKey: "weekly-full-v1" } }
    );
    const result = aggregateRepeats([a, b], { ...OPTIONS, min_repeats: 1 });
    expect(result.cohorts).toHaveLength(2);
  });

  it("질문 세트 지문이 다르면 갈린다", () => {
    const a = run(
      "a",
      "2026-10-21T01:00:00Z",
      [row("chatgpt", Q1, "confirmed")],
      {
        measurementContext: { questionSetKey: "aaaaaaaa" },
      }
    );
    const b = run(
      "b",
      "2026-10-21T02:00:00Z",
      [row("chatgpt", Q1, "confirmed")],
      {
        measurementContext: { questionSetKey: "bbbbbbbb" },
      }
    );
    expect(
      aggregateRepeats([a, b], { ...OPTIONS, min_repeats: 1 }).cohorts
    ).toHaveLength(2);
  });

  it("조건이 같으면 한 코호트로 합쳐진다", () => {
    expect(aggregateRepeats(threeRuns(), OPTIONS).cohorts).toHaveLength(1);
  });
});

describe("aggregateRepeats — 못 합치는 회차는 숨기지 않고 따로 표기", () => {
  it("언어 기록(promptLang)이 없는 회차는 코호트에 넣지 않고 not_recorded", () => {
    const noLang = run("nl", "2026-10-21T01:00:00Z", [
      {
        engineId: "chatgpt",
        promptKind: "brand",
        promptText: Q1,
        brandMentioned: true,
        mentionQuality: "confirmed",
      },
    ]);
    const result = aggregateRepeats([noLang, ...threeRuns()], OPTIONS);
    expect(result.cohorts).toHaveLength(1);
    expect(result.excluded_runs).toEqual([
      expect.objectContaining({ job_id: "nl", reason: "not_recorded" }),
    ]);
    expect(must(result.cohorts[0]).job_ids).not.toContain("nl");
  });

  it("한 회차가 ko·en 을 섞으면 mixed_cohort 로 따로 표기", () => {
    const mixed = run("mx", "2026-10-21T01:00:00Z", [
      row("chatgpt", Q1, "confirmed"),
      row("chatgpt", "which tool", "unknown", { promptLang: "en" }),
    ]);
    const result = aggregateRepeats([mixed], OPTIONS);
    expect(result.cohorts).toHaveLength(0);
    expect(result.excluded_runs[0]).toMatchObject({
      job_id: "mx",
      reason: "mixed_cohort",
    });
  });

  it("완료 시각이 깨졌거나 저장 결과가 없으면 따로 표기", () => {
    const bad = { completed_at: "not-a-date", job_id: "bad", result: {} };
    const none = {
      completed_at: "2026-10-21T01:00:00Z",
      job_id: "none",
      result: null,
    };
    const result = aggregateRepeats([bad, none], OPTIONS);
    expect(result.excluded_runs.map((e) => [e.job_id, e.reason])).toEqual([
      ["bad", "not_recorded"],
      ["none", "source_missing"],
    ]);
  });

  it("질문 문구가 없는 행은 칸에서 빠지되 합산엔 들어가고, 개수를 밝힌다", () => {
    const noText = run("nt", "2026-10-21T01:00:00Z", [
      row("chatgpt", Q1, "confirmed"),
      {
        engineId: "chatgpt",
        promptKind: "brand",
        promptLang: "ko",
        brandMentioned: false,
      },
    ]);
    const c = onlyCohort([noText], { ...OPTIONS, min_repeats: 1 });
    expect(c.unidentified_rows).toBe(1);
    expect(c.cells).toHaveLength(1);
    const ai = c.observed.ai_brand;
    expect(ai.status === "known" && ai.value.denominator).toBe(2);
  });
});

describe("aggregateRepeats — 묶음(그룹)", () => {
  it("이름 없는 질문(discovery)·검색 엔진은 AI 비율과 섞이지 않는다", () => {
    const mixedGroups = run("g1", "2026-10-21T01:00:00Z", [
      row("chatgpt", Q1, "confirmed"),
      row("chatgpt", "추천해줘", "confirmed", { promptKind: "discovery" }),
      row("chatgpt", "다른 추천", "unknown", { promptKind: "discovery" }),
      row("naver", Q1, "confirmed", { naverSource: "search_results" }),
    ]);
    const c = onlyCohort([mixedGroups], { ...OPTIONS, min_repeats: 1 });
    const ai = c.observed.ai_brand;
    const discovery = c.observed.discovery;
    const search = c.observed.search;
    expect(ai.status === "known" && ai.value.denominator).toBe(1);
    expect(discovery.status).toBe("known");
    if (discovery.status === "known") {
      expect(discovery.value.denominator).toBe(2);
      expect(discovery.value.exposure_count).toBe(1);
      expect(discovery.value.exposure_rate).toBe(0.5);
    }
    expect(search.status === "known" && search.value.exposure_count).toBe(1);
  });

  it("해당 답변이 없는 묶음은 0 이 아니라 확인 불가(not_applicable)", () => {
    const c = onlyCohort(threeRuns());
    const d = c.observed.discovery;
    expect(d.status).toBe("unavailable");
    if (d.status === "unavailable") {
      expect(d.reason).toBe("not_applicable");
    }
  });

  it("판정이 끝난 답이 0건이면 비율은 null, 구간은 확인 불가(0% 아님)", () => {
    const allErrors = run("e", "2026-10-21T01:00:00Z", [
      row("chatgpt", Q1, "error"),
    ]);
    const c = onlyCohort([allErrors], { ...OPTIONS, min_repeats: 1 });
    const ai = c.observed.ai_brand;
    if (ai.status !== "known") {
      throw new Error("known 이어야 함");
    }
    expect(ai.value.exposure_rate).toBeNull();
    expect(ai.value.denominator).toBe(0);
    expect(ai.value.interval.status).toBe("unavailable");
    expect(c.cell_level.ai_brand).toEqual({ cells: 0, mean_cell_rate: null });
  });

  it("은퇴 엔진(hyperclova)·별도 축(naver-briefing)은 집계에서 빠진다", () => {
    const r = run("r", "2026-10-21T01:00:00Z", [
      row("hyperclova", Q1, "confirmed"),
      row("naver-briefing", Q1, "confirmed"),
      row("chatgpt", Q1, "unknown"),
    ]);
    const c = onlyCohort([r], { ...OPTIONS, min_repeats: 1 });
    expect(c.cells.map((x) => x.engine_id)).toEqual(["chatgpt"]);
  });
});
