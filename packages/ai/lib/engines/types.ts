// Findable 7 엔진 공통 타입
// 글로벌 4 (AI Gateway) + 한국 3 (직접 호출)

export type EngineId =
  | "chatgpt"
  | "chatgpt-web" // ChatGPT 웹 UI (Firecrawl actions · 2026-10-07). 베타. API와 별도 측정.
  | "claude"
  | "perplexity"
  | "gemini"
  | "hyperclova"
  | "naver"
  | "naver-briefing" // 네이버 AI 브리핑 (D-047, 2026-05-07). 검색 점유율 20%, 점유율 40% 확대 예정.
  | "daum";

export type EngineLanguage = "ko" | "en" | "both";

export type EngineProvider =
  | "openai"
  | "anthropic"
  | "perplexity"
  | "google"
  | "naver"
  | "kakao";

export interface EngineMeta {
  id: EngineId;
  language: EngineLanguage;
  name: string;
  ordering: number;
  provider: EngineProvider;
}

export const ENGINES: EngineMeta[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    provider: "openai",
    language: "both",
    ordering: 1,
  },
  {
    id: "chatgpt-web",
    name: "ChatGPT (Web)",
    provider: "openai",
    language: "both",
    ordering: 2,
  },
  {
    id: "claude",
    name: "Claude",
    provider: "anthropic",
    language: "both",
    ordering: 3,
  },
  {
    id: "perplexity",
    name: "Perplexity",
    provider: "perplexity",
    language: "both",
    ordering: 4,
  },
  {
    id: "gemini",
    name: "Gemini",
    provider: "google",
    language: "both",
    ordering: 5,
  },
  {
    id: "hyperclova",
    name: "HyperCLOVA X",
    provider: "naver",
    language: "ko",
    ordering: 6,
  },
  {
    id: "naver",
    name: "Naver",
    provider: "naver",
    language: "ko",
    ordering: 7,
  },
  {
    id: "naver-briefing",
    name: "Naver AI 브리핑",
    provider: "naver",
    language: "ko",
    ordering: 8,
  },
  { id: "daum", name: "Daum", provider: "kakao", language: "ko", ordering: 9 },
];

export interface EngineQuery {
  /**
   * 자사 도메인. **본문 URL 폴백에서 자사 주소를 빼는 데 쓴다**(N-47).
   * 없으면 예전처럼 전부 담는다(무료 진단 등 도메인 문맥이 없는 경로 호환).
   * 📕 `extractCitedSources` 주석 — "AI 가 타이핑한 자기 홈페이지는 읽은 근거가 아니다".
   */
  brandDomain?: string;
  brandName?: string; // 인용 추출용
  brandVariants?: string[]; // Korean Entity Grounding
  engineId: EngineId;
  language: "ko" | "en";
  prompt: string;
  /** Propagates an invocation deadline without allowing adapters to restart work. */
  signal?: AbortSignal;
}

export interface CitedSource {
  domain: string;
  snippet?: string;
  title?: string;
  url: string;
}

