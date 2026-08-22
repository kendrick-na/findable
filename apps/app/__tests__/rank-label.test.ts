/**
 * S7-3차 회귀 테스트 (2026-08-12).
 *
 * 🔴 **막는 사고**: 같은 결과 페이지가 순위를 **두 가지 방식**으로 말했다.
 *   · 상단 KPI      → `평균 12개 중 · 19개 응답 평균` (분모·표본 밝힘)
 *   · 네이버 격차 카드 → `평균 3.2위`                  (맨 숫자)
 *   **"3.2위"는 목록이 5개일 때와 50개일 때 뜻이 완전히 다르다.**
 *   한쪽은 분모를 밝히고 한쪽은 감추니 고객은 어느 쪽을 믿을지 모른다.
 *
 * 🔒 이 테스트가 고정하는 계약 2개:
 *   ① 분모를 **알면 반드시 밝힌다**(감추지 않는다)
 *   ② 분모를 **모르면 지어내지 않는다**(없는 근거를 만들어 붙이는 게 더 나쁘다)
 *
 * ⚠️ 이 저장소 규칙: `apps/web` 에는 테스트 러너가 없다 → 규칙을 고정할 로직은
 *   `packages/` 에 순수 함수로 두고 여기서 검증한다(`measurement-coverage` 와 같은 패턴).
 */
import { describe, expect, test } from "vitest";
import {
  detailedRankLabel,
  shortRankLabel,
} from "../../../packages/audit/rank-label";

describe("shortRankLabel — 카드 인라인 표기", () => {
  test("🔴 분모를 알면 반드시 밝힌다", () => {
    expect(shortRankLabel({ averagePosition: 3.2, listSize: 12 }, true)).toBe(
      "평균 3.2위 (12개 중)"
    );
  });

  test("🔴 분모를 모르면 지어내지 않는다 (숫자만 말한다)", () => {
    const label = shortRankLabel({ averagePosition: 3.2 }, true);
    expect(label).toBe("평균 3.2위");
    // "중"이라는 분모 표현이 **없어야** 한다 — 있으면 없는 근거를 만든 것이다.
    expect(label).not.toContain("개 중");
  });

  test("순위 자체가 없으면 null (0위 같은 가짜 값을 만들지 않는다)", () => {
    expect(shortRankLabel({ averagePosition: null }, true)).toBeNull();
    expect(
      shortRankLabel({ averagePosition: null, listSize: 12 }, true)
    ).toBeNull();
  });

  test("영문 표기도 같은 규칙", () => {
    expect(shortRankLabel({ averagePosition: 3.2, listSize: 12 }, false)).toBe(
      "avg #3.2 of ~12"
    );
    expect(shortRankLabel({ averagePosition: 3.2 }, false)).toBe("avg #3.2");
  });
});

describe("detailedRankLabel — KPI 보조 라벨", () => {
  test("분모와 표본을 함께 밝힌다", () => {
    expect(
      detailedRankLabel(
        { averagePosition: 4, listSize: 12, sampleCount: 19 },
        true
      )
    ).toBe("평균 12개 중 · 19개 응답 평균");
  });

  test("분모를 모르면 자리 설명으로 대체하고 분모를 지어내지 않는다", () => {
    const label = detailedRankLabel(
      { averagePosition: 4, sampleCount: 19 },
      true
    );
    expect(label).toBe("AI 답변 목록에서 우리 자리 · 19개 응답 평균");
    expect(label).not.toContain("개 중");
  });

  test("표본 수가 없으면 그 조각을 조용히 뺀다", () => {
    expect(detailedRankLabel({ averagePosition: 4, listSize: 12 }, true)).toBe(
      "평균 12개 중"
    );
  });

  test("🔴 두 표기가 **같은 분모**를 말한다 (화면 간 모순 방지)", () => {
    const input = { averagePosition: 3.2, listSize: 12, sampleCount: 19 };
    const short = shortRankLabel(input, true) ?? "";
    const detailed = detailedRankLabel(input, true);
    // 둘 다 "12" 를 분모로 말해야 한다. 한쪽만 말하던 게 이 결함의 본질이었다.
    expect(short).toContain("12");
    expect(detailed).toContain("12");
  });
});
