import { describe, expect, it } from "vitest";

import {
  isStabilityFlagOn,
  STABILITY_FLAGS,
  stabilityLimits,
} from "./stability-flags";

describe("안정성 플래그 — 전부 기본 꺼짐", () => {
  it("환경값이 없으면 모든 플래그가 꺼져 있다(꺼짐 = 지금과 같은 동작)", () => {
    for (const flag of STABILITY_FLAGS) {
      expect(isStabilityFlagOn(flag, {})).toBe(false);
    }
  });
  it("1·true 만 켠다(대소문자·공백 허용), 그 밖의 값은 꺼짐", () => {
    const flag = STABILITY_FLAGS[0];
    expect(isStabilityFlagOn(flag, { [flag]: "1" })).toBe(true);
    expect(isStabilityFlagOn(flag, { [flag]: " TRUE " })).toBe(true);
    expect(isStabilityFlagOn(flag, { [flag]: "yes" })).toBe(false);
    expect(isStabilityFlagOn(flag, { [flag]: "0" })).toBe(false);
  });
});

describe("stabilityLimits — 숫자는 환경값, 기본값은 임시", () => {
  it("환경값이 없으면 임시 기본값", () => {
    const limits = stabilityLimits({});
    expect(limits).toMatchObject({
      cellMaxRetries: 2,
      globalConcurrency: 8,
      orgConcurrency: 2,
      orgDailyCap: { growth: 10, scale: 20, starter: 3 },
      retryDelaysMs: [2000, 8000],
    });
  });
  it("환경값이 있으면 그 값, 잘못된 값은 기본값으로", () => {
    expect(
      stabilityLimits({
        STABILITY_GLOBAL_CONCURRENCY: "12",
        STABILITY_ORG_DAILY_CAP_STARTER: "5",
        STABILITY_RETRY_DELAYS_MS: "1000, 3000,9000",
      })
    ).toMatchObject({
      globalConcurrency: 12,
      orgDailyCap: { starter: 5 },
      retryDelaysMs: [1000, 3000, 9000],
    });
    expect(
      stabilityLimits({
        STABILITY_GLOBAL_CONCURRENCY: "abc",
        STABILITY_RETRY_DELAYS_MS: "x,y",
      })
    ).toMatchObject({ globalConcurrency: 8, retryDelaysMs: [2000, 8000] });
  });
});
