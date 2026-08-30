import { describe, expect, it } from "vitest";
import { buildMeasurementImpact } from "@repo/audit/revenue-impact";

describe("measurement impact consistency", () => {
  it("uses one size preset for the same appearance rate and engine coverage", () => {
    const impact = buildMeasurementImpact({
      appearanceRate: 61,
      coverage: { mentioned: 6, total: 7 },
    });

    expect(impact.sizeKey).toBe("mid");
    expect(impact.estimate.missedSessionsPerMonth).toBe(3120);
  });
});
