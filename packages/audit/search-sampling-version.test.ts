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
