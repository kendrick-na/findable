import { describe, expect, it } from "vitest";
import { buildAuditHistory } from "./history";
import {
  compareAcrossSearchSampling,
  isSearchSamplingComparable,
  LEGACY_SEARCH_SAMPLING_VERSION,
  MIXED_SEARCH_SAMPLING_VERSION,
  NO_SEARCH_SAMPLING_VERSION,
  SEARCH_SAMPLING_CHANGED,
  sameSearchSamplingSeries,
  searchSamplingBlockedCopy,
  searchSamplingLabel,
  searchSamplingVersionOf,
} from "./search-sampling-version";

const V1 = "interleave-v1";

function naverRow(extra: Record<string, unknown> = {}) {
  return { engineId: "naver", naverSource: "search_results", ...extra };
}

describe("searchSamplingVersionOf", () => {
  it("reads the version stamped on new Naver search rows", () => {
    expect(
      searchSamplingVersionOf({
        engineResponses: [
          { engineId: "chatgpt" },
          naverRow({ naverSamplingVersion: V1 }),
          naverRow({ naverSamplingVersion: V1, errorMessage: "429" }),
        ],
      })
    ).toBe(V1);
  });

  it("treats unmarked Naver rows and legacy synthesis rows as legacy", () => {
    expect(searchSamplingVersionOf({ engineResponses: [naverRow()] })).toBe(
      LEGACY_SEARCH_SAMPLING_VERSION
    );
    expect(
      searchSamplingVersionOf({
        engineResponses: [{ engineId: "naver", naverSamplingVersion: V1 }],
      })
    ).toBe(LEGACY_SEARCH_SAMPLING_VERSION);
    expect(searchSamplingVersionOf({ metrics: {} })).toBe(
      LEGACY_SEARCH_SAMPLING_VERSION
    );
    expect(searchSamplingVersionOf(null)).toBe(LEGACY_SEARCH_SAMPLING_VERSION);
  });

  it("distinguishes a run without Naver rows and a run with mixed rows", () => {
    expect(
      searchSamplingVersionOf({ engineResponses: [{ engineId: "claude" }] })
    ).toBe(NO_SEARCH_SAMPLING_VERSION);
    expect(
      searchSamplingVersionOf({
        engineResponses: [naverRow({ naverSamplingVersion: V1 }), naverRow()],
      })
    ).toBe(MIXED_SEARCH_SAMPLING_VERSION);
  });
});

describe("compareAcrossSearchSampling (shared guard)", () => {
  it("same version → arithmetic delta", () => {
    expect(
      compareAcrossSearchSampling(
        { value: 40, version: V1 },
        { value: 55, version: V1 }
      )
    ).toEqual({ blockedReason: null, comparable: true, delta: 15 });
    expect(
      compareAcrossSearchSampling(
        { value: 40, version: "legacy" },
        { value: 40, version: undefined }
      )
    ).toEqual({ blockedReason: null, comparable: true, delta: 0 });
  });

  it("same version but a missing side → null delta, not 0", () => {
    expect(
      compareAcrossSearchSampling(
        { value: null, version: V1 },
        { value: 55, version: V1 }
      ).delta
    ).toBeNull();
  });

  it("different or legacy version → blocked with null delta, never a number", () => {
    for (const [before, after] of [
      ["legacy", V1],
      [undefined, V1],
      [null, V1],
      [V1, NO_SEARCH_SAMPLING_VERSION],
      [MIXED_SEARCH_SAMPLING_VERSION, MIXED_SEARCH_SAMPLING_VERSION],
    ] as const) {
      expect(
        compareAcrossSearchSampling(
          { value: 50, version: before },
          { value: 50, version: after }
        )
      ).toEqual({
        blockedReason: SEARCH_SAMPLING_CHANGED,
        comparable: false,
        delta: null,
      });
    }
    expect(isSearchSamplingComparable("legacy", V1)).toBe(false);
  });

  it("filters a trend series to the anchor version and counts the rest", () => {
    const series = sameSearchSamplingSeries(
      [
        { t: 1, v: "legacy" },
        { t: 2, v: "legacy" },
        { t: 3, v: V1 },
        { t: 4, v: V1 },
      ],
      (point) => point.v,
      V1
    );
    expect(series.points.map((point) => point.t)).toEqual([3, 4]);
    expect(series.excludedCount).toBe(2);
  });

  it("has honest copy and labels", () => {
    expect(searchSamplingBlockedCopy(true)).toBe("비교 불가(측정 방식 변경)");
    expect(searchSamplingLabel(V1, true)).toContain("검색 표본 v2");
    expect(searchSamplingLabel(undefined, true)).toContain("검색 표본 v1");
    expect(searchSamplingLabel(NO_SEARCH_SAMPLING_VERSION, true)).toBeNull();
  });
});

describe("buildAuditHistory uses the guard", () => {
  const candidate = (
    id: string,
    day: number,
    score: number,
    searchSamplingVersion?: string
  ) => ({
    createdAt: new Date(Date.UTC(2026, 9, day)),
    domain: "example.com",
    id,
    score,
    searchSamplingVersion,
    usable: true,
  });

  it("returns the delta for two runs with the same sampling version", () => {
    const history = buildAuditHistory(
      [candidate("a", 1, 40, V1), candidate("b", 2, 52, V1)],
      "b",
      "example.com"
    );
    expect(history.deltaPoints).toBe(12);
    expect(history.previousScore).toBe(40);
    expect(history.comparisonBlockedReason).toBeNull();
  });

  it("blocks legacy → interleave-v1 and hides the previous score", () => {
    const history = buildAuditHistory(
      [candidate("a", 1, 40), candidate("b", 2, 52, V1)],
      "b",
      "example.com"
    );
    expect(history.deltaPoints).toBeNull();
    expect(history.previousScore).toBeNull();
    expect(history.comparisonBlockedReason).toBe(SEARCH_SAMPLING_CHANGED);
    expect(history.previousSearchSamplingVersion).toBe("legacy");
    expect(history.currentSearchSamplingVersion).toBe(V1);
    // The link to the earlier result stays available; only the number goes.
    expect(history.previousJobId).toBe("a");
  });
});

