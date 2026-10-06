import { describe, expect, it } from "vitest";
import {
  chatgptEngineSetOf,
  compareAcrossSearchSampling,
  MIXED_SEARCH_SAMPLING_VERSION,
  SEARCH_SAMPLING_CHANGED,
  sameSearchSamplingSeries,
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

const apiRun = { engineResponses: [{ engineId: "chatgpt" }, naver] };
const webRun = {
  engineResponses: [{ engineId: "chatgpt", chatgptEngineSet: WEB }, naver],
};

describe("ChatGPT source switch guard (CHATGPT_SOURCE=web)", () => {
  it("leaves every API-collected run's version string exactly as before", () => {
    expect(searchSamplingVersionOf(apiRun)).toBe(V1);
    expect(chatgptEngineSetOf(apiRun)).toBeNull();
  });

  it("composes the search version with the ChatGPT engine set for web runs", () => {
    expect(searchSamplingVersionOf(webRun)).toBe(`${V1}+${WEB}`);
    // The marker may also live only on usage (e.g. rows stored by older readers).
    expect(
      searchSamplingVersionOf({
        engineResponses: [
          { engineId: "chatgpt", usage: { chatgptEngineSet: WEB } },
          naver,
        ],
      })
    ).toBe(`${V1}+${WEB}`);
  });

  it("blocks API → web deltas and trend lines (never a number, never 0)", () => {
    const blocked = compareAcrossSearchSampling(
      { value: 40, version: searchSamplingVersionOf(apiRun) },
      { value: 55, version: searchSamplingVersionOf(webRun) }
    );
    expect(blocked).toEqual({
      blockedReason: SEARCH_SAMPLING_CHANGED,
      comparable: false,
      delta: null,
    });
    const series = sameSearchSamplingSeries(
      [apiRun, webRun, webRun],
      searchSamplingVersionOf,
      searchSamplingVersionOf(webRun)
    );
    expect(series).toEqual({ excludedCount: 1, points: [webRun, webRun] });
  });

  it("keeps two web runs comparable", () => {
    expect(
      compareAcrossSearchSampling(
        { value: 40, version: searchSamplingVersionOf(webRun) },
        { value: 55, version: searchSamplingVersionOf(webRun) }
      ).delta
    ).toBe(15);
  });

  it("treats a run whose chatgpt rows disagree as mixed (never comparable)", () => {
    const mixed = {
      engineResponses: [
        { engineId: "chatgpt", chatgptEngineSet: WEB },
        { engineId: "chatgpt" },
        naver,
      ],
    };
    expect(searchSamplingVersionOf(mixed)).toBe(MIXED_SEARCH_SAMPLING_VERSION);
  });

  it("labels the web method next to the search label", () => {
    expect(searchSamplingLabel(`${V1}+${WEB}`, true)).toBe(
      "검색 표본 v2 · 블로그·뉴스·웹문서 교차 · ChatGPT 웹 화면 수집"
    );
    expect(searchSamplingLabel(V1, true)).toBe(
      "검색 표본 v2 · 블로그·뉴스·웹문서 교차"
    );
    // No Naver row → still no search label, as before.
    expect(searchSamplingLabel(`none+${WEB}`, true)).toBeNull();
  });
});
