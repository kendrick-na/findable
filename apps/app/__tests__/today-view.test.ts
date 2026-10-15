import { PUBLIC_COUNTER_EXCLUDED_ORG_IDS } from "@repo/database/internal-orgs";
import { describe, expect, test } from "vitest";
import {
  isTodayViewEnabled,
  shouldWarnMissingSources,
  summarizeEngineSources,
  summarizeReadiness,
  todayDelta,
  todayFirst,
} from "../app/(authenticated)/lib/today-view";

describe("「오늘」 화면 파일럿 스위치", () => {
  const teamOrg = PUBLIC_COUNTER_EXCLUDED_ORG_IDS[0] ?? "";

  test("기본은 꺼짐 — 일반 고객 조직·조직 없음에는 보이지 않는다", () => {
    expect(isTodayViewEnabled({ orgId: "org_customer" })).toBe(false);
    expect(isTodayViewEnabled({ orgId: null })).toBe(false);
    expect(isTodayViewEnabled({ orgId: undefined })).toBe(false);
  });

  test("우리 팀·테스트 조직에는 켜진다", () => {
    expect(teamOrg).not.toBe("");
    expect(isTodayViewEnabled({ orgId: teamOrg })).toBe(true);
  });

  test("환경변수 파일럿 목록에 든 조직에만 켜진다(공백·빈 값 무시)", () => {
    const raw = " org_a , org_b ,, ";
    expect(isTodayViewEnabled({ orgId: "org_a", pilotOrgIdsRaw: raw })).toBe(
      true
    );
    expect(isTodayViewEnabled({ orgId: "org_b", pilotOrgIdsRaw: raw })).toBe(
      true
    );
    expect(isTodayViewEnabled({ orgId: "org_c", pilotOrgIdsRaw: raw })).toBe(
      false
    );
    expect(isTodayViewEnabled({ orgId: "", pilotOrgIdsRaw: raw })).toBe(false);
  });

  test("view=old 면 팀·파일럿도 예전 화면으로 돌아간다(되돌리기)", () => {
    expect(isTodayViewEnabled({ orgId: teamOrg, view: "old" })).toBe(false);
    expect(
      isTodayViewEnabled({
        orgId: "org_a",
        pilotOrgIdsRaw: "org_a",
        view: "old",
      })
    ).toBe(false);
  });
});

describe("엔진별 출처 요약", () => {
  const names = new Map([
    ["e1", "ChatGPT"],
    ["e2", "Perplexity"],
  ]);

  test("측정 실패 행은 응답으로 세지 않고, 출처는 배열이 비어 있지 않을 때만 센다", () => {
    const lines = summarizeEngineSources(
      [
        { engineId: "e1", citedSources: [], errorMessage: null },
        { engineId: "e1", citedSources: null, errorMessage: null },
        { engineId: "e1", citedSources: [{ url: "x" }], errorMessage: "fail" },
        { engineId: "e2", citedSources: [{ url: "y" }], errorMessage: null },
        { engineId: "unknown", citedSources: [1], errorMessage: null },
      ],
      names
    );
    expect(lines).toEqual([
      { engine: "ChatGPT", answers: 2, withSources: 0 },
      { engine: "Perplexity", answers: 1, withSources: 1 },
    ]);
  });

  test("출처를 한 번도 안 붙인 엔진이 있고 다른 엔진은 붙였을 때만 경고한다", () => {
    expect(
      shouldWarnMissingSources([
        { engine: "A", answers: 4, withSources: 0 },
        { engine: "B", answers: 4, withSources: 4 },
      ])
    ).toBe(true);
    // 전부 0 이면 측정 방식 문제인지 데이터 부재인지 알 수 없다 → 단정하지 않는다
    expect(
      shouldWarnMissingSources([
        { engine: "A", answers: 4, withSources: 0 },
        { engine: "B", answers: 4, withSources: 0 },
      ])
    ).toBe(false);
    expect(
      shouldWarnMissingSources([{ engine: "A", answers: 4, withSources: 4 }])
    ).toBe(false);
    expect(shouldWarnMissingSources([])).toBe(false);
  });
});

describe("사이트 점검 요약", () => {
  test("점검이 없으면 0 이 아니라 null", () => {
    expect(summarizeReadiness(null)).toBeNull();
    expect(summarizeReadiness(undefined)).toBeNull();
    expect(summarizeReadiness([])).toBeNull();
  });

  test("실패·주의만 센다(info·pass 는 문제가 아니다)", () => {
    expect(
      summarizeReadiness([
        { status: "pass" },
        { status: "fail" },
        { status: "warning" },
        { status: "warning" },
        { status: "info" },
      ])
    ).toEqual({ total: 5, fail: 1, warning: 2 });
  });
});

describe("지난 측정과의 차이", () => {
  test("방식이 바뀌어 막힌 비교는 숫자를 만들지 않는다", () => {
    expect(todayDelta({ blockedReason: "x", deltaPoints: 5 })).toEqual({
      kind: "blocked",
      points: null,
    });
  });

  test("지난 측정이 없으면 none, 0 이면 flat, 아니면 방향과 절댓값", () => {
    expect(todayDelta({ blockedReason: null, deltaPoints: null }).kind).toBe(
      "none"
    );
    expect(todayDelta({ blockedReason: null, deltaPoints: 0 }).kind).toBe(
      "flat"
    );
    expect(todayDelta({ blockedReason: null, deltaPoints: 0.04 }).kind).toBe(
      "flat"
    );
    expect(todayDelta({ blockedReason: null, deltaPoints: 3.26 })).toEqual({
      kind: "up",
      points: 3.3,
    });
    expect(todayDelta({ blockedReason: null, deltaPoints: -2 })).toEqual({
      kind: "down",
      points: 2,
    });
  });
});

describe("먼저 살펴볼 질문", () => {
  test("질문이 없으면 null(만들어 내지 않는다)", () => {
    expect(todayFirst([])).toBeNull();
  });

  test("가장 약한 질문(맨 앞)을 그대로 보여 준다", () => {
    expect(
      todayFirst([
        { text: "q1", hit: 1, total: 7 },
        { text: "q2", hit: 5, total: 7 },
      ])
    ).toEqual({ kind: "weak", prompt: "q1", hit: 1, total: 7 });
  });

  test("가장 약한 질문도 만점이면 약점이 없다고 말한다", () => {
    expect(todayFirst([{ text: "q1", hit: 7, total: 7 }])).toEqual({
      kind: "allHit",
    });
  });
});
