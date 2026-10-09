import { describe, expect, it } from "vitest";
import {
  compareAcrossSearchSampling,
  hasApiSearchEngineSet,
  MIXED_SEARCH_SAMPLING_VERSION,
  SEARCH_SAMPLING_CHANGED,
  sameSearchSamplingSeries,
  searchSamplingChangeLabel,
  searchSamplingLabel,
  searchSamplingVersionOf,
} from "./search-sampling-version";

const V1 = "interleave-v1";
const WEB = "chatgpt-web-v1";
const naver = {
  engineId: "naver",
  naverSource: "search_results",
  naverSamplingVersion: V1,
};
const marked = (engineId: string) => ({
  engineId,
  usage: { engineSet: "api-search-v1" },
});

const oldRun = {
  engineResponses: [
    { engineId: "chatgpt" },
    { engineId: "gemini" },
    { engineId: "claude" },
    naver,
  ],
};
const newRun = {
  engineResponses: [
    marked("chatgpt"),
    marked("gemini"),
    marked("claude"),
    naver,
  ],
};

describe("api-search-v1 main engine set guard (FINDABLE_ENGINE_SET)", () => {
  it("leaves every old run's version string byte-identical (flag off)", () => {
    expect(searchSamplingVersionOf(oldRun)).toBe(V1);
    expect(searchSamplingVersionOf({ engineResponses: [naver] })).toBe(V1);
    expect(searchSamplingVersionOf({})).toBe("legacy");
    expect(hasApiSearchEngineSet(oldRun)).toBe(false);
  });

  it("appends +api:search-v1 as the LAST suffix (after engines: and plan:)", () => {
    expect(searchSamplingVersionOf(newRun)).toBe(`${V1}+api:search-v1`);
    expect(
      searchSamplingVersionOf({
        ...newRun,
        measurementContext: {
          engineSetKey: "weekly-full-v1",
          questionPlanVersion: 2,
        },
      })
    ).toBe(`${V1}+engines:weekly-full-v1+plan:2+api:search-v1`);
  });

  it("composes with the chatgpt web marker: search+chatgptSet+engines+plan+api", () => {
    const run = {
      engineResponses: [
        {
          engineId: "chatgpt",
          chatgptEngineSet: WEB,
          usage: { engineSet: "api-search-v1" },
        },
        naver,
      ],
      measurementContext: { engineSetKey: "daily-noclaude-v1" },
    };
    expect(searchSamplingVersionOf(run)).toBe(
      `${V1}+${WEB}+engines:daily-noclaude-v1+api:search-v1`
    );
  });

  it("reads the marker on the row itself too, and from any one of the three engines", () => {
    expect(
      searchSamplingVersionOf({
        engineResponses: [
          { engineId: "gemini", engineSet: "api-search-v1" },
          naver,
        ],
      })
    ).toBe(`${V1}+api:search-v1`);
    // a timed-out/failed row without usage next to a marked one does not turn the run "legacy"
    expect(
      searchSamplingVersionOf({
        engineResponses: [{ engineId: "chatgpt" }, marked("claude"), naver],
      })
    ).toBe(`${V1}+api:search-v1`);
  });

  it("ignores the marker on non-api-search engines", () => {
    expect(
      searchSamplingVersionOf({
        engineResponses: [marked("perplexity"), naver],
      })
    ).toBe(V1);
  });

  it("blocks old -> new deltas and trend lines (never a number, never 0)", () => {
    expect(
      compareAcrossSearchSampling(
        { value: 40, version: searchSamplingVersionOf(oldRun) },
        { value: 55, version: searchSamplingVersionOf(newRun) }
      )
    ).toEqual({
      blockedReason: SEARCH_SAMPLING_CHANGED,
      comparable: false,
      delta: null,
    });
    expect(
      sameSearchSamplingSeries(
        [oldRun, newRun, newRun],
        searchSamplingVersionOf,
        searchSamplingVersionOf(newRun)
      )
    ).toEqual({ excludedCount: 1, points: [newRun, newRun] });
  });

  it("keeps two api-search-v1 runs comparable", () => {
    expect(
      compareAcrossSearchSampling(
        { value: 40, version: searchSamplingVersionOf(newRun) },
        { value: 55, version: searchSamplingVersionOf(newRun) }
      ).delta
    ).toBe(15);
  });

  it("a chatgpt-disagreeing run is still mixed (not masked by the new suffix)", () => {
    expect(
      searchSamplingVersionOf({
        engineResponses: [
          { engineId: "chatgpt", chatgptEngineSet: WEB },
          { engineId: "chatgpt" },
          marked("claude"),
          naver,
        ],
      })
    ).toBe(MIXED_SEARCH_SAMPLING_VERSION);
  });

  it("does not show the new suffix in the visible search label", () => {
    expect(searchSamplingLabel(`${V1}+api:search-v1`, true)).toBe(
      "검색 표본 v2 · 블로그·뉴스·웹문서 교차"
    );
    expect(
      searchSamplingChangeLabel(V1, `${V1}+api:search-v1`, true)
    ).toBeNull();
  });
});
