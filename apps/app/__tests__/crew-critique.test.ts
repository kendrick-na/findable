/**
 * crew 자기평가(critique) 회귀 테스트 (2026-08-09).
 *
 * 여기서 지키는 것 = **"약속을 명백히 어겼을 때만 재작성한다"**.
 * 너무 민감하면 모든 회차가 재작성돼 비용·시간이 배로 들고,
 * 너무 둔감하면 `executiveSummary` 347자(약속 80자)가 그대로 화면에 나간다.
 *
 * ⚠️ `packages/ai` 엔 vitest 가 없어 이 앱에 둔다(기존 관례).
 *
 * @vitest-environment node
 */

import {
  CREW_LIMITS,
  CREW_OVERAGE_TOLERANCE,
  critiqueStrategist,
} from "@repo/ai/lib/crew/critique";
import { describe, expect, it } from "vitest";

/**
 * 해당 한도에서 **확실히 재작성 대상이 되는** 길이.
 * ⚠️ 숫자를 하드코딩하지 않는다 — `CREW_OVERAGE_TOLERANCE` 는 실측 분포에 따라
 *   조정되는 값이라(1.5 → 2.5 로 한 번 바뀌었다) 상수에서 계산해야 테스트가 따라온다.
 */
const over = (limit: number) => Math.ceil(limit * CREW_OVERAGE_TOLERANCE) + 1;

/** 최소 형태의 액션(검사 대상 필드만 채운다). */
const action = (over: Partial<Record<string, unknown>> = {}) => ({
  rank: 1,
  title: "짧은 제목",
  princetonStrategy: "cite_sources",
  rationale: "근거",
  steps: ["단계 1"],
  impact: 5,
  effort: 2,
  expectedTimeframe: "4주 내",
  channel: "owned_site",
  ...over,
});

/**
 * 최소 형태의 전략가 산출물.
 * ⚠️ `critiqueStrategist` 는 검사하는 필드만 읽으므로 전체 스키마를 채우지 않는다.
 *   타입은 호출 시점에 단언한다(테스트 픽스처를 실제 타입에 맞추면 검사와 무관한
 *   필드까지 유지보수해야 한다).
 */
const output = (over: Partial<Record<string, unknown>> = {}) => ({
  executiveSummary: "짧은 요약",
  mondayActionOne: {
    title: "월요일 액션",
    whyThisOne: "이유",
    expectedOutcome: "결과",
  },
  topActions: [action()],
  ...over,
});

/** 픽스처를 `critiqueStrategist` 인자 타입으로 좁힌다. */
const judge = (o: ReturnType<typeof output>) =>
  critiqueStrategist(o as unknown as Parameters<typeof critiqueStrategist>[0]);

describe("critiqueStrategist", () => {
  it("약속을 지킨 산출물은 재작성하지 않는다", () => {
    const c = judge(output());
    expect(c.needsRewrite).toBe(false);
    expect(c.violations).toEqual([]);
    expect(c.instruction).toBe("");
  });

  it("🔴 실측 사례: executiveSummary 347자(약속 80자)는 재작성 대상", () => {
    const c = judge(output({ executiveSummary: "가".repeat(347) }));
    expect(c.needsRewrite).toBe(true);
    const v = c.violations.find((x) => x.field === "executiveSummary");
    expect(v).toEqual({ field: "executiveSummary", limit: 80, actual: 347 });
  });

  it("허용 배수 경계 — 딱 배수만큼은 통과, 1자라도 넘으면 재작성", () => {
    const limit = CREW_LIMITS.executiveSummary;
    const exact = limit * CREW_OVERAGE_TOLERANCE;
    expect(
      judge(output({ executiveSummary: "가".repeat(exact) })).needsRewrite
    ).toBe(false);
    expect(
      judge(output({ executiveSummary: "가".repeat(exact + 1) })).needsRewrite
    ).toBe(true);
  });

  it("mondayActionOne 세 필드를 각각 본다", () => {
    const c = judge(
      output({
        mondayActionOne: {
          title: "가".repeat(over(CREW_LIMITS.mondayTitle)),
          whyThisOne: "나".repeat(234), // 실측 최장
          expectedOutcome: "다".repeat(190), // 실측 최장
        },
      })
    );
    const fields = c.violations.map((v) => v.field);
    expect(fields).toContain("mondayActionOne.title");
    expect(fields).toContain("mondayActionOne.whyThisOne");
    expect(fields).toContain("mondayActionOne.expectedOutcome");
  });

  it("액션의 title·steps 를 인덱스와 함께 잡는다", () => {
    const c = judge(
      output({
        topActions: [
          action(),
          action({
            title: "가".repeat(over(CREW_LIMITS.actionTitle)),
            // ⚠️ 실측 최장 rationale(298자)은 **잡히지 않는 게 맞다**
            //   — 200자 × 2.5 = 500 이하. 이 줄이 그 사실을 고정한다.
            rationale: "나".repeat(298),
            steps: ["짧음", "다".repeat(over(CREW_LIMITS.actionStep))],
          }),
        ],
      })
    );
    const fields = c.violations.map((v) => v.field);
    expect(fields).toContain("액션 2 title");
    expect(fields).toContain("액션 2 steps[2]");
    expect(fields).not.toContain("액션 2 rationale"); // 경계 아래
    // 정상인 1번 액션은 잡히지 않는다.
    expect(fields.some((f) => f.startsWith("액션 1"))).toBe(false);
  });

  it("rationale 도 경계를 넘으면 잡는다", () => {
    const c = judge(
      output({
        topActions: [
          action({ rationale: "나".repeat(over(CREW_LIMITS.actionRationale)) }),
        ],
      })
    );
    expect(c.violations.map((v) => v.field)).toContain("액션 1 rationale");
  });

  it("output 이 null 이면(에이전트 실패) 아무 일도 하지 않는다", () => {
    const c = critiqueStrategist(null);
    expect(c.needsRewrite).toBe(false);
  });

  it("재작성 지시문에 필드·실제 길이·목표 길이가 모두 들어간다", () => {
    const c = judge(output({ executiveSummary: "가".repeat(347) }));
    expect(c.instruction).toContain("executiveSummary");
    expect(c.instruction).toContain("347자");
    expect(c.instruction).toContain("80자");
    // 압축이지 재분석이 아님을 명시해야 한다(숫자 보존).
    expect(c.instruction).toContain("바꾸지 말 것");
  });

  it("topActions 가 비어도 깨지지 않는다", () => {
    expect(() => judge(output({ topActions: [] }))).not.toThrow();
  });
});
