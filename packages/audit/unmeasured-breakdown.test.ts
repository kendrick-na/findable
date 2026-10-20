import { describe, expect, it } from "vitest";
import { GAP_ACTION_KO, GAP_LABEL_KO } from "./measurement-gap";
import {
  buildUnmeasuredBreakdown,
  type UnmeasuredRunInput,
} from "./unmeasured-breakdown";

const ok = (engineId: string) => ({ engineId, brandMentioned: true });

function withRows(
  id: string,
  rows: unknown[],
  extra: Record<string, unknown> = {}
): UnmeasuredRunInput {
  return { job_id: id, result: { engineResponses: rows, ...extra } };
}

// 고정 입력(손계산):
//  r1 정상 응답 2행 + 진단 코드 few_questions
//  r2 실패 `UNMEASURABLE:robots_blocked` (결과 없음)
//  r3 5행: 정상 2, 오류 1, 스텁 1(오류 문구도 같이 있음), 검색 불가 1
//  r4 정상 3행
//  → 회차 4: few_questions 1(0.25), robots_blocked 1(0.25)
//  → 응답 10행: engine_error 1(0.1), search_unavailable 1(0.1), stub_response 1(0.1)
function fixture(): UnmeasuredRunInput[] {
  return [
    withRows("r1", [ok("chatgpt"), ok("claude")], {
      measurementContext: { gapDiagnostics: { codes: ["few_questions"] } },
    }),
    { error_message: "UNMEASURABLE:robots_blocked", job_id: "r2" },
    withRows("r3", [
      ok("chatgpt"),
      ok("claude"),
      { engineId: "gemini", errorMessage: "429" },
      { engineId: "perplexity", isStub: true, errorMessage: "no key" },
      { engineId: "claude", usage: { searchUnavailable: true } },
    ]),
    withRows("r4", [ok("chatgpt"), ok("claude"), ok("gemini")]),
  ];
}

describe("buildUnmeasuredBreakdown", () => {
  it("회차 단위 사유와 응답 단위 사유를 각자의 분모로 센다", () => {
    const b = buildUnmeasuredBreakdown(fixture());
    expect(b.status).toBe("has_unmeasured");
    expect(b.run_count).toBe(4);
    expect(b.response_count).toBe(10);
    expect(b.rows.map((r) => [r.code, r.count, r.denominator, r.rate])).toEqual(
      [
        ["few_questions", 1, 4, 0.25],
        ["robots_blocked", 1, 4, 0.25],
        ["engine_error", 1, 10, 0.1],
        ["search_unavailable", 1, 10, 0.1],
        ["stub_response", 1, 10, 0.1],
      ]
    );
  });

  it("라벨·행동은 기존 GAP_LABEL_KO·GAP_ACTION_KO 를 그대로 쓴다", () => {
    const rows = buildUnmeasuredBreakdown(fixture()).rows;
    const robots = rows.find((r) => r.code === "robots_blocked");
    expect(robots?.label_ko).toBe(GAP_LABEL_KO.robots_blocked);
    expect(robots?.action_ko).toBe(GAP_ACTION_KO.robots_blocked);
    // 새로 정의한 3개도 라벨·행동이 비어 있지 않다
    for (const code of [
      "engine_error",
      "search_unavailable",
      "stub_response",
    ]) {
      const row = rows.find((r) => r.code === code);
      expect(row?.label_ko).not.toBe("");
      expect(row?.action_ko).not.toBe("");
    }
  });

  it("스텁은 오류 문구가 같이 있어도 스텁으로만 센다(이중 집계 없음)", () => {
    const rows = buildUnmeasuredBreakdown(fixture()).rows;
    expect(rows.find((r) => r.code === "engine_error")?.count).toBe(1);
    expect(rows.find((r) => r.code === "stub_response")?.count).toBe(1);
  });

  it("미측정을 0건으로 세지 않는다: 오류·스텁·검색 불가가 모두 집계에 나온다", () => {
    const b = buildUnmeasuredBreakdown([
      withRows("x", [
        { engineId: "chatgpt", errorMessage: "timeout" },
        { engineId: "claude", isStub: true },
        { engineId: "gemini", usage: { searchUnavailable: true } },
      ]),
    ]);
    expect(b.status).toBe("has_unmeasured");
    expect(b.rows.reduce((s, r) => s + r.count, 0)).toBe(3);
  });

  it("측정하지 못한 것이 0건이면 빈 배열을 명시한다(none_unmeasured)", () => {
    const b = buildUnmeasuredBreakdown([
      withRows("a", [ok("chatgpt")]),
      withRows("b", [ok("claude")]),
    ]);
    expect(b.status).toBe("none_unmeasured");
    expect(b.rows).toEqual([]);
    expect(b.run_count).toBe(2);
  });

  it("입력 회차가 없으면 「없음」이 아니라 no_data(볼 자료 없음)", () => {
    const b = buildUnmeasuredBreakdown([]);
    expect(b.status).toBe("no_data");
    expect(b.rows).toEqual([]);
  });

  it("분모 0 이면 rate:null — 응답 행이 없는 회차만 있을 때 응답 수준 사유는 안 나온다", () => {
    const b = buildUnmeasuredBreakdown([
      { error_message: "prepare_error: boom", job_id: "p" },
    ]);
    expect(b.response_count).toBe(0);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0]).toMatchObject({
      code: "prepare_error",
      count: 1,
      denominator: 1,
      rate: 1,
    });
  });

  it("사유 미분류 실패는 unclassified 로 남는다(사유 없는 실패를 만들지 않음)", () => {
    const b = buildUnmeasuredBreakdown([
      { error_message: "무슨 오류", job_id: "u" },
    ]);
    expect(b.rows[0]?.code).toBe("unclassified");
  });

  it("실패 문구와 결과 진단이 같은 코드를 말해도 한 회차는 1번만 센다", () => {
    const b = buildUnmeasuredBreakdown([
      {
        error_message: "UNMEASURABLE:few_questions",
        job_id: "d",
        result: {
          measurementContext: { gapDiagnostics: { codes: ["few_questions"] } },
        },
      },
    ]);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0]?.count).toBe(1);
  });

  it("서비스가 끝난 엔진(hyperclova) 행은 분모·사유에서 뺀다", () => {
    const b = buildUnmeasuredBreakdown([
      withRows("h", [
        { engineId: "hyperclova", errorMessage: "service ended" },
        ok("chatgpt"),
      ]),
    ]);
    expect(b.response_count).toBe(1);
    expect(b.status).toBe("none_unmeasured");
  });

  it("알 수 없는 진단 코드는 무시하고 꾸며내지 않는다", () => {
    const b = buildUnmeasuredBreakdown([
      withRows("z", [ok("chatgpt")], {
        measurementContext: { gapDiagnostics: { codes: ["not_a_code"] } },
      }),
    ]);
    expect(b.status).toBe("none_unmeasured");
  });

  it("같은 입력 재계산 일치", () => {
    expect(buildUnmeasuredBreakdown(fixture())).toEqual(
      buildUnmeasuredBreakdown(fixture())
    );
  });
});
