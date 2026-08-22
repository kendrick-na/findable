// Findable 7 엔진 공통 타입
// 글로벌 4 (AI Gateway) + 한국 3 (직접 호출)

export type EngineId =
  | "chatgpt"
  | "chatgpt-web" // ChatGPT 웹 UI (Stagehand). 베타. API와 별도 측정.
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
}

export interface CitedSource {
  domain: string;
  snippet?: string;
  title?: string;
  url: string;
}

// 엔진 호출당 토큰 사용량(원가 산정용). LLM 엔진만 채워지고, 크롤링/검색형은 null.
export interface EngineUsage {
  // 이 엔진이 원가에 잡히는 방식. token=토큰과금 / browser=Browserbase 세션시간 / free=무료티어 / unknown.
  costModel: "token" | "browser" | "free" | "unknown";
  inputTokens: number | null;
  outputTokens: number | null;
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
  rawResponse: string;
  sentiment: "positive" | "neutral" | "negative" | null;
  shareOfVoice: number | null; // 0.0 ~ 1.0
  usage?: EngineUsage; // 원가계기(유닛이코노믹스). 없으면 미측정.
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
