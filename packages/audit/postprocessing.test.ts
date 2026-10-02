import { describe, expect, it } from "vitest";
import { auditPostprocessingWarning } from "./postprocessing";

describe("separate audit completion semantics", () => {
  it("flags pending tracking even when the core result is completed", () => {
    expect(
      auditPostprocessingWarning({
        tracking: "pending",
        pdf: "pending",
        briefing: "skipped",
      })
    ).toContain("시계열");
  });

  it("recognizes settled optional work and old jobs", () => {
    expect(
      auditPostprocessingWarning({
        tracking: "completed",
        pdf: "skipped",
        briefing: "failed",
      })
    ).toContain("브리핑");
    expect(auditPostprocessingWarning(null)).toBeNull();
  });
});
