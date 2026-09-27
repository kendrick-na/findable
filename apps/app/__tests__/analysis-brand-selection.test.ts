import { describe, expect, it } from "vitest";
import { selectAnalysisBrandId } from "../app/(authenticated)/lib/analysis-brand-selection";

describe("analysis brand context", () => {
  const brands = ["indigo", "findable"];

  it("uses the explicitly selected dashboard brand", () => {
    expect(selectAnalysisBrandId(brands, "indigo", "findable")).toBe("indigo");
  });

  it("falls back only to an organization-owned brand", () => {
    expect(selectAnalysisBrandId(brands, "another-org", "findable")).toBe(
      "indigo"
    );
  });

  it("labels the most recent brand when no selection was made", () => {
    expect(selectAnalysisBrandId(brands, undefined, "findable")).toBe(
      "findable"
    );
  });

  it("does not invent an analysis brand for a new organization", () => {
    expect(selectAnalysisBrandId([], undefined, null)).toBeNull();
  });
});
