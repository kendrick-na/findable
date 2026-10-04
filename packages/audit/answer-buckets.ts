/**
 * 답변 4분류 — 「AI 가 우리를 어떻게 아는가」의 단일 진실 (2026-09-29).
 *
 * 🔴 왜 만들었나(공개 JSON 실측):
 *   노우버스(b7f319e1) 22개 답변 중 **8개가 같은 이름의 다른 회사**를 설명했는데
 *   (`mentionQuality: "different_entity"`), 화면은 그걸 「미언급」으로 보여줬다.
 *   「AI 가 우리를 모른다」와 「AI 가 우리를 딴 회사로 안다」는 처방이 정반대다.
 *   앞은 알려야 하고, 뒤는 **바로잡아야** 한다.
 *
 * 분류 (답변 1개당 하나):
 *   confirmed         제대로 앎      — 공식 사이트와 같은 회사로 설명
 *   different_entity  다른 회사로 앎  — 같은 이름의 다른 대상을 설명
 *   unknown           모름          — 모른다고 답했거나 아예 이름이 없음
 *   engine_error      측정 실패      — AI 서비스 오류(한도 초과·429·미연결)
 *   unverified        판정 보류      — 답은 받았지만 같은 회사인지 판정하지 못함
 *
 * 분모 규칙: 비율은 **판정이 끝난 답변(앞의 셋)** 으로만 낸다. 측정 실패·판정 보류는
 *   셀 수는 보여주되 분모에서 뺀다(못 잰 것을 「모름」으로 세지 않는다).
 *
 * 그룹 규칙:
 *   · Daum·네이버(검색 API)는 AI 답변이 아니라 **검색 결과**다 → 「검색 노출」 그룹.
 *     AI 답변 비율의 분모에 넣지 않는다. 네이버의 실제 AI 답은 브리핑뿐이다.
 *   · 네이버 AI 브리핑은 자기 질의(효과·후기…)를 쓰는 별도 축 → 여기서 세지 않는다.
 *   · 브랜드 이름 없이 물은 질문(discovery)은 「AI 가 우리를 아나」가 아니라
 *     「이름 없이도 추천하나」를 잰다 → 따로 센다(섞으면 「모름」이 부풀려진다).
 *
 * ⚠️ 이 파일이 유일한 계산처다. 공개 리포트·대시보드·API 가 모두 이 함수를 쓴다.
 */

export type AnswerBucket =
  | "confirmed"
  | "different_entity"
  | "unknown"
  | "engine_error"
  | "unverified";

export type AnswerGroup = "ai" | "search" | "briefing" | "retired";

export type PromptKind = "brand" | "discovery";

/**
 * AI 답변이 아니라 검색 결과를 주는 엔진.
 * naver 는 2026-09-29 부터 검색 결과 원문만 저장한다(HyperCLOVA 합성 폐지). 그 전 회차의
 * naver 행은 Findable 이 합성한 재현 답이라 **역시 네이버의 AI 답이 아니다** → 같은 그룹.
 */
export const SEARCH_EXPOSURE_ENGINES: ReadonlySet<string> = new Set([
  "naver",
  "daum",
]);
/** 자기 질의를 쓰는 별도 축 — 이 분류의 대상이 아니다. */
export const SEPARATE_CHANNEL_ENGINES: ReadonlySet<string> = new Set([
  "naver-briefing",
]);

/**
 * 서비스가 끝난 엔진 — 과거 회차에만 행이 있다. 헤드라인·4칸·엔진 기준·점수 분모에서
 * **전부 뺀다**(없어진 서비스의 답으로 지금의 인지도를 말하지 않는다). 원문 표에만 남는다.
 * hyperclova: 네이버 클로바X 서비스 종료(2026-04-09) · 👤 대표 결정 2026-09-29.
 */
export const RETIRED_ENGINES: ReadonlySet<string> = new Set(["hyperclova"]);

/** 저장된 `engineResponses[]` 와 러너의 `EngineResponse` 가 모두 만족하는 최소 형태. */
export interface BucketableAnswer {
  brandMentioned?: boolean | null;
  citedSources?: ReadonlyArray<{
    domain?: string | null;
    url?: string | null;
  }> | null;
  engineId: string;
  errorMessage?: string | null;
  isStub?: boolean | null;
  mentionQuality?: string | null;
  /** 러너가 네이버 행에 붙이는 수집 방식. "search_results" 가 아니면 과거 합성 답이다. */
  naverSource?: string | null;
  promptKind?: PromptKind | null;
}