describe("default question set v2 comparison key (2026-10-12)", () => {
  const withSet = (set?: string) => ({
    engineResponses: [],
    measurementContext: set ? { defaultQuestionSet: set } : {},
  });

  it("adds +q:default-v2 only for runs that carry the marker", () => {
    expect(searchSamplingVersionOf(withSet("default-v2"))).toBe(
      "none+q:default-v2"
    );
    // 기존 회차 문자열은 그대로다.
    expect(searchSamplingVersionOf(withSet())).toBe("none");
  });

  it("blocks comparison between an old default-question run and a v2 run", () => {
    expect(
      isSearchSamplingComparable(
        searchSamplingVersionOf(withSet()),
        searchSamplingVersionOf(withSet("default-v2"))
      )
    ).toBe(false);
    expect(
      isSearchSamplingComparable(
        searchSamplingVersionOf(withSet("default-v2")),
        searchSamplingVersionOf(withSet("default-v2"))
      )
    ).toBe(true);
  });

  it("keeps the api suffix last", () => {
    const result = {
      engineResponses: [{ engineId: "chatgpt", engineSet: "api-search-v1" }],
      measurementContext: { defaultQuestionSet: "default-v2" },
    };
    expect(searchSamplingVersionOf(result).endsWith("+api:search-v1")).toBe(
      true
    );
    expect(searchSamplingVersionOf(result)).toContain("+q:default-v2+api");
  });
});

describe("saved question set fingerprint (2026-10-13)", () => {
  const withKey = (key?: string) => ({
    engineResponses: [],
    measurementContext: key ? { questionSetKey: key } : {},
  });
  const v = (key?: string) => searchSamplingVersionOf(withKey(key));

  it("adds +qs:<key> only when the run recorded one", () => {
    expect(v("ab12cd34")).toBe("none+qs:ab12cd34");
    expect(v()).toBe("none");
  });

  it("two keyed runs are comparable only when the approved set is the same", () => {
    expect(isSearchSamplingComparable(v("aaaaaaaa"), v("aaaaaaaa"))).toBe(true);
    expect(isSearchSamplingComparable(v("aaaaaaaa"), v("bbbbbbbb"))).toBe(
      false
    );
  });

  it("one-time tolerance: a run from before the fingerprint existed still compares", () => {
    expect(isSearchSamplingComparable(v(), v("aaaaaaaa"))).toBe(true);
    // 하지만 다른 방식 차이(예: 기본 질문 세트)는 여전히 막는다.
    const old = searchSamplingVersionOf({
      engineResponses: [],
      measurementContext: {},
    });
    const v2 = searchSamplingVersionOf({
      engineResponses: [],
      measurementContext: {
        defaultQuestionSet: "default-v2",
        questionSetKey: "aaaaaaaa",
      },
    });
    expect(isSearchSamplingComparable(old, v2)).toBe(false);
  });

  it("the qs part sits before the api suffix, which stays last", () => {
    const key = searchSamplingVersionOf({
      engineResponses: [{ engineId: "chatgpt", engineSet: "api-search-v1" }],
      measurementContext: { questionSetKey: "aaaaaaaa" },
    });
    expect(key).toContain("+qs:aaaaaaaa+api:search-v1");
  });
});

describe("market and question language in the key (2026-10-14)", () => {
  const run = (market?: string, langs: string[] = []) =>
    searchSamplingVersionOf({
      engineResponses: langs.map((promptLang) => ({
        engineId: "chatgpt",
        promptLang,
      })),
      ...(market ? { marketScope: market } : {}),
    });

  it("adds +m:<market> and +l:<languages>; a result without them keeps its old key", () => {
    expect(run("korea", ["ko", "ko"])).toBe("none+m:korea+l:ko");
    expect(run("both", ["en", "ko"])).toBe("none+m:both+l:en-ko");
    expect(run()).toBe("none");
    // 이상한 값은 무시한다.
    expect(run("mars", ["fr"])).toBe("none");
  });

  it("a different market is not comparable; the same market is", () => {
    expect(
      isSearchSamplingComparable(run("korea", ["ko"]), run("global", ["ko"]))
    ).toBe(false);
    expect(
      isSearchSamplingComparable(run("korea", ["ko"]), run("korea", ["ko"]))
    ).toBe(true);
  });

  it("a different question language is not comparable (different engines are asked)", () => {
    expect(
      isSearchSamplingComparable(run("both", ["ko"]), run("both", ["ko", "en"]))
    ).toBe(false);
  });

  it("one-time tolerance: a result with no language record compares with one that has it", () => {
    expect(isSearchSamplingComparable(run("korea"), run("korea", ["ko"]))).toBe(
      true
    );
    // 시장이 다르면 관용하지 않는다.
    expect(
      isSearchSamplingComparable(run("korea"), run("global", ["ko"]))
    ).toBe(false);
  });

  it("the market/language parts sit before the api suffix, which stays last", () => {
    const key = searchSamplingVersionOf({
      engineResponses: [
        { engineId: "chatgpt", engineSet: "api-search-v1", promptLang: "ko" },
      ],
      marketScope: "korea",
    });
    expect(key.endsWith("+api:search-v1")).toBe(true);
    expect(key).toContain("+m:korea+l:ko+api");
  });
});
