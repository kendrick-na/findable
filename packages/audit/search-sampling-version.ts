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
 *
 * ➕ ChatGPT collection source (2026-10-07). When ops sets `CHATGPT_SOURCE=web`,
 * chatgpt rows carry `chatgptEngineSet` (e.g. `chatgpt-web-v1`). The run's
 * version then becomes `<search version>+<engine set>` so a web-collected run
 * is never compared with an API-collected one through the same guard. Runs
 * without the marker (every run before the switch) keep their exact old
 * version string, so nothing already stored changes.
 *
 * ➕ Engine set + question plan (2026-10-07, question plan v2). A run that
 * records `measurementContext.engineSetKey` (e.g. `daily-noclaude-v1` — Claude
 * excluded — or `weekly-full-v1`) or a `measurementContext.questionPlanVersion`
 * other than 1 gets those appended (`+engines:<key>`, `+plan:<n>`), so a
 * Claude-less daily run is never compared with a run that asked Claude, and a
 * v2 question set never with the v1 set. Runs without either marker (every
 * run stored so far) keep their exact old version string.
 *
 * ➕ Consumer-aligned main engine set (2026-10-10, `FINDABLE_ENGINE_SET=api-search-v1`).
 * When chatgpt/gemini/claude are measured through the api-search-v1 path
 * (web search / grounding ON), their rows carry `engineSet: "api-search-v1"`
 * (on the row or on `usage`) and the key gets the LAST suffix `+api:search-v1`,
 * so an old-method run and a new-method run are "not comparable (measurement
 * method changed)". A marker on ANY of the three engines' rows is enough — a
 * timed-out or failed row of the same run must not turn it into "legacy".
 * Runs without the marker keep their exact old version string.
 */

/** Naver rows without a sampling marker (pre-W1 blog-first sample or synthesis). */
export const LEGACY_SEARCH_SAMPLING_VERSION = "legacy";
/** A run with no Naver row at all. It has no search sample to compare. */
export const NO_SEARCH_SAMPLING_VERSION = "none";
/** A single run whose Naver rows disagree. Never comparable, even to itself. */
export const MIXED_SEARCH_SAMPLING_VERSION = "mixed";

export const SEARCH_SAMPLING_CHANGED = "search_sampling_changed" as const;
export type SearchSamplingBlockReason = typeof SEARCH_SAMPLING_CHANGED;

/** Joins the search version and the ChatGPT engine set into one comparison key. */
export const ENGINE_SET_SEPARATOR = "+";

interface NaverRowLike {
  chatgptEngineSet?: unknown;
  engineId?: unknown;
  naverSamplingVersion?: unknown;
  naverSource?: unknown;
  usage?: unknown;
}

/**
 * The search sampling version of one stored audit result.
 * Missing `engineResponses` (very old results) is treated as legacy.
 */
export function searchSamplingVersionOf(result: unknown): string {
  const base = naverSamplingVersionOf(result);
  const chatgpt = chatgptEngineSetOf(result);
  if (
    chatgpt === MIXED_SEARCH_SAMPLING_VERSION ||
    base === MIXED_SEARCH_SAMPLING_VERSION
  ) {
    return MIXED_SEARCH_SAMPLING_VERSION;
  }
  const parts = [base];
  if (chatgpt !== null) {
    parts.push(chatgpt);
  }
  const engineSet = engineSetKeyOf(result);
  if (engineSet !== null) {
    parts.push(`${ENGINE_SET_KEY_PREFIX}${engineSet}`);
  }
  const plan = questionPlanVersionOf(result);
  if (plan !== null && plan !== 1) {
    parts.push(`${QUESTION_PLAN_PREFIX}${plan}`);
  }
  if (hasApiSearchEngineSet(result)) {
    parts.push(API_SEARCH_KEY_SUFFIX);
  }
  return parts.join(ENGINE_SET_SEPARATOR);
}

/** Row marker written by the main api-search-v1 engine path (`usage.engineSet`). */
export const API_SEARCH_ENGINE_SET_MARKER = "api-search-v1";
/** Last suffix of the comparison key for api-search-v1 runs. */
export const API_SEARCH_KEY_SUFFIX = "api:search-v1";

const API_SEARCH_ENGINE_IDS = new Set(["chatgpt", "gemini", "claude"]);