// 엔진 호출당 토큰 사용량(원가 산정용). LLM 엔진만 채워지고, 크롤링/검색형은 null.
export interface EngineUsage {
  /**
   * ChatGPT 「측정 방식 세트」 키(2026-10-07). `CHATGPT_SOURCE=web` 으로 잰 chatgpt 행에만 붙는다
   *   (예: `chatgpt-web-v1`). 비교 가드(`search-sampling-version.ts`)가 이 값으로 회차 비교를 막는다.
   *   ⚠️ 미기재 = 기존 API 방식(legacy) — 이전 기록과 같은 시계열.
   */
  chatgptEngineSet?: string;
  // 이 엔진이 원가에 잡히는 방식. token=토큰과금 / credit=Firecrawl 크레딧 /
  //   browser=Browserbase 세션시간(구식·하위호환) / free=무료티어 / unknown.
  costModel: "token" | "credit" | "browser" | "free" | "unknown";
  /**
   * Firecrawl 이 이번 호출에 소비한 크레딧 수(naver-briefing). 원가모델 v2(2026-10-07) 신설.
   * 공식 단가표: scrape 1크레딧/페이지, enhanced 프록시 할증 없음.
   */
  creditsUsed?: number | null;
  /**
   * 메인 엔진 세트 표식(2026-10-10). `FINDABLE_ENGINE_SET=api-search-v1` 로 잰 chatgpt·gemini·claude 행에만
   *   붙는다(`api-search-v1`). 비교 가드(`search-sampling-version.ts`)가 `+api:search-v1` 꼬리표로 바꾸고,
   *   원가 계산(`cost.ts`)이 이 값으로 후보 단가 경로를 탄다. 미기재 = 기존 세트.
   */
  engineSet?: string;
  /**
   * Letsur 불가로 Vercel AI Gateway 에 **대신** 보낸 호출이면 `"gateway"`(2026-10-07 신설).
   * 원래 경로(Letsur·직접 키)로 끝난 호출에는 붙지 않는다.
   */
  fallback?: "gateway";
  inputTokens: number | null;
  /** 실제로 응답한 모델 슬러그(Gateway 경로에서만 채움). cost.ts 가 이 모델 단가로 계산한다. */
  modelId?: string;
  outputTokens: number | null;
  /**
   * 이 응답 앞에 **실패한 웹 수집 시도**가 쓴 Firecrawl 크레딧(웹→API 폴백 시). 원가에 더한다.
   */
  priorAttemptCreditsUsed?: number;
  /**
   * 실제 청구 경로. `"gateway"` = Vercel AI Gateway(Letsur 폴백 포함). 미기재 = 기존 직접 경로.
   */
  provider?: "gateway";
  /**
   * provider 청구 단위를 **원화로 환산해 둔** 이번 호출 원가(KRW). api-search-v1 ChatGPT 후보 전용
   * (LETSUR unit 청구 · 1 unit = 정가 1 USD 이지만 원화 청구 환산은 1,525원/unit — cost.ts 참조).
   * 있으면 `providerCostUsd × USD_TO_KRW` 보다 우선한다. 기존 엔진은 채우지 않는다.
   */
  providerCostKrw?: number | null;
  /**
   * provider 가 **응답에 직접 적어 준** 이번 호출 총원가(USD). 있으면 단가표 계산보다 우선한다.
   * 현재 Perplexity Agent API(`usage.cost.total_cost`)만 채운다. 원가모델 v2 신설.
   */
  providerCostUsd?: number | null;
  /**
   * claude 웹검색을 원했지만(FINDABLE_CLAUDE_WEB_SEARCH=1) 폴백 경로에서 **검색 없이** 답했다.
   * → 이 응답의 「출처 0」은 「AI 가 아무것도 안 봤다」가 아니라 **미수집**이다.
   */
  searchUnavailable?: boolean;
  /**
   * ChatGPT 답변을 **어디서** 받았나(2026-10-07).
   *   web = chatgpt.com 화면(Firecrawl) · api = API · api_fallback = 웹 실패 후 API+웹검색.
   *   미기재 = 기존 API 경로(플래그 도입 전과 동일).
   */
  source?: "web" | "api" | "api_fallback";
  /** claude-search-v1 후보 전용: provider stop_reason(`max_tokens` = 잘림). 기존 엔진은 채우지 않는다. */
  stopReason?: string | null;
  /**
   * 이번 호출에서 provider 가 실행·과금한 웹검색 횟수. 원가모델 v2 신설.
   *   · claude 웹검색 경로: `usage.server_tool_use.web_search_requests`
   *   · perplexity Agent: `usage.tool_calls_details.search_web.invocation`
   * ⚠️ `undefined` = 검색 도구를 **안 붙인** 호출(검색료 없음).
   *    `null` = 검색 도구를 붙였는데 응답에 횟수가 **없었다**(= 미수집, 0원 아님).
   */
  webSearchRequests?: number | null;
}

