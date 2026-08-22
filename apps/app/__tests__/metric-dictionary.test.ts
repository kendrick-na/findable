/**
 * 지표 사전 회귀 테스트 (2026-08-16 세션N-34).
 *
 * 🔴 **문구를 하드코딩하지 않는다.** 이 저장소는 가드가 기대 문구를 박아두는 바람에
 *   **거짓말을 지키는 가드**를 두 번 만들었다(`empty-state.test.tsx` 가 `"측정 시작하기"` 를
 *   하드코딩해 꺼진 기능을 파는 문구를 붙잡고 있었다).
 *   → 여기서는 **계약**을 검사한다: 축이 존재하는가 · 방향이 맞는가 · 축이 뒤섞이지 않는가.
 *   라벨 문구가 바뀌는 것은 자유다. 바뀌면 안 되는 건 **의미 구조**다.
 *
 * @vitest-environment node
 */

import {
  axisCountLabel,
  axisRatioLabel,
  DENOMINATOR_AXES,
  type DenominatorAxis,
  directionHint,
  METRICS,
  type MetricKey,
} from "@repo/audit/metric-dictionary";
import { describe, expect, it } from "vitest";

const AXIS_KEYS = Object.keys(DENOMINATOR_AXES) as DenominatorAxis[];
const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

describe("분모 축 3종", () => {
  it("축은 정확히 3종이다 — 늘어나면 사전의 존재 이유가 무너진다", () => {
    // 축이 4개째가 되는 순간 "라벨 없이 섞인" 상태가 재발한다.
    // 진짜로 4번째 축이 필요하다면 이 테스트를 **의식적으로** 고치게 만드는 게 목적이다.
    expect(AXIS_KEYS.sort()).toEqual([
      "response",
      "successRow",
      "uniqueEngine",
    ]);
  });

  it("모든 축이 라벨·단위·평문 정의를 갖는다", () => {
    for (const key of AXIS_KEYS) {
      const meta = DENOMINATOR_AXES[key];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.unit.length).toBeGreaterThan(0);
      // 🔴 정의는 "항상 보이는 자리"에 쓸 문장이라 실제 설명이어야 한다.
      //   존재 검사만 하면 빈 문자열이나 한 글자가 통과한다(N-25·N-26 에 두 번 뚫렸다).
      expect(meta.description.length).toBeGreaterThan(10);
    }
  });

  it("축마다 라벨이 서로 다르다 — 같으면 구분이 안 된다", () => {
    const labels = AXIS_KEYS.map((k) => DENOMINATOR_AXES[k].label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("분모 표기", () => {
  it("수량에 축 단위를 붙인다", () => {
    // 엔진 축은 "곳", 응답 축은 "개" — 단위를 섞으면 축이 뒤섞인 것처럼 읽힌다.
    expect(axisCountLabel("uniqueEngine", 7)).toBe("AI 7곳");
    expect(axisCountLabel("response", 28)).toBe("응답 28개");
  });

  it("분모를 항상 함께 말한다", () => {
    const label = axisRatioLabel("uniqueEngine", 5, 7);
    // 🔴 핵심 계약: 부분만 말하고 전체를 감추면 안 된다(N-28 `7/6` 사고의 뿌리).
    expect(label).toContain("7");
    expect(label).toContain("5");
    expect(label).toBe("AI 7곳 중 5곳");
  });

  it("0 도 분모와 함께 말한다 — 숫자를 숨기지 않는다", () => {
    // 측정 실패 판정은 화면(isMeasurementFailure)이 하고, 사전은 표기만 정직하게 한다.
    expect(axisRatioLabel("uniqueEngine", 0, 7)).toBe("AI 7곳 중 0곳");
  });
});

describe("지표 메타", () => {
  it("모든 지표가 축을 선언한다 — 축 없는 지표가 사고의 원인이었다", () => {
    for (const key of METRIC_KEYS) {
      expect(AXIS_KEYS).toContain(METRICS[key].axis);
    }
  });

  it("모든 지표가 평문 정의를 갖는다", () => {
    for (const key of METRIC_KEYS) {
      expect(METRICS[key].description.length).toBeGreaterThan(10);
      expect(METRICS[key].question.length).toBeGreaterThan(0);
    }
  });

  it("🔴 순위는 낮을수록 좋다 — 방향이 뒤집히면 화면이 거짓말을 한다", () => {
    expect(METRICS.rank.direction).toBe("lower");
    expect(METRICS.rank.format).toBe("rank");
  });

  it("낮을수록 좋은 지표에만 방향 표식이 붙는다", () => {
    expect(directionHint("rank")).toBe("낮을수록 좋음");
    // 높을수록 좋은 건 기본 직관 → 표식을 달면 화면 소음만 는다.
    expect(directionHint("sov")).toBeNull();
    expect(directionHint("sentiment")).toBeNull();
  });

  it("🔴 등장(sov)과 인용(citation)은 서로 다른 지표다", () => {
    // 같은 페이지 안에서 용어가 충돌했던 지점. 정의가 서로를 구분해야 한다.
    expect(METRICS.sov.label).not.toBe(METRICS.citation.label);
    expect(METRICS.citation.description).toContain("등장");
  });

  it("🔴 인지(엔진 축)와 등장률(응답 축)은 축이 다르다", () => {
    // 이 둘을 같은 축으로 착각해 `96% vs 7곳` 모순이 났다(N-30).
    expect(METRICS.recognition.axis).not.toBe(METRICS.sov.axis);
    expect(METRICS.recognition.axis).toBe("uniqueEngine");
    expect(METRICS.sov.axis).toBe("response");
  });
});