/** True when any chatgpt/gemini/claude row of the run was measured via api-search-v1. */
export function hasApiSearchEngineSet(result: unknown): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }
  const rows = (result as { engineResponses?: unknown }).engineResponses;
  if (!Array.isArray(rows)) {
    return false;
  }
  return rows.some((row) => {
    if (!row || typeof row !== "object") {
      return false;
    }
    const r = row as NaverRowLike & { engineSet?: unknown };
    if (
      typeof r.engineId !== "string" ||
      !API_SEARCH_ENGINE_IDS.has(r.engineId)
    ) {
      return false;
    }
    const usage = r.usage as { engineSet?: unknown } | null | undefined;
    return (
      r.engineSet === API_SEARCH_ENGINE_SET_MARKER ||
      usage?.engineSet === API_SEARCH_ENGINE_SET_MARKER
    );
  });
}

/** Suffix markers inside the comparison key (never shown to the user). */
export const ENGINE_SET_KEY_PREFIX = "engines:";
export const QUESTION_PLAN_PREFIX = "plan:";

function measurementContextOf(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const context = (result as { measurementContext?: unknown })
    .measurementContext;
  return context && typeof context === "object" && !Array.isArray(context)
    ? (context as Record<string, unknown>)
    : null;
}

/**
 * The engine set a run was measured with (`daily-noclaude-v1`,
 * `weekly-full-v1`). null = not recorded (every run before question plan v2:
 * the full engine set of that time).
 */
export function engineSetKeyOf(result: unknown): string | null {
  const value = measurementContextOf(result)?.engineSetKey;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The question plan version a run's score was built on. null = v1 (not recorded). */
export function questionPlanVersionOf(result: unknown): number | null {
  const value = measurementContextOf(result)?.questionPlanVersion;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function rowChatgptEngineSet(row: NaverRowLike): string {
  if (typeof row.chatgptEngineSet === "string") {
    return row.chatgptEngineSet;
  }
  const usage = row.usage as { chatgptEngineSet?: unknown } | null | undefined;
  return usage && typeof usage.chatgptEngineSet === "string"
    ? usage.chatgptEngineSet
    : "";
}

/**
 * The ChatGPT engine set of one run: null = API (legacy — no marker on any
 * chatgpt row, or no chatgpt row), a set key, or "mixed" when rows disagree.
 */
export function chatgptEngineSetOf(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const rows = (result as { engineResponses?: unknown }).engineResponses;
  if (!Array.isArray(rows)) {
    return null;
  }
  const sets = new Set<string>();
  for (const row of rows as NaverRowLike[]) {
    if (row && typeof row === "object" && row.engineId === "chatgpt") {
      sets.add(rowChatgptEngineSet(row));
    }
  }
  if (sets.size > 1) {
    return MIXED_SEARCH_SAMPLING_VERSION;
  }
  const only = [...sets][0];
  return only ? only : null;
}

function naverSamplingVersionOf(result: unknown): string {
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
  // The ChatGPT engine-set suffix (`+chatgpt-web-v1`) stays in the version
  // string for the comparison guard, but is not shown to the user
  // (CEO decision 2026-10-07: not worth a visible label).
  const [normalized = ""] =
    normalizeSearchSamplingVersion(version).split(ENGINE_SET_SEPARATOR);
  if (normalized === NO_SEARCH_SAMPLING_VERSION) {
    return null;
  }
  const label = VERSION_LABELS[normalized];
  let base = isKo ? `검색 표본 ${normalized}` : `Search sample ${normalized}`;
  if (label) {
    base = isKo ? label.ko : label.en;
  }
  return base;
}

/**
 * "이전 → 이번" 표본 라벨 한 줄(비교 불가 배지 아래 보조 문구).
 * 두 라벨이 **같으면 null** — "검색 표본 v2 → 검색 표본 v2" 처럼 같은 말이
 * 반복되면 정보가 없다(엔진셋 꼬리표를 화면에서 뺀 뒤 생길 수 있음, 2026-10-07).
 * 새 문구는 만들지 않는다(문구 변경은 CEO 승인 사항). 한쪽만 있으면 그 하나만.
 */
export function searchSamplingChangeLabel(
  previousVersion: string | null | undefined,
  currentVersion: string | null | undefined,
  isKo: boolean
): string | null {
  const previous = searchSamplingLabel(previousVersion, isKo);
  const current = searchSamplingLabel(currentVersion, isKo);
  if (previous && current && previous === current) {
    return null;
  }
  const joined = [previous, current].filter(Boolean).join(" → ");
  return joined || null;
}