export function answerGroup(engineId: string): AnswerGroup {
  if (RETIRED_ENGINES.has(engineId)) {
    return "retired";
  }
  if (SEPARATE_CHANNEL_ENGINES.has(engineId)) {
    return "briefing";
  }
  if (SEARCH_EXPOSURE_ENGINES.has(engineId)) {
    return "search";
  }
  return "ai";
}

export function isDiscoveryAnswer(row: {
  promptKind?: string | null;
}): boolean {
  return row.promptKind === "discovery";
}

/**
 * 과거(2026-09-29 이전) 네이버 행 = 검색 결과를 Findable 이 HyperCLOVA 로 **합성한 요약**이다.
 * 그 문장에 판정 배지(다른 회사로 앎 등)를 달면 「네이버가 그렇게 말했다」로 읽힌다.
 * → 합성 문장은 판정하지 않고, 함께 저장된 검색 결과 주소로 **공식 도메인 노출 여부**만 본다.
 */
export function isLegacyNaverSynthesis(row: BucketableAnswer): boolean {
  return row.engineId === "naver" && row.naverSource !== "search_results";
}

const WWW_RE = /^www\./;

function hostOf(source: {
  domain?: string | null;
  url?: string | null;
}): string {
  const raw = (source.domain || source.url || "").trim().toLowerCase();
  try {
    const host = raw.includes("://")
      ? new URL(raw).hostname
      : raw.split("/")[0];
    return (host ?? "").replace(WWW_RE, "");
  } catch {
    return "";
  }
}

/** 검색 결과 주소에 공식 도메인(또는 하위 도메인)이 있는가. */
export function officialDomainExposed(
  row: BucketableAnswer,
  brandDomain: string | null | undefined
): boolean {
  const owned = (brandDomain ?? "").trim().toLowerCase().replace(WWW_RE, "");
  if (!owned) {
    return false;
  }
  return (row.citedSources ?? []).some((source) => {
    const host = hostOf(source);
    return host === owned || host.endsWith(`.${owned}`);
  });
}

/** 과거 네이버 합성 행의 검색 노출 판정 — 공식 도메인이 검색 결과에 있었나. */
function legacyNaverBucket(
  row: BucketableAnswer,
  brandDomain: string | null | undefined
): AnswerBucket {
  if (row.errorMessage || row.isStub) {
    return "engine_error";
  }
  return officialDomainExposed(row, brandDomain) ? "confirmed" : "unknown";
}

/** 답변 1개의 분류. 순서가 곧 우선순위다(실패가 판정보다 먼저). */
export function classifyAnswer(row: BucketableAnswer): AnswerBucket {
  if (row.errorMessage || row.isStub) {
    return "engine_error";
  }
  if (row.mentionQuality === "unverified") {
    return "unverified";
  }
  if (row.mentionQuality === "different_entity") {
    return "different_entity";
  }
  if (
    row.brandMentioned === true &&
    (row.mentionQuality === "confirmed" || row.mentionQuality == null)
  ) {
    return "confirmed";
  }
  return "unknown";
}

/**
 * 답변별 점유율(sov) — **제대로 안 답변에만** 값이 있다.
 *
 * 🔴 실측: 추정기(`estimateShareOfVoice`)는 이름 문자열만 세서, 다른 회사를 설명한
 *   답변·모른다는 답변에도 `sov: 1` 이 찍혀 있었다(b7f319e1 chatgpt·naver).
 *   우리를 말하지 않은 답변에서 우리 몫은 0 이다. 측정 실패는 값이 없다(null).
 */
export function answerShareOfVoice(
  row: BucketableAnswer,
  estimated: number | null | undefined
): number | null {
  const bucket = classifyAnswer(row);
  if (bucket === "engine_error" || bucket === "unverified") {
    return null;
  }
  if (bucket !== "confirmed") {
    return 0;
  }
  return typeof estimated === "number" && Number.isFinite(estimated)
    ? estimated
    : null;
}

export interface BucketCounts {
  confirmed: number;
  differentEntity: number;
  engineError: number;
  unknown: number;
  unverified: number;
}

export interface BucketGroupSummary extends BucketCounts {
  /** 판정이 끝난 답변 수 = 비율의 분모(제대로 앎 + 다른 회사로 앎 + 모름). */
  adjudicated: number;
  /** 판정 끝난 답변 중 제대로 앎 비율(%) — 분모 0 이면 null. */
  confirmedRate: number | null;
  differentEntityRate: number | null;
  /** 시도한 답변 전체(실패·보류 포함). */
  total: number;
  unknownRate: number | null;
}

