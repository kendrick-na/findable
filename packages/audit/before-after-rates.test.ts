/**
 * before/after — 오인율·정확 설명률(2026-09-28). SoV 경로는 기존 테스트
 * (`apps/app/__tests__/before-after.test.ts`)가 지킨다. 여기서는 새 두 지표만 본다.
 */
import { describe, expect, it } from "vitest";
import { buildBeforeAfterRow, type CompletionRecord } from "./before-after";

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n));
const completion: CompletionRecord = {
  completedAt: day(10),
  kind: "entity_clarity",
  recognitionAtCompletion: null,
  sovAtCompletion: 0.2,
  target: "",
};
const series = [
  {
    measuredAt: day(0),
    sov: 0.2,
    misidentificationRate: 8 / 22,
    accurateRate: 5 / 22,
  },
  {
    measuredAt: day(9),
    sov: 0.2,
    misidentificationRate: 6 / 22,
    accurateRate: 6 / 22,
  },
  {
    measuredAt: day(12),
    sov: 0.3,
    misidentificationRate: 2 / 22,
    accurateRate: 9 / 22,
  },
];

describe("오인율·정확 설명률 전후", () => {
  it("시작 시각이 없으면 완료 직전 측정이 before, 24시간 뒤 첫 측정이 after", () => {
    const row = buildBeforeAfterRow(completion, series);
    expect(row.misidentificationRate.before).toBeCloseTo(6 / 22);
    expect(row.misidentificationRate.after).toBeCloseTo(2 / 22);
    expect(row.misidentificationRate.delta).toBeCloseTo(-4 / 22);
    expect(row.accurateRate.delta).toBeCloseTo(3 / 22);
  });

  it("시작 시각이 있으면 그 이전 측정이 before (조치 도중 값 제외)", () => {
    const row = buildBeforeAfterRow(
      { ...completion, startedAt: day(5) },
      series
    );
    expect(row.misidentificationRate.before).toBeCloseTo(8 / 22);
    expect(row.misidentificationRate.delta).toBeCloseTo(-6 / 22);
  });

  it("스냅샷이 있고 시작 시각이 없으면 스냅샷이 before", () => {
    const row = buildBeforeAfterRow(
      { ...completion, misidentificationRateAtCompletion: 0.5 },
      series
    );
    expect(row.misidentificationRate.before).toBe(0.5);
  });

  it("구 측정(지표 없음)은 0 이 아니라 null", () => {
    const row = buildBeforeAfterRow(completion, [
      { measuredAt: day(9), sov: 0.2 },
      { measuredAt: day(12), sov: 0.3 },
    ]);
    expect(row.misidentificationRate).toEqual({
      after: null,
      before: null,
      delta: null,
    });
    expect(row.deltaSov).toBeCloseTo(0.1);
  });
});
