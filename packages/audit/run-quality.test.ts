import { describe, expect, it } from "vitest";
import { isUsableRun, scoreOf } from "./run-quality";

const metrics = {
  averageMentionPosition: null,
  enginesCovered: ["perplexity", "gemini"],
  enginesWithMention: ["gemini"],
  sov: 50,
};

describe("run quality", () => {
  it("does not publish a score when entity verification is incomplete", () => {
    const result = { metrics: { ...metrics, unverifiedCount: 1 } };
    expect(isUsableRun(result)).toBe(false);
    expect(scoreOf(result)).toBeNull();
  });

  it("keeps fully verified measurements usable", () => {
    const result = { metrics: { ...metrics, unverifiedCount: 0 } };
    expect(isUsableRun(result)).toBe(true);
    expect(scoreOf(result)).toBeTypeOf("number");
  });
});
