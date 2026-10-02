import { describe, expect, it } from "vitest";
import {
  buildUnattributedEvidenceRow,
  completionMentionRate,
} from "./evidence-series";

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n));

describe("admin evidence measurement units", () => {
  it("converts a stored 0–100 completion snapshot into a 0–1 rate", () => {
    expect(completionMentionRate(50)).toBe(0.5);
    expect(completionMentionRate(1)).toBe(0.01);
    expect(completionMentionRate(0)).toBe(0);
    expect(completionMentionRate(101)).toBeNull();
  });

  it("does not publish a delta without matched run and cohort provenance", () => {
    const row = buildUnattributedEvidenceRow({
      completedAt: day(0),
      kind: "prompt_gap",
      target: "x",
      recognitionAtCompletion: null,
      sovAtCompletion: 40,
    });
    expect(row.beforeSov).toBe(0.4);
    expect(row.afterSov).toBeNull();
    expect(row.deltaSov).toBeNull();
    expect(row.caveats.join()).toContain("비교 가능성");
  });
});