export interface EngineResponse {
  brandMentioned: boolean;
  citedSources: CitedSource[];
  durationMs: number;
  engineId: EngineId;
  errorMessage: string | null;
  isStub: boolean; // 환경변수 미설정 시 stub 응답
  /**
   * `mentionPosition` 이 나온 번호 목록의 총 항목 수(분모). "N개 중 position 번째".
   * 세션N-10(2026-08-07) 신설 — 순위 숫자만으로는 *"2개 중 1위"* 와 *"50개 중 1위"* 가
   * 구분되지 않아 competition 점수가 둘을 똑같이 매기고 있었다.
   * ⚠️ 소급 불가: 이 필드 도입 전 측정분은 null 이다(화면·채점 양쪽에 null 폴백 필요).
   */
  mentionListSize: number | null;
  mentionPosition: number | null; // 1, 2, 3, ... 또는 null
  /** Entity verification could not finish; never interpret as a confirmed absence. */
  mentionQuality?:
    | "confirmed"
    | "different_entity"
    | "unknown_brand"
    | "absent"
    | "unverified";
  rawResponse: string;
  sentiment: "positive" | "neutral" | "negative" | null;
  /**
   * api-search-v1 후보 엔진 섀도 결과(`API_SEARCH_SHADOW=true` + 허용 도메인). **chatgpt·gemini 행에만** 붙는다.
   * 🔴 점수·집계·판정·PDF 에 쓰지 않는다 — 소비자 화면에 가까운 API 후보 답을 재기 위한 저장 전용 값이다.
   */
  shadowApiSearch?: ApiSearchShadow;
  /**
   * ChatGPT 웹 섀도 수집 결과(`CHATGPT_WEB_SHADOW=true` · 2026-10-07). **chatgpt 행에만** 붙는다.
   * 🔴 점수·집계·판정에 쓰지 않는다 — API 답과 웹 답의 차이를 재기 위한 저장 전용 값이다.
   */
  shadowChatgptWeb?: ChatgptWebShadow;
  /**
   * 업체 화면 수집 섀도(`UI_VENDOR_SHADOW=true` + 허용 도메인 · Bright Data). **chatgpt·gemini 행에만** 붙는다.
   * 🔴 점수·집계·판정·PDF·UI 에 쓰지 않는다 — 보정(캘리브레이션) 저장 전용 값이다.
   * [법률 확인 필요] 업체가 수집한 소비자 화면 결과를 고객 점수·영업에 쓰려면 법률 검토가 먼저다.
   */
  shadowUiVendor?: UiVendorShadow;
  shareOfVoice: number | null; // 0.0 ~ 1.0
  usage?: EngineUsage; // 원가계기(유닛이코노믹스). 없으면 미측정.
}

/** api-search-v1 섀도 후보 식별자(저장 전용). */
export type ApiSearchCandidate =
  | "chatgpt-search-v1"
  | "gemini-search-v1"
  | "claude-search-v1";

/** api-search-v1 섀도 1건(저장 전용). 원문은 길이를 제한해 저장한다. */
export interface ApiSearchShadow {
  brandMentioned: boolean | null;
  candidate: ApiSearchCandidate;
  citations: CitedSource[];
  /** 메인 답과의 비교. 섀도가 실패했으면 null. */
  comparison: {
    citationOverlap: number | null;
    mentionAgreement: boolean;
  } | null;
  durationMs: number;
  error: string | null;
  /** 후보가 실제로 쓴 모델 슬러그. */
  model: string;
  /** `ok` · `failed` · `skipped_budget`(메인 배치가 먼저 끝나 중단) */
  outcome: "ok" | "failed" | "skipped_budget";
  /** claude-search-v1 전용: provider 가 준 stop_reason. 실패·미수집이면 생략. */
  stopReason?: string | null;
  text: string;
  /** claude-search-v1 전용: stop_reason 이 max_tokens 이면 true(답이 토큰 상한에서 잘림). 판단 불가·실패면 null. */
  truncated?: boolean | null;
  /** 원가 산정 재료. 실패·중단이면 생략(과금 여부 [확인필요]). */
  usage?: EngineUsage;
}

/** 업체 화면 수집 섀도 후보 식별자(저장 전용). */
export type UiVendorCandidate = "chatgpt-ui-vendor-v1" | "gemini-ui-vendor-v1";

/** 업체 화면 수집 섀도 1건(저장 전용). 원문은 길이를 제한해 저장한다. */
export interface UiVendorShadow {
  brandMentioned: boolean | null;
  candidate: UiVendorCandidate;
  citations: CitedSource[];
  /** 메인 답과의 비교. 섀도가 실패했으면 null. */
  comparison: {
    citationOverlap: number | null;
    mentionAgreement: boolean;
  } | null;
  durationMs: number;
  error: string | null;
  /** `ok` · `failed` · `skipped_budget`(메인 배치가 먼저 끝나 중단) */
  outcome: "ok" | "failed" | "skipped_budget";
  /** 업체가 성공 레코드로 과금했나(ok 일 때만 true). 실패는 미과금. */
  recordBilled: boolean;
  text: string;
  /** 업체가 알려준 모델 표기(예: Gemini 'Flash-Lite'). ChatGPT 는 null. 투명성용. */
  vendorModel: string | null;
  /** 업체 레코드의 web_search_triggered. 미보고면 null. */
  webSearchTriggered: boolean | null;
}