export interface AnswerBucketSummary {
  /** 브랜드 이름으로 물은 AI 답변(헤드라인). Daum·브리핑·이름 없는 질문 제외. */
  ai: BucketGroupSummary;
  /** 이름 없이 물은 질문 — 추천됐는가. 해당 질문이 없던 회차는 null. */
  discovery: {
    adjudicated: number;
    asked: number;
    engineError: number;
    recommended: number;
    /** 이름 없이 물었을 때 다른 회사를 추천하며 같은 이름을 쓴 경우. */
    differentEntity: number;
  } | null;
  /** 엔진 기준(브랜드 질문 · AI 그룹): 판정 가능한 답을 1번 이상 준 엔진 수와 그중 제대로 안 엔진 수. */
  engines: { confirmed: number; measured: number };
  /** Daum 등 검색 결과 조각 — AI 비율과 섞지 않는다. 해당 엔진이 없으면 null. */
  search: BucketGroupSummary | null;
  /** 검색 노출을 엔진별로(네이버·다음) — 두 검색은 다른 서비스라 합쳐 말하지 않는다. */
  searchByEngine: Record<string, BucketGroupSummary>;
  version: 1;
}

function emptyCounts(): BucketCounts {
  return {
    confirmed: 0,
    differentEntity: 0,
    unknown: 0,
    engineError: 0,
    unverified: 0,
  };
}

function add(counts: BucketCounts, bucket: AnswerBucket): void {
  if (bucket === "confirmed") {
    counts.confirmed += 1;
  } else if (bucket === "different_entity") {
    counts.differentEntity += 1;
  } else if (bucket === "unknown") {
    counts.unknown += 1;
  } else if (bucket === "engine_error") {
    counts.engineError += 1;
  } else {
    counts.unverified += 1;
  }
}

/** 비율(%) — 반올림. 분모 0 은 「0%」가 아니라 「없음(null)」. */
export function bucketRate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

function finalize(counts: BucketCounts): BucketGroupSummary {
  const adjudicated =
    counts.confirmed + counts.differentEntity + counts.unknown;
  return {
    ...counts,
    adjudicated,
    total: adjudicated + counts.engineError + counts.unverified,
    confirmedRate: bucketRate(counts.confirmed, adjudicated),
    differentEntityRate: bucketRate(counts.differentEntity, adjudicated),
    unknownRate: bucketRate(counts.unknown, adjudicated),
  };
}

interface DiscoveryTally {
  adjudicated: number;
  asked: number;
  differentEntity: number;
  engineError: number;
  recommended: number;
}

function addDiscovery(tally: DiscoveryTally, bucket: AnswerBucket): void {
  tally.asked += 1;
  if (bucket === "engine_error") {
    tally.engineError += 1;
    return;
  }
  if (bucket === "unverified") {
    return;
  }
  tally.adjudicated += 1;
  if (bucket === "confirmed") {
    tally.recommended += 1;
  } else if (bucket === "different_entity") {
    tally.differentEntity += 1;
  }
}

function addAiDiscovery(
  tally: DiscoveryTally,
  row: BucketableAnswer,
  group: AnswerGroup
): number {
  if (group !== "ai") {
    return 0;
  }
  addDiscovery(tally, classifyAnswer(row));
  return 1;
}

function isAdjudicated(bucket: AnswerBucket): boolean {
  return (
    bucket === "confirmed" ||
    bucket === "different_entity" ||
    bucket === "unknown"
  );
}

export function summarizeAnswerBuckets(
  rows: readonly BucketableAnswer[] | null | undefined,
  options: { brandDomain?: string | null } = {}
): AnswerBucketSummary {
  const ai = emptyCounts();
  const search = emptyCounts();
  let searchRows = 0;
  const searchEngines = new Map<string, BucketCounts>();
  const discovery: DiscoveryTally = {
    asked: 0,
    adjudicated: 0,
    recommended: 0,
    differentEntity: 0,
    engineError: 0,
  };
  let discoveryRows = 0;
  const measuredEngines = new Set<string>();
  const confirmedEngines = new Set<string>();

  for (const row of rows ?? []) {
    const group = answerGroup(row.engineId);
    if (group === "briefing" || group === "retired") {
      continue;
    }
    // Search results from an unbranded discovery prompt are neither brand-query
    // search exposure nor an AI recommendation. Keep both denominators clean.
    if (isDiscoveryAnswer(row)) {
      discoveryRows += addAiDiscovery(discovery, row, group);
      continue;
    }
    const bucket = isLegacyNaverSynthesis(row)
      ? legacyNaverBucket(row, options.brandDomain)
      : classifyAnswer(row);
    if (group === "search") {
      searchRows += 1;
      add(search, bucket);
      const perEngine = searchEngines.get(row.engineId) ?? emptyCounts();
      add(perEngine, bucket);
      searchEngines.set(row.engineId, perEngine);
      continue;
    }
    add(ai, bucket);
    if (isAdjudicated(bucket)) {
      measuredEngines.add(row.engineId);
    }
    if (bucket === "confirmed") {
      confirmedEngines.add(row.engineId);
    }
  }

  return {
    version: 1,
    ai: finalize(ai),
    engines: {
      measured: measuredEngines.size,
      confirmed: confirmedEngines.size,
    },
    search: searchRows > 0 ? finalize(search) : null,
    searchByEngine: Object.fromEntries(
      [...searchEngines.entries()].map(([id, counts]) => [id, finalize(counts)])
    ),
    discovery: discoveryRows > 0 ? discovery : null,
  };
}

