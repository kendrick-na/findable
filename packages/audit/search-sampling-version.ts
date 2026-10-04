/**
 * Naver search sampling version guard (W1 policy, 2026-10-05).
 *
 * Policy (user-approved): runs measured with the new Naver search sample
 * (`interleave-v1`) carry a version label and are never compared with runs
 * measured by another sampling method. Rows without a version marker, and
 * runs where no Naver search row exists, count as their own version
 * ("legacy" / "none") — never as "same as the new one".
 *
 * Every cross-run comparison that can contain a Naver search exposure value
 * (GEO score deltas, previous-run deltas, dashboard SoV deltas and trend
 * lines, content before/after scores) must go through
 * `compareAcrossSearchSampling` or `sameSearchSamplingSeries`. A blocked
 * comparison returns `delta: null` plus a reason; callers render
 * "비교 불가(측정 방식 변경)" instead of a number or 0.
 */

/** Naver rows without a sampling marker (pre-W1 blog-first sample or synthesis). */
export const LEGACY_SEARCH_SAMPLING_VERSION = "legacy";
/** A run with no Naver row at all. It has no search sample to compare. */
export const NO_SEARCH_SAMPLING_VERSION = "none";
/** A single run whose Naver rows disagree. Never comparable, even to itself. */
export const MIXED_SEARCH_SAMPLING_VERSION = "mixed";

export const SEARCH_SAMPLING_CHANGED = "search_sampling_changed" as const;
export type SearchSamplingBlockReason = typeof SEARCH_SAMPLING_CHANGED;

interface NaverRowLike {
  engineId?: unknown;
  naverSamplingVersion?: unknown;
  naverSource?: unknown;
}

/**
 * The search sampling version of one stored audit result.
 * Missing `engineResponses` (very old results) is treated as legacy.
 */
export function searchSamplingVersionOf(result: unknown): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return LEGACY_SEARCH_SAMPLING_VERSION;
  }
  const rows = (result as { engineResponses?: unknown }).engineResponses;
  if (!Array.isArray(rows)) {
    return LEGACY_SEARCH_SAMPLING_VERSION;
  }
  const versions = new Set<string>();
  for (const row of rows as NaverRowLike[]) {
    if (!row || typeof row !== "object" || row.engineId !== "naver") {
      continue;
    }
    const version =
      row.naverSource === "search_results" &&
      typeof row.naverSamplingVersion === "string" &&
      row.naverSamplingVersion.length > 0
        ? row.naverSamplingVersion
        : LEGACY_SEARCH_SAMPLING_VERSION;
    versions.add(version);
  }
  if (versions.size === 0) {
    return NO_SEARCH_SAMPLING_VERSION;
  }
  if (versions.size > 1) {
    return MIXED_SEARCH_SAMPLING_VERSION;
  }
  return [...versions][0] ?? LEGACY_SEARCH_SAMPLING_VERSION;
}

/** Normalizes an optional version (undefined/null/empty → legacy). */
export function normalizeSearchSamplingVersion(
  version: string | null | undefined
): string {
  return typeof version === "string" && version.length > 0
    ? version
    : LEGACY_SEARCH_SAMPLING_VERSION;
}

/** True only when both runs used exactly the same known sampling method. */
export function isSearchSamplingComparable(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = normalizeSearchSamplingVersion(a);
  const right = normalizeSearchSamplingVersion(b);
  return left === right && left !== MIXED_SEARCH_SAMPLING_VERSION;
}

export type SearchSamplingComparison =
  | { blockedReason: null; comparable: true; delta: number | null }
  | {
      blockedReason: SearchSamplingBlockReason;
      comparable: false;
      delta: null;
    };

/**
 * THE shared guard for a before/after value that may include Naver search
 * exposure. Same version → arithmetic delta (null if a side is missing).
 * Different/legacy/mixed version → blocked, `delta: null`.
 */
export function compareAcrossSearchSampling(
  before: { value: number | null; version: string | null | undefined },
  after: { value: number | null; version: string | null | undefined }
): SearchSamplingComparison {
  if (!isSearchSamplingComparable(before.version, after.version)) {
    return {
      blockedReason: SEARCH_SAMPLING_CHANGED,
      comparable: false,
      delta: null,
    };
  }
  return {
    blockedReason: null,
    comparable: true,
    delta:
      before.value === null || after.value === null
        ? null
        : after.value - before.value,
  };
}

/**
 * Keeps only the points measured with the anchor run's sampling version, so a
 * trend line never connects two sampling methods. Returns how many points
 * were dropped so the screen can say so instead of silently shortening.
 */
export function sameSearchSamplingSeries<T>(
  points: readonly T[],
  versionOf: (point: T) => string | null | undefined,
  anchorVersion: string | null | undefined
): { excludedCount: number; points: T[] } {
  const kept = points.filter((point) =>
    isSearchSamplingComparable(versionOf(point), anchorVersion)
  );
  return { excludedCount: points.length - kept.length, points: kept };
}

/** Copy for a blocked comparison. Never a number, never 0. */
export function searchSamplingBlockedCopy(isKo: boolean): string {
  return isKo
    ? "비교 불가(측정 방식 변경)"
    : "Not comparable (measurement method changed)";
}

const VERSION_LABELS: Record<string, { en: string; ko: string }> = {
  "interleave-v1": {
    ko: "검색 표본 v2 · 블로그·뉴스·웹문서 교차",
    en: "Search sample v2 · blog/news/web interleaved",
  },
  [LEGACY_SEARCH_SAMPLING_VERSION]: {
    ko: "검색 표본 v1 · 이전 방식",
    en: "Search sample v1 · previous method",
  },
  [MIXED_SEARCH_SAMPLING_VERSION]: {
    ko: "검색 표본 혼재 · 비교 제외",
    en: "Mixed search samples · excluded from comparison",
  },
};

/**
 * Small honest label for where a Naver search exposure value is shown.
 * Returns null when the run has no Naver search row (nothing to label).
 * The start date of v2 is intentionally omitted until the deploy date is
 * recorded — it is not guessed.
 */
export function searchSamplingLabel(
  version: string | null | undefined,
  isKo: boolean
): string | null {
  const normalized = normalizeSearchSamplingVersion(version);
  if (normalized === NO_SEARCH_SAMPLING_VERSION) {
    return null;
  }
  const label = VERSION_LABELS[normalized];
  if (label) {
    return isKo ? label.ko : label.en;
  }
  return isKo ? `검색 표본 ${normalized}` : `Search sample ${normalized}`;
}
