/**
 * RX-2 조치 기록 양식 검증기 시험 — 고정 입력·가짜 데이터만(DB·외부 호출 없음).
 * 문구를 하드코딩해 맞추지 않고, 거부/통과(ok)와 문제가 난 칸 경로만 본다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTION_TYPES,
  type ActionLog,
  type ActionRecord,
  findForbiddenPhrases,
  INDEXED_STATES,
  isIsoTimestamp,
  NOT_COMPARABLE_REASON_VALUES,
  REFLECTION_PATHS,
  validateActionLog,
} from "./proof-plan";

const START = "2026-10-21T11:00:00+09:00";

function content(overrides: Partial<ActionRecord> = {}): ActionRecord {
  return {
    action_id: "act-1",
    action_type: "content_evidence",
    change_summary_ko: "질문과 맞는 근거 문단을 추가",
    target_page_url: "https://example.com/page",
    target_question_ids: ["q-1", "q-2"],
    already_indexed: "yes",
    index_check_method: "site: 검색",
    index_checked_at: "2026-10-21T10:00:00+09:00",
    expected_path: "web_search_index",
    planned_at: "2026-10-21T12:00:00+09:00",
    executed_at: null,
    verdict_version: 2,
    not_comparable_expected: false,
    not_comparable_reason: null,
    weak_effect_possible: false,
    weak_effect_note_ko: null,
    ...overrides,
  };
}

function log(actions: ActionRecord[], start: string | null = START): ActionLog {
  return {
    schema_version: 1,
    prereg_id: "prereg-test",
    start_signal_at: start,
    actions,
  };
}

function paths(result: ReturnType<typeof validateActionLog>): string[] {
  return result.ok ? [] : result.issues.map((i) => i.path);
}

describe("조치 기록 검증기", () => {
  it("올바른 기록은 통과한다", () => {
    expect(validateActionLog(log([content()])).ok).toBe(true);
  });

  it("빈 양식(조치 0건)도 통과한다", () => {
    expect(validateActionLog(log([], null)).ok).toBe(true);
  });

  it("객체가 아니거나 schema_version 이 다르면 거부한다", () => {
    expect(validateActionLog(null).ok).toBe(false);
    expect(validateActionLog({ ...log([]), schema_version: 2 }).ok).toBe(false);
    expect(validateActionLog({ ...log([]), actions: "x" }).ok).toBe(false);
  });

  it.each([
    "action_id",
    "action_type",
    "change_summary_ko",
    "target_page_url",
    "target_question_ids",
    "already_indexed",
    "expected_path",
    "not_comparable_expected",
    "weak_effect_possible",
  ] as const)("필수 칸 %s 가 없으면 거부한다", (field) => {
    const record: Record<string, unknown> = { ...content() };
    delete record[field];
    const result = validateActionLog({ ...log([]), actions: [record] });
    expect(result.ok).toBe(false);
    expect(paths(result)).toContain(`actions[0].${field}`);
  });

  it("색인 칸은 예/아니오/확인 불가 3값만 받는다", () => {
    expect([...INDEXED_STATES]).toEqual(["yes", "no", "unknown"]);
    const bad = validateActionLog(
      log([content({ already_indexed: "maybe" as never })])
    );
    expect(paths(bad)).toContain("actions[0].already_indexed");
  });

  it("조치 유형·반영 경로 목록 밖의 값을 거부한다", () => {
    expect([...ACTION_TYPES]).toEqual(["content_evidence", "format_only"]);
    expect([...REFLECTION_PATHS]).toEqual([
      "web_search_index",
      "model_knowledge",
      "both",
      "unknown",
    ]);
    const bad = validateActionLog(
      log([
        content({
          action_type: "access_fix" as never,
          expected_path: "guess" as never,
        }),
      ])
    );
    expect(paths(bad)).toEqual(
      expect.arrayContaining([
        "actions[0].action_type",
        "actions[0].expected_path",
      ])
    );
  });

  it("format_only 는 효과 약함 가능성 표시와 설명이 필수다", () => {
    const noFlag = validateActionLog(
      log([
        content({
          action_type: "format_only",
          weak_effect_possible: false,
          weak_effect_note_ko: "서식만 변경",
        }),
      ])
    );
    expect(paths(noFlag)).toContain("actions[0].weak_effect_possible");
    const noNote = validateActionLog(
      log([
        content({
          action_type: "format_only",
          weak_effect_possible: true,
          weak_effect_note_ko: null,
        }),
      ])
    );
    expect(paths(noNote)).toContain("actions[0].weak_effect_note_ko");
    const ok = validateActionLog(
      log([
        content({
          action_type: "format_only",
          weak_effect_possible: true,
          weak_effect_note_ko: "서식만 바꾼 조치",
        }),
      ])
    );
    expect(ok.ok).toBe(true);
  });

  it("색인이 아니오·확인 불가면 비교 불가 가능성 높음(true)으로 등록해야 한다", () => {
    for (const state of ["no", "unknown"] as const) {
      const bad = validateActionLog(
        log([
          content({ already_indexed: state, not_comparable_expected: false }),
        ])
      );
      expect(paths(bad)).toContain("actions[0].not_comparable_expected");
      const ok = validateActionLog(
        log([
          content({ already_indexed: state, not_comparable_expected: true }),
        ])
      );
      expect(ok.ok).toBe(true);
    }
  });

  it("시각은 시간대가 있는 ISO 8601 만 받는다", () => {
    expect(isIsoTimestamp("2026-10-21T10:00:00+09:00")).toBe(true);
    expect(isIsoTimestamp("2026-10-21T10:00Z")).toBe(true);
    expect(isIsoTimestamp("2026-10-21 10:00")).toBe(false);
    expect(isIsoTimestamp("2026-10-21")).toBe(false);
    expect(isIsoTimestamp("2026-13-45T10:00:00Z")).toBe(false);
    expect(isIsoTimestamp(1_760_000_000)).toBe(false);
    const bad = validateActionLog(log([content({ planned_at: "내일 오전" })]));
    expect(paths(bad)).toContain("actions[0].planned_at");
  });

  it("시작 신호 전에는 실행 시각을 적을 수 없고, 신호보다 앞서도 안 된다", () => {
    const before = validateActionLog(
      log([content({ executed_at: "2026-10-21T12:00:00+09:00" })], null)
    );
    expect(paths(before)).toContain("actions[0].executed_at");
    const early = validateActionLog(
      log([content({ executed_at: "2026-10-21T10:59:00+09:00" })])
    );
    expect(paths(early)).toContain("actions[0].executed_at");
    const ok = validateActionLog(
      log([content({ executed_at: "2026-10-21T12:00:00+09:00" })])
    );
    expect(ok.ok).toBe(true);
  });

  it("대상 페이지 주소가 아니거나 계정 정보가 들어 있으면 거부한다", () => {
    for (const url of [
      "",
      "page",
      "ftp://example.com/a",
      "https://user:pw@example.com/",
    ]) {
      const bad = validateActionLog(log([content({ target_page_url: url })]));
      expect(paths(bad)).toContain("actions[0].target_page_url");
    }
  });

  it("대상 질문 목록이 비거나 중복이면 거부한다", () => {
    expect(
      paths(validateActionLog(log([content({ target_question_ids: [] })])))
    ).toContain("actions[0].target_question_ids");
    expect(
      paths(
        validateActionLog(log([content({ target_question_ids: ["q", "q"] })]))
      )
    ).toContain("actions[0].target_question_ids");
  });

  it("조치 ID 중복을 거부한다", () => {
    const bad = validateActionLog(log([content(), content()]));
    expect(paths(bad)).toContain("actions[1].action_id");
  });

  it("비교 불가 사유는 K0 값만 받는다", () => {
    const ok = validateActionLog(
      log([content({ not_comparable_reason: "pairs_insufficient" })])
    );
    expect(ok.ok).toBe(true);
    const bad = validateActionLog(
      log([content({ not_comparable_reason: "whatever" as never })])
    );
    expect(paths(bad)).toContain("actions[0].not_comparable_reason");
  });

  it("자유 문구에 효과·보장 표현이 있으면 거부한다", () => {
    const bad = validateActionLog(
      log([content({ change_summary_ko: "근거를 넣어 노출을 높여드립니다" })])
    );
    expect(paths(bad)).toContain("actions[0].change_summary_ko");
  });
});

describe("금칙 표현 검사기", () => {
  it.each([
    "효과 입증",
    "효과가 입증됐다",
    "효과 보장",
    "정확도 보장",
    "최초의 서비스",
    "유일한 방법",
    "독립 기관 검증",
    "노출을 높여드립니다",
    "노출이 올랐다",
    "덕분에 좋아졌다",
    "한국 전용",
    "글로벌 플랫폼",
    "검증됨",
    "40% 개선",
    "+40 상승",
    "트래픽이 늘었다",
  ])("걸린다: %s", (text) => {
    expect(findForbiddenPhrases(text).length).toBeGreaterThan(0);
  });

  it.each([
    "한국어 효과는 입증되지 않았다",
    "한국어 효과 미입증",
    "효과를 보장하지 않습니다",
    "반복은 독립 표본이 아니라 변동성이다",
    "서식만 바꾼 조치",
  ])("통과한다(부정·한계 문장): %s", (text) => {
    expect(findForbiddenPhrases(text)).toEqual([]);
  });
});

describe("계약 일치", () => {
  const K0 = readFileSync(
    fileURLToPath(new URL("./proof-types.ts", import.meta.url)),
    "utf8"
  );

  it("비교 불가 사유 목록이 K0 NOT_COMPARABLE_REASONS 와 같다", () => {
    const block = K0.match(/NOT_COMPARABLE_REASONS = \[([\s\S]*?)\] as const/);
    expect(block).not.toBeNull();
    const k0 = [...(block?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map(
      (m) => m[1]
    );
    expect([...NOT_COMPARABLE_REASON_VALUES]).toEqual(k0);
  });
});

describe("조치기록.json (빈 양식)", () => {
  it("양식 검증을 통과한다", () => {
    const raw = readFileSync(
      fileURLToPath(
        new URL("../../docs/_적용/효과증명/조치기록.json", import.meta.url)
      ),
      "utf8"
    );
    expect(validateActionLog(JSON.parse(raw)).ok).toBe(true);
  });
});