// ──────────────────────────────────────────────────────────────────
// 화면 문구 — 라벨과 한 줄 설명. 공개 리포트·대시보드가 같은 말을 쓴다.
// ──────────────────────────────────────────────────────────────────

export interface BucketCopy {
  explain: string;
  label: string;
}

export const ANSWER_BUCKET_COPY_KO: Record<AnswerBucket, BucketCopy> = {
  confirmed: {
    label: "제대로 앎",
    explain: "공식 사이트와 같은 회사로 설명한 답변이에요.",
  },
  different_entity: {
    label: "다른 회사로 앎",
    explain: "이름은 같지만 다른 회사·대상을 설명한 답변이에요.",
  },
  unknown: {
    label: "모름",
    explain: "모른다고 답했거나 답변에 이름이 아예 없어요.",
  },
  engine_error: {
    label: "측정 실패",
    explain:
      "AI 서비스 오류(한도 초과 등)로 답을 못 받았어요. 비율 계산에서 뺐어요.",
  },
  unverified: {
    label: "판정 보류",
    explain:
      "답은 받았지만 같은 회사인지 판정하지 못했어요. 비율 계산에서 뺐어요.",
  },
};

export const ANSWER_BUCKET_COPY_EN: Record<AnswerBucket, BucketCopy> = {
  confirmed: {
    label: "Knows you",
    explain: "Described the same company as your official site.",
  },
  different_entity: {
    label: "Confuses you",
    explain: "Same name, but described a different company or thing.",
  },
  unknown: {
    label: "Doesn't know",
    explain: "Said it doesn't know, or never named you.",
  },
  engine_error: {
    label: "Failed",
    explain:
      "The AI service errored (quota, rate limit). Excluded from ratios.",
  },
  unverified: {
    label: "Undecided",
    explain: "Answered, but we couldn't verify it's you. Excluded from ratios.",
  },
};

export function answerBucketCopy(
  bucket: AnswerBucket,
  isKo: boolean
): BucketCopy {
  return (isKo ? ANSWER_BUCKET_COPY_KO : ANSWER_BUCKET_COPY_EN)[bucket];
}

/** 헤드라인 4칸의 순서 — 판정 보류는 4칸이 아니라 각주로 붙는다. */
export const HEADLINE_BUCKETS = [
  "confirmed",
  "different_entity",
  "unknown",
  "engine_error",
] as const satisfies readonly AnswerBucket[];

export function bucketCount(
  summary: BucketCounts,
  bucket: AnswerBucket
): number {
  switch (bucket) {
    case "confirmed":
      return summary.confirmed;
    case "different_entity":
      return summary.differentEntity;
    case "unknown":
      return summary.unknown;
    case "engine_error":
      return summary.engineError;
    default:
      return summary.unverified;
  }
}

/**
 * 한 문장 결론 — 숫자만 말한다(없는 비교군·임계값을 만들지 않는다).
 * 판정 끝난 답변이 0 이면 결론을 내지 않는다.
 */
