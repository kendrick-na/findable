import { describe, expect, it } from "vitest";

import { isTrackableResponse } from "./tracking-eligibility";

describe("tracking eligibility", () => {
  it("excludes unverified entity matches, errors, and stubs", () => {
    const base = {
      engineId: "perplexity",
      promptText: "브랜드 추천",
      errorMessage: null,
      isStub: false,
      mentionQuality: "confirmed",
    };
    const validEngines = new Set(["perplexity"]);
    expect(isTrackableResponse(base, validEngines)).toBe(true);
    expect(
      isTrackableResponse(
        { ...base, mentionQuality: "unverified" },
        validEngines
      )
    ).toBe(false);
    expect(
      isTrackableResponse({ ...base, errorMessage: "429" }, validEngines)
    ).toBe(false);
    expect(isTrackableResponse({ ...base, isStub: true }, validEngines)).toBe(
      false
    );
  });
});