/** 섀도 웹 수집 1건(저장 전용). 원문은 길이를 제한해 저장한다. */
export interface ChatgptWebShadow {
  brandMentioned: boolean | null;
  citations: CitedSource[];
  /** 메인(API) 답과의 비교. 섀도가 실패했으면 null. */
  comparison: {
    /** 두 답의 출처 도메인 자카드 유사도(0~1). 둘 다 출처가 없으면 null. */
    citationOverlap: number | null;
    /** 메인(API) 언급 여부와 같은가. */
    mentionAgreement: boolean;
  } | null;
  /** Firecrawl 이 이번 섀도에 쓴 크레딧(원가 산입용). 미과금이 확실하면 생략. */
  creditsUsed?: number;
  durationMs: number;
  error: string | null;
  /** `ok` · `failed` · `skipped_budget`(메인 배치가 먼저 끝나 중단) */
  outcome: "ok" | "failed" | "skipped_budget";
  text: string;
}

export type EngineAdapter = (query: EngineQuery) => Promise<EngineResponse>;

/** 감성 분포(긍정/중립/부정) — `aggregateAudit` 의 `sentimentDistribution` 과 같은 축. */
export interface SentimentDistribution {
  negative: number;
  neutral: number;
  positive: number;
}

/**
 * 감성 분포를 **화면에 쓸 수 있는 형태로** 정규화한다. 못 쓰면 `null`.
 *
 * 🔴 **왜 필요한가**(2026-08-10 세션N-13 감사 실측): 저장된 회차 중
 *   `{"neutral":0,"negative":0,"positive":0}` 처럼 **합이 0인 것이 실재**한다
 *   (엔진이 전멸한 회차 — AI Gateway 크레딧 고갈로 응답 자체가 없었다).
 *   지금 화면들은 **건수만 표기**해서 나눗셈이 없어 사고가 안 났을 뿐,
 *   누구든 *"긍정 15%"* 같은 **퍼센트 표기를 추가하는 순간 0으로 나눈다**
 *   (`0/0 = NaN` → 화면에 `NaN%`).
 *
 * ⚠️ **점수(`geoAxisScores`)는 이 함수를 쓰지 않는다** — 거기엔 이미 `sentTotal === 0 → 30점`
 *   기준선이 있고, 그 규칙을 바꾸면 소급 점수가 흔들린다. 이건 **표시 전용 방어막**이다.
 *
 * @example
 * const s = normalizeSentiment(metrics.sentimentDistribution);
 * // 합이 0이거나 값이 이상하면 s === null → 화면은 "—" 로 표기하고 퍼센트를 만들지 않는다.
 * s ? `긍정 ${s.positivePercent}%` : "—";
 */
export function normalizeSentiment(dist: unknown): {
  positive: number;
  neutral: number;
  negative: number;
  total: number;
  positivePercent: number;
  neutralPercent: number;
  negativePercent: number;
} | null {
  if (!dist || typeof dist !== "object") {
    return null;
  }
  const record = dist as Record<string, unknown>;
  // 저장된 result 는 JSON(=unknown)이라 키별로 런타임 가드한다.
  //   음수·NaN·Infinity·문자열은 전부 0 으로 접는다(퍼센트가 음수로 나가는 걸 차단).
  const toCount = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.round(value)
      : 0;
  const positive = toCount(record.positive);
  const neutral = toCount(record.neutral);
  const negative = toCount(record.negative);
  const total = positive + neutral + negative;
  // 🔴 여기가 방어막의 핵심 — 합이 0이면 **퍼센트를 만들지 않고** null 을 돌려준다.
  //   "감성이 전부 중립(0%)" 과 "측정 자체가 없음" 은 전혀 다른 말인데,
  //   0 을 그대로 흘리면 화면에서 둘이 구분되지 않는다.
  if (total === 0) {
    return null;
  }
  const pct = (n: number): number => Math.round((n / total) * 100);
  return {
    positive,
    neutral,
    negative,
    total,
    positivePercent: pct(positive),
    neutralPercent: pct(neutral),
    negativePercent: pct(negative),
  };
}