export function answerBucketHeadline(
  brandName: string,
  summary: AnswerBucketSummary,
  isKo: boolean
): string {
  const { adjudicated, confirmed, differentEntity, unknown } = summary.ai;
  if (adjudicated === 0) {
    return isKo
      ? `${brandName}, 이번 측정에서는 판정이 끝난 AI 답변이 없어요.`
      : `${brandName}: no AI answer could be adjudicated in this run.`;
  }
  if (isKo) {
    const parts = [`${confirmed}개만 우리를 제대로 알아요`];
    if (confirmed === adjudicated) {
      return `${brandName}, AI 답변 ${adjudicated}개가 모두 우리를 제대로 알아요.`;
    }
    if (differentEntity > 0) {
      parts.push(`${differentEntity}개는 다른 회사로 알고 있어요`);
    }
    if (unknown > 0) {
      parts.push(`${unknown}개는 우리를 몰라요`);
    }
    return `${brandName}, AI 답변 ${adjudicated}개 중 ${parts.join(", ")}.`;
  }
  if (confirmed === adjudicated) {
    return `${brandName}: all ${adjudicated} AI answers know you correctly.`;
  }
  const parts = [`only ${confirmed} know you correctly`];
  if (differentEntity > 0) {
    parts.push(`${differentEntity} confuse you with another company`);
  }
  if (unknown > 0) {
    parts.push(`${unknown} don't know you`);
  }
  return `${brandName}: of ${adjudicated} AI answers, ${parts.join(", ")}.`;
}

// ──────────────────────────────────────────────────────────────────
// 답변별 사유 — 「질문 × 엔진」 표의 한 줄 설명
// ──────────────────────────────────────────────────────────────────

const QUOTA_RE = /quota|exceeded|credit|billing|한도/i;
const RATE_LIMIT_RE = /too many requests|rate.?limit|429/i;
const TIMEOUT_RE = /timeout|timed out|시간 초과/i;

type ReasonKey =
  | "stub"
  | "quota"
  | "rate_limit"
  | "timeout"
  | "engine_error"
  | "unverified"
  | "different_entity"
  | "confirmed"
  | "recommended"
  | "not_recommended"
  | "no_official_evidence"
  | "said_unknown"
  | "absent";

/** [한국어, 영어] — 문구는 여기 한 곳에만 있다. */
const REASON_COPY: Record<ReasonKey, readonly [string, string]> = {
  stub: ["이 AI는 아직 연결 전이에요", "Not connected yet"],
  quota: ["AI 서비스 사용 한도 초과", "AI service quota exceeded"],
  rate_limit: ["요청이 몰려 거절됨(429)", "Rate limited (429)"],
  timeout: ["응답 시간 초과", "Timed out"],
  engine_error: ["AI 서비스 응답 오류", "AI service error"],
  unverified: [
    "판정기 오류로 같은 회사인지 확인하지 못했어요",
    "The verifier failed; identity not checked",
  ],
  different_entity: [
    "같은 이름의 다른 대상을 설명했어요",
    "Described a different entity with the same name",
  ],
  confirmed: [
    "공식 사이트 내용과 맞게 설명했어요",
    "Matches your official site",
  ],
  recommended: [
    "이름 없이 물었는데 우리를 추천했어요",
    "Recommended you without being given your name",
  ],
  not_recommended: ["추천 목록에 없었어요", "Not in the recommendations"],
  no_official_evidence: [
    "이름은 나왔지만 공식 사이트 근거가 없어요",
    "Named, but without official-site evidence",
  ],
  said_unknown: ["모른다고 답했어요", "Said it doesn't know you"],
  absent: ["답변에 이름이 없어요", "Your name isn't in the answer"],
};

function engineErrorReason(row: BucketableAnswer): ReasonKey {
  if (row.isStub) {
    return "stub";
  }
  const message = row.errorMessage ?? "";
  if (QUOTA_RE.test(message)) {
    return "quota";
  }
  if (RATE_LIMIT_RE.test(message)) {
    return "rate_limit";
  }
  if (TIMEOUT_RE.test(message)) {
    return "timeout";
  }
  return "engine_error";
}

function reasonKey(
  row: BucketableAnswer & { verdictReason?: string | null }
): ReasonKey {
  const bucket = classifyAnswer(row);
  if (bucket === "engine_error") {
    return engineErrorReason(row);
  }
  if (bucket === "unverified" || bucket === "different_entity") {
    return bucket;
  }
  const discovery = isDiscoveryAnswer(row);
  if (bucket === "confirmed") {
    return discovery ? "recommended" : "confirmed";
  }
  if (discovery) {
    return "not_recommended";
  }
  // 판정기가 「같은 회사」라 했지만 공식 사이트 고유 사실이 답변에 없던 경우 —
  //   quality 는 unknown_brand 로 저장되므로 그보다 먼저 본다.
  if (row.verdictReason === "official_evidence_missing") {
    return "no_official_evidence";
  }
  return row.mentionQuality === "unknown_brand" ? "said_unknown" : "absent";
}

export function answerReason(
  row: BucketableAnswer & { verdictReason?: string | null },
  isKo: boolean
): string {
  const [ko, en] = REASON_COPY[reasonKey(row)];
  return isKo ? ko : en;
}
