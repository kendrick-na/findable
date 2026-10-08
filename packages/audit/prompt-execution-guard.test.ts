import { describe, expect, it } from "vitest";
import {
  assertPromptExecutionStarted,
  countMeasurementCoverage,
  isMeasurementFailure,
} from "./measurement-coverage";

describe("new audit prompt execution guard", () => {
  it("fails a zero-batch run before the empty legacy coverage rule can pass", () => {
    expect(isMeasurementFailure(countMeasurementCoverage([]))).toBe(false);
    expect(() => assertPromptExecutionStarted(0)).toThrow(
      "질문 측정을 시작하지 못했습니다"
    );
  });

  it("accepts started runs while retaining the all-engine-failed guard", () => {
    expect(() => assertPromptExecutionStarted(1)).not.toThrow();
    expect(
      isMeasurementFailure(
        countMeasurementCoverage([
          { engineId: "chatgpt", errorMessage: "ENGINE_TIMEOUT" },
        ])
      )
    ).toBe(true);
  });

  it("rejects invalid execution counts", () => {
    expect(() => assertPromptExecutionStarted(-1)).toThrow();
    expect(() => assertPromptExecutionStarted(Number.NaN)).toThrow();
    expect(() => assertPromptExecutionStarted(1.5)).toThrow();
  });
});
