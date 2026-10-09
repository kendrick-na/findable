// 엔진 원가 계기 — 유닛이코노믹스(진단 1건당 실비용) 산정.
//
// 원가 동인:
//   token   : LLM API. inputTokens/outputTokens × 모델 단가 (+ 웹검색 건당 요금).
//   credit  : Firecrawl(naver-briefing). 크레딧 × 크레딧당 단가. (v2 신설)
//   browser : Browserbase 세션시간 근사. ⚠️ 구식 — naver-briefing 은 2026-07-29 Firecrawl 로
//             전환됐다. 옛 usage 가 `browser` 로 들어오면 하위호환으로만 계산한다.
//   free    : 무료 티어(gemini Google 1,500/일, naver Search API 무료분).
//
// 🔴 원가모델 v2 (2026-10-07) — **과소 기록 수정**. 바뀐 것:
//   ① claude 웹검색 요금($10/1,000회)이 빠져 있었다 → `webSearchRequests` 로 가산.
//   ② gpt-5.4 output 단가가 $10 로 잘못 들어가 있었다 → 공식 $15.
//   ③ naver-briefing 이 Browserbase 분당 단가로 잡히고 있었다 → Firecrawl 크레딧 기준.
//   ④ Firecrawl 은 렌더에 성공하면 「AI 브리핑 미노출」이어도 크레딧이 나간다 → 원가 산입.
//   ⑤ perplexity Agent 는 응답에 provider 가 계산한 USD 원가를 준다 → 그 값을 우선.
//   결과 객체에 `costModelVersion` 을 실어 일일 점검이 전/후를 가를 수 있게 했다.
//   ⚠️ 과거 기록은 **소급 재계산하지 않는다**(v1 값은 v1 대로 남긴다).
//
// 단가는 USD. LLM 단가 = USD per 1M tokens. 환율은 USD_TO_KRW 로 일괄 환산.
//
// ➕ 2026-10-07 ChatGPT 웹 수집(CHATGPT_SOURCE=web · CHATGPT_WEB_SHADOW=true) 원가 — v2 범위 안의 추가.
//   플래그를 안 켜면 들어오는 입력이 없어 **기존 계산은 한 줄도 안 바뀐다**(그래서 버전 유지).
//   · 웹 수집 = Firecrawl scrape(actions 포함) 1회 = 1크레딧(응답 metadata.creditsUsed 가 있으면 그 값).
//   · 웹 실패 후 API 폴백 = gpt-5.4 토큰 + OpenAI 웹검색 $10/1,000회 + 앞서 쓴 웹 크레딧.
//   · 섀도 = 메인과 별도로 Firecrawl 크레딧이 나간다 → `auditCost` 가 별도 항목으로 더한다.
// ➕ 2026-10-09 api-search-v1 섀도 후보(API_SEARCH_SHADOW=true · 허용 도메인만) 원가 — v2 범위 안의 추가.
//   플래그를 안 켜면 들어오는 입력(`shadowApiSearch`)이 없어 **기존 계산은 한 줄도 안 바뀐다**(그래서 버전 유지).
//   후보 원가는 `apiSearchShadowCostOf` 가 **별도 항목**으로 만들고 `auditCost` 가 shadowKrw·apiSearchShadowKrw 로만 보고한다(totalKrw 불포함).
// ⚠️ chatgpt·claude 는 실제로는 Letsur 게이트웨이로 청구된다 — 아래는 **원 제공사 공식 정가**다.
// ➕ 2026-10-10 ui-vendor-v1 섀도(UI_VENDOR_SHADOW=true · Bright Data 성공 레코드 $1.50/1,000) — 같은 방식으로 별도 항목(totalKrw 불포함).
//    Letsur 의 재판매 단가·수수료는 [확인필요](청구서 대조 전까지 정가로 둔다).

import type { EngineId, EngineResponse } from "./types";

// USD→KRW 환율(보정 지점).
export const USD_TO_KRW = 1380;

/**
 * 원가 산정 규칙의 버전. 규칙(단가·산입 범위)을 바꾸면 올린다.
 *   1 = 2026-07 추정 단가(웹검색료 없음·gpt-5.4 output $10·naver-briefing Browserbase 분당)
 *   2 = 2026-10-07 공식 단가 재확인 + 웹검색료 + Firecrawl 크레딧 (이 파일 상단 참조)
 */
export const COST_MODEL_VERSION = 2;

/**
 * LETSUR 1 unit 의 **원화 청구 환산**(KRW/unit) — api-search-v1 ChatGPT 후보 전용. [확인필요: 청구서 대조]
 *   · LETSUR unit 은 원 제공사 정가 1 USD 와 같은 금액으로 차감된다(응답 `estimated_cost.currency="unit"`).
 *   · 그러나 원화로 청구될 때의 환산은 1,525원/unit 로 보고 있다(대표 제공 가정).
 *   🔴 위 USD_TO_KRW(1380, 정가 USD 환산용)와 **값이 다르다** — 같은 unit 이어도 후보 원가는
 *      1380 이 아니라 1525 로 계산해 실제 청구에 맞춘다. 두 환율이 갈라진 것은 의도된 불일치이며,
 *      메인(chatgpt·claude) 원가는 기존대로 1380 이다. 통일 여부는 청구서 확인 후 대표 결정.
 */
export const LETSUR_KRW_PER_UNIT = 1525;

/**
 * api-search-v1 Gemini 후보의 검색 1회(쿼리 1건)당 USD. [확인필요 — 공식 단가표로 재확인]
 *   Gemini 3 계열 그라운딩은 「실행된 검색 쿼리 수」 기준 과금으로 알려져 있다($14/1,000 queries).
 *   기존 `WEB_SEARCH_USD_PER_REQUEST`(엔진 id 기준)에 gemini 를 넣지 않는다 — 메인 gemini(무료 티어)
 *   계산에 새는 걸 막기 위해 후보 전용 상수로 둔다.
 */
export const GEMINI_SEARCH_USD_PER_QUERY = 14 / 1000;

/**
 * 업체 화면 수집(Bright Data scraper API) 성공 레코드 1건당 USD = $1.50/1,000건. 실패 레코드는 미과금.
 *   [확인필요] 요금제·물량 할인·최소 약정 단가는 계약 확인 전까지 정가로 둔다.
 *   [법률 확인 필요] 이 수집물을 고객 점수·영업에 쓰는 것은 법률 검토 전 금지 — 보정·섀도 전용.
 */
export const UI_VENDOR_USD_PER_RECORD = 1.5 / 1000;

/**
 * api-search-v1 후보 모델별 토큰 단가(USD/1M). **여기 없으면 `unknown`** — 다른 모델 값을 빌리지 않는다.
 *   · gemini-3.5-flash-lite: LETSUR 카탈로그 표기 in $0.30 / out $2.50 (LETSUR catalog · 공식 단가표 대조 [확인필요]).
 */
const SHADOW_MODEL_TOKEN_PRICES: Record<string, TokenPrice> = {
  "gemini-3.5-flash-lite": { inputPerM: 0.3, outputPerM: 2.5 },
};

// 모델별 USD/1M tokens (input, output). 슬러그는 global/korean adapter 기본값 기준.
interface TokenPrice {
  inputPerM: number; // USD / 1M input tokens
  outputPerM: number; // USD / 1M output tokens
}

// engineId → 단가. token 과금 엔진만.
const TOKEN_PRICES: Partial<Record<EngineId, TokenPrice>> = {
  // OpenAI gpt-5.4 (<272K 컨텍스트) 공식가 — input $2.50 · output $15.00 (2026-10-07 확인).
  //   출처: https://developers.openai.com/api/docs/pricing
  chatgpt: { inputPerM: 2.5, outputPerM: 15 },
  // Anthropic claude-sonnet-4.6 공식가 — input $3 · output $15 (2026-10-07 확인).
  //   출처: https://platform.claude.com/docs/en/about-claude/pricing
  claude: { inputPerM: 3, outputPerM: 15 },
  // Perplexity sonar(추정). ⚠️ Agent API 경로는 provider 가 준 USD 원가(`providerCostUsd`)를
  //   우선 쓰므로, 이 단가는 Gateway 폴백 경로에서만 쓰인다. [확인필요]
  perplexity: { inputPerM: 1, outputPerM: 1 },
  // HyperCLOVA X HCX-DASH-002 — CLOVA Studio 공개가(추정, KRW 표기라 USD 환산 역산).
  hyperclova: { inputPerM: 0.4, outputPerM: 1.2 },
  // naver = Search API(무료분) + HyperCLOVA 합성. 합성 토큰만 과금 → hyperclova 단가 준용.
  naver: { inputPerM: 0.4, outputPerM: 1.2 },
};

/**
 * 웹검색 1회당 요금(USD). 검색 도구를 실제로 붙여 호출하는 엔진만.
 *   · claude: $10 / 1,000 searches. 오류 난 검색은 미과금(공식 문서 명시).
 *     출처: https://platform.claude.com/docs/en/about-claude/pricing (Web search tool)
 *   · perplexity Agent: search_web $0.0025 / call. ⚠️ Agent 응답의 `usage.cost` 가 있으면
 *     그게 우선이고(이미 포함), 이 값은 provider 원가가 빠졌을 때만 쓴다.
 *     출처: https://docs.perplexity.ai/getting-started/pricing
 *   · chatgpt: OpenAI Responses `web_search` $10 / 1,000 calls(+검색 결과 토큰은 입력 단가 — 토큰에 이미 포함).
 *     출처: https://developers.openai.com/api/docs/pricing (2026-10-07 확인).
 *     ⚠️ 기본 API 경로는 검색 도구를 안 붙인다(webSearchRequests 미기재 → 검색료 0).
 *        CHATGPT_SOURCE=web 의 **폴백 경로**만 붙인다.
 *    gemini 그라운딩은 플래그 기본 off 이고 엔진 자체가 무료 티어로 잡힌다 — 켜면 재검토.
 */
const WEB_SEARCH_USD_PER_REQUEST: Partial<Record<EngineId, number>> = {
  chatgpt: 10 / 1000,
  claude: 10 / 1000,
  perplexity: 0.0025,
};

/**
 * Vercel AI Gateway 경로(Letsur 불가 폴백 포함)의 **모델별** 단가 — 2026-10-07 확인.
 *   근거 ① https://vercel.com/docs/ai-gateway/pricing — *"AI Gateway charges no markup and
 *        no platform fee on tokens. You pay the provider's list price"* (토큰 정가 그대로).
 *   근거 ② https://ai-gateway.vercel.sh/v1/models 의 `pricing`(USD/token · web_search USD/1,000회).
 * ⚠️ 슬러그가 여기 없으면(FINDABLE_MODEL_* 로 바꾼 경우) 엔진 기본 단가로 **추정하지 않고**
 *   `unknown`(단가 미등록)으로 남긴다 — 다른 모델 값을 빌려 쓰면 원가가 조용히 틀린다.
 */
interface GatewayPrice extends TokenPrice {
  webSearchUsdPerRequest?: number;
}
const GATEWAY_MODEL_PRICES: Record<string, GatewayPrice> = {
  "anthropic/claude-sonnet-4.6": {
    inputPerM: 3,
    outputPerM: 15,
    webSearchUsdPerRequest: 10 / 1000,
  },
  // <272K 컨텍스트 구간(우리 호출은 전부 이 구간).
  "openai/gpt-5.4": {
    inputPerM: 2.5,
    outputPerM: 15,
    // 검색 도구를 붙인 호출(ChatGPT 웹 수집 폴백)만 횟수가 기록된다.
    webSearchUsdPerRequest: 10 / 1000,
  },
  "anthropic/claude-haiku-4.5": { inputPerM: 1, outputPerM: 5 },
  "perplexity/sonar": { inputPerM: 0.25, outputPerM: 2.5 },
  "google/gemini-2.5-flash": { inputPerM: 0.3, outputPerM: 2.5 },
};

/**
 * Firecrawl `/v2/scrape` 1회 = 1크레딧(rawHtml 형식, enhanced 프록시 할증 없음).
 *   출처: https://www.firecrawl.dev/pricing ("Scrape … 1 / page"),
 *        https://docs.firecrawl.dev/api-reference/endpoint/scrape ("Enhanced proxies carry no credit surcharge")
 */
export const FIRECRAWL_CREDITS_PER_SCRAPE = 1;

/**
 * Firecrawl 크레딧 1개당 USD. 🔴 [확인필요] **우리 계정의 요금제를 모른다.**
 *   공개 정가 중 크레딧 단가가 가장 비싼 Hobby 월결제($19 / 5,000 크레딧 = $0.0038)를
 *   **보수적 상한**으로 둔다(과소 기록 방지). 요금제가 확인되면 이 값만 바꾼다.
 *   참고: Standard 월결제 $99 / 100,000 = $0.00099, Free 플랜이면 실비 0.
 *   출처: https://www.firecrawl.dev/pricing (2026-10-07 확인)
 */
export const FIRECRAWL_USD_PER_CREDIT = 19 / 5000;

// Browserbase 세션 대략 단가(USD/분). ⚠️ 구식(v1) — 하위호환 계산에만 남긴다.
const BROWSERBASE_USD_PER_MIN = 0.1;

export interface EngineCost {
  basis: "token" | "credit" | "browser" | "free" | "unknown" | "vendor-record";
  engineId: EngineId;
  krw: number; // 이 엔진 호출 1회 원가(KRW)
  note?: string;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// Firecrawl 크레딧 원가. 크레딧 수가 없으면 공식 1크레딧/scrape 를 적용(근거 상단).
function creditCost(res: EngineResponse): EngineCost {
  const reported = res.usage?.creditsUsed;
  const credits = isFiniteNonNegative(reported)
    ? reported
    : FIRECRAWL_CREDITS_PER_SCRAPE;
  const krw = credits * FIRECRAWL_USD_PER_CREDIT * USD_TO_KRW;
  return {
    engineId: res.engineId,
    krw,
    basis: "credit",
    note: isFiniteNonNegative(reported)
      ? `Firecrawl ${credits}크레딧`
      : `Firecrawl 크레딧 미보고 → 공식 ${FIRECRAWL_CREDITS_PER_SCRAPE}크레딧/scrape 적용`,
  };
}

// 웹검색 요금(USD)과 그 주석. 검색 도구를 안 붙인 호출(undefined)은 0·주석 없음.
function webSearchFee(res: EngineResponse): { usd: number; note?: string } {
  const perRequest = WEB_SEARCH_USD_PER_REQUEST[res.engineId];
  const count = res.usage?.webSearchRequests;
  if (perRequest === undefined || count === undefined) {
    return { usd: 0 };
  }
  // 🔴 횟수를 **못 받았으면 0으로 더하되 그 사실을 남긴다** — 추정치를 지어내지 않는다.
  if (!isFiniteNonNegative(count)) {
    return { usd: 0, note: "검색 횟수 미수집(검색료 0 산입)" };
  }
  return { usd: count * perRequest, note: `웹검색 ${count}회` };
}

// Gateway 경로: 실제로 응답한 모델 슬러그의 단가로 계산한다.
function gatewayTokenCost(res: EngineResponse): EngineCost {
  const { engineId, usage } = res;
  const modelId = usage?.modelId;
  const price = modelId ? GATEWAY_MODEL_PRICES[modelId] : undefined;
  const route =
    usage?.fallback === "gateway" ? "Letsur→Gateway 폴백" : "Gateway";
  if (!price) {
    return {
      engineId,
      krw: 0,
      basis: "unknown",
      note: `${route} · 모델 단가 미등록(${modelId ?? "모델 미기록"})`,
    };
  }
  if (usage?.inputTokens == null || usage?.outputTokens == null) {
    return {
      engineId,
      krw: 0,
      basis: "unknown",
      note: `${route} · 토큰 미측정`,
    };
  }
  const searches = usage.webSearchRequests;
  const searchUsd =
    price.webSearchUsdPerRequest !== undefined && isFiniteNonNegative(searches)
      ? searches * price.webSearchUsdPerRequest
      : 0;
  const usd =
    (usage.inputTokens / 1_000_000) * price.inputPerM +
    (usage.outputTokens / 1_000_000) * price.outputPerM +
    searchUsd;
  return {
    engineId,
    krw: usd * USD_TO_KRW,
    basis: "token",
    note:
      searchUsd > 0
        ? `${route} · ${modelId} · 웹검색 ${searches}회`
        : `${route} · ${modelId}`,
  };
}

function tokenCost(res: EngineResponse): EngineCost {
  const { engineId, usage } = res;
  // provider 가 직접 계산한 원가가 있으면 그게 정답이다(토큰·도구료 포함).
  //   원화로 이미 환산해 둔 값(providerCostKrw)이 있으면 그걸 우선한다(LETSUR unit 1,525원 가정 — 상단 참조).
  if (isFiniteNonNegative(usage?.providerCostKrw)) {
    return {
      engineId,
      krw: usage.providerCostKrw,
      basis: "token",
      note: "provider 보고 원가(KRW 환산)",
    };
  }
  if (isFiniteNonNegative(usage?.providerCostUsd)) {
    return {
      engineId,
      krw: usage.providerCostUsd * USD_TO_KRW,
      basis: "token",
      note: "provider 보고 원가(USD)",
    };
  }
  if (usage?.provider === "gateway") {
    return gatewayTokenCost(res);
  }
  const price = TOKEN_PRICES[engineId];
  if (!(price && usage?.inputTokens != null && usage?.outputTokens != null)) {
    return { engineId, krw: 0, basis: "unknown", note: "토큰/단가 미측정" };
  }
  const search = webSearchFee(res);
  const usd =
    (usage.inputTokens / 1_000_000) * price.inputPerM +
    (usage.outputTokens / 1_000_000) * price.outputPerM +
    search.usd;
  return {
    engineId,
    krw: usd * USD_TO_KRW,
    basis: "token",
    ...(search.note ? { note: search.note } : {}),
  };
}

/** Firecrawl 크레딧 수 → KRW. */
export function firecrawlCreditsKrw(credits: number): number {
  return credits * FIRECRAWL_USD_PER_CREDIT * USD_TO_KRW;
}

/**
 * ChatGPT 웹 수집 1회 예상 원가(KRW) — 화면·문서 안내용. 공식 1크레딧/scrape × 크레딧 단가 상한.
 *   ⚠️ [확인필요] actions 가 붙은 scrape 가 Interact(브라우저 분당 2크레딧)로 따로 과금되는지.
 *   공식 단가표는 scrape 1크레딧/페이지만 명시하고 actions 할증은 적지 않았다(2026-10-07).
 */
export const CHATGPT_WEB_KRW_PER_CALL = firecrawlCreditsKrw(
  FIRECRAWL_CREDITS_PER_SCRAPE
);

// EngineResponse 1건 → 원가(KRW). usage 없으면 costModel 로 근사.
//   웹 수집이 실패해 API 로 폴백한 행은 **앞서 쓴 웹 크레딧**을 더한다.
export function costOf(res: EngineResponse): EngineCost {
  const base = baseCostOf(res);
  const prior = res.usage?.priorAttemptCreditsUsed;
  if (!isFiniteNonNegative(prior) || prior === 0) {
    return base;
  }
  const note = `웹 수집 실패분 Firecrawl ${prior}크레딧 포함`;
  return {
    ...base,
    krw: base.krw + firecrawlCreditsKrw(prior),
    basis:
      base.basis === "free" || base.basis === "unknown" ? "credit" : base.basis,
    note: base.note ? `${base.note} · ${note}` : note,
  };
}

function baseCostOf(res: EngineResponse): EngineCost {
  const { engineId, usage, durationMs } = res;

  // stub 은 실호출이 없으니 0원.
  if (res.isStub) {
    return { engineId, krw: 0, basis: "free", note: "stub/error=미과금" };
  }

  const costModel = usage?.costModel ?? inferCostModel(engineId);

  if (res.errorMessage) {
    // 🔴 Firecrawl 은 렌더가 성공했으면(HTTP 2xx) 「AI 브리핑 미노출」이어도 크레딧이 나간다.
    //   어댑터가 `creditsUsed` 를 명시한 실패만 산입한다(HTTP 오류 등은 0원 유지).
    if (costModel === "credit" && isFiniteNonNegative(usage?.creditsUsed)) {
      return creditCost(res);
    }
    return { engineId, krw: 0, basis: "free", note: "stub/error=미과금" };
  }

  if (costModel === "free") {
    return { engineId, krw: 0, basis: "free" };
  }

  if (costModel === "credit") {
    return creditCost(res);
  }

  if (costModel === "browser") {
    const minutes = durationMs / 60_000;
    const krw = minutes * BROWSERBASE_USD_PER_MIN * USD_TO_KRW;
    return { engineId, krw, basis: "browser", note: `${durationMs}ms 세션` };
  }

  if (costModel === "token") {
    return tokenCost(res);
  }

  return { engineId, krw: 0, basis: "unknown" };
}

// usage 가 없을 때 engineId 로 과금 방식 추정.
function inferCostModel(engineId: EngineId): EngineCost["basis"] {
  if (engineId === "naver-briefing") {
    return "credit"; // 2026-07-29 Firecrawl 전환 이후.
  }
  if (engineId === "chatgpt-web") {
    return "credit"; // 2026-10-07 Firecrawl 전환 이후(이전 Stagehand 시절엔 실호출이 없었다).
  }
  if (engineId === "gemini" || engineId === "daum") {
    return "free"; // gemini=무료티어, daum=검색스크랩
  }
  if (TOKEN_PRICES[engineId]) {
    return "token";
  }
  return "unknown";
}

// 진단 1건(여러 엔진) 총원가 합산.
export interface AuditCost {
  /** api-search-v1 후보 섀도 항목(별도 보관 · perEngine/totalKrw 에 **불포함**). 없으면 생략. */
  apiSearchShadow?: EngineCost[];
  /** api-search-v1 후보 섀도 원가 합(KRW). **totalKrw 에 불포함**(shadowKrw 에는 포함). 없으면 생략. */
  apiSearchShadowKrw?: number;
  costModelVersion: number; // 이 합계를 낸 원가 규칙 버전(COST_MODEL_VERSION)
  measuredEngines: number; // token/credit/browser 로 실제 산정된 엔진 수
  perEngine: EngineCost[];
  /**
   * 섀도 원가 합(KRW) = ChatGPT 웹 섀도(totalKrw 에 이미 포함) + api-search-v1 후보 섀도(totalKrw 에 **불포함**).
   * 섀도가 없으면 생략.
   */
  shadowKrw?: number;
  totalKrw: number;
  /** 업체 화면 수집 섀도 항목(별도 보관 · totalKrw 불포함). 없으면 생략. */
  uiVendorShadow?: EngineCost[];
  /** 업체 화면 수집 섀도 원가 합(KRW). totalKrw 불포함(shadowKrw 에는 포함). 없으면 생략. */
  uiVendorShadowKrw?: number;
}

/** 섀도 1건 원가. 크레딧 기록이 없으면(미설정·HTTP 오류 = 문서 없음) 0원이라 항목도 없다. */
export function shadowCostOf(res: EngineResponse): EngineCost | null {
  const credits = res.shadowChatgptWeb?.creditsUsed;
  if (!isFiniteNonNegative(credits) || credits === 0) {
    return null;
  }
  return {
    engineId: "chatgpt-web",
    krw: firecrawlCreditsKrw(credits),
    basis: "credit",
    note: `ChatGPT 웹 섀도 · Firecrawl ${credits}크레딧`,
  };
}

/**
 * api-search-v1 섀도 후보 1건 원가. 후보가 호출에 성공해 `usage` 를 남긴 경우만 항목이 생긴다
 *   (실패·중단은 과금 여부를 모르므로 항목 없음 — [확인필요], 0원이라고 단정하지도 않는다).
 *   · ChatGPT 후보: provider 보고 원가(estimated_cost) 우선 → KRW 환산(1,525/unit) → 없으면 unknown.
 *   · Gemini 후보: 모델 단가표(SHADOW_MODEL_TOKEN_PRICES) + 검색 쿼리 수 × GEMINI_SEARCH_USD_PER_QUERY.
 *     단가 미등록 모델·토큰 미측정이면 unknown(0원). **메인 gemini/chatgpt 단가를 빌리지 않는다.**
 */
export function apiSearchShadowCostOf(res: EngineResponse): EngineCost | null {
  const shadow = res.shadowApiSearch;
  const usage = shadow?.usage;
  if (!(shadow && usage) || shadow.outcome !== "ok") {
    return null;
  }
  const engineId = res.engineId;
  const label = `api-search-v1 섀도 · ${shadow.candidate} · ${shadow.model}`;
  if (isFiniteNonNegative(usage.providerCostKrw)) {
    return {
      engineId,
      krw: usage.providerCostKrw,
      basis: "token",
      note: `${label} · provider 보고 원가(1unit=${LETSUR_KRW_PER_UNIT}원 환산)`,
    };
  }
  if (isFiniteNonNegative(usage.providerCostUsd)) {
    return {
      engineId,
      krw: usage.providerCostUsd * USD_TO_KRW,
      basis: "token",
      note: `${label} · provider 보고 원가(USD, 환율 ${USD_TO_KRW})`,
    };
  }
  const price = SHADOW_MODEL_TOKEN_PRICES[shadow.model];
  if (!price) {
    return {
      engineId,
      krw: 0,
      basis: "unknown",
      note: `${label} · 모델 단가 미등록`,
    };
  }
  if (usage.inputTokens == null || usage.outputTokens == null) {
    return {
      engineId,
      krw: 0,
      basis: "unknown",
      note: `${label} · 토큰 미측정`,
    };
  }
  const queries = usage.webSearchRequests;
  const searchUsd =
    shadow.candidate === "gemini-search-v1" && isFiniteNonNegative(queries)
      ? queries * GEMINI_SEARCH_USD_PER_QUERY
      : 0;
  const usd =
    (usage.inputTokens / 1_000_000) * price.inputPerM +
    (usage.outputTokens / 1_000_000) * price.outputPerM +
    searchUsd;
  return {
    engineId,
    krw: usd * USD_TO_KRW,
    basis: "token",
    note: isFiniteNonNegative(queries)
      ? `${label} · 검색 ${queries}회`
      : `${label} · 검색 횟수 미수집(검색료 0 산입)`,
  };
}

/**
 * 업체 화면 수집 섀도 1건 원가. 성공(outcome ok·recordBilled)만 1레코드 과금 → 항목 생성.
 *   실패·중단은 미과금(업체 정책)이라 항목 없음. totalKrw 에는 넣지 않는다.
 */
export function uiVendorShadowCostOf(res: EngineResponse): EngineCost | null {
  const shadow = res.shadowUiVendor;
  if (!shadow || shadow.outcome !== "ok" || !shadow.recordBilled) {
    return null;
  }
  return {
    engineId: res.engineId,
    krw: UI_VENDOR_USD_PER_RECORD * USD_TO_KRW,
    basis: "vendor-record",
    note: `ui-vendor 섀도 · ${shadow.candidate} · 성공 1레코드 $1.50/1,000 [확인필요: 요금제·물량 단가]`,
  };
}

export function auditCost(responses: EngineResponse[]): AuditCost {
  const mainCosts = responses.map(costOf);
  const measuredEngines = mainCosts.filter(
    (c) => c.basis === "token" || c.basis === "credit" || c.basis === "browser"
  ).length;
  // 섀도 웹 수집은 점수엔 안 들어가지만 **돈은 나간다** → 별도 항목으로 총원가에 더한다.
  const shadowCosts = responses.flatMap((res) => shadowCostOf(res) ?? []);
  const perEngine = [...mainCosts, ...shadowCosts];
  const totalKrw = perEngine.reduce((sum, c) => sum + c.krw, 0);
  // api-search-v1 후보 섀도: **totalKrw·perEngine 에 넣지 않는다**(점수·주 엔진 원가와 분리).
  //   shadowKrw 와 `apiSearchShadow*` 필드로만 보고한다.
  const apiSearchCosts = responses.flatMap(
    (res) => apiSearchShadowCostOf(res) ?? []
  );
  // 업체 화면 수집 섀도도 같은 취급(totalKrw 불포함).
  const uiVendorCosts = responses.flatMap(
    (res) => uiVendorShadowCostOf(res) ?? []
  );
  const uiVendorKrw = uiVendorCosts.reduce((sum, c) => sum + c.krw, 0);
  const webShadowKrw = shadowCosts.reduce((sum, c) => sum + c.krw, 0);
  const apiSearchKrw = apiSearchCosts.reduce((sum, c) => sum + c.krw, 0);
  return {
    totalKrw,
    perEngine,
    measuredEngines,
    costModelVersion: COST_MODEL_VERSION,
    ...(shadowCosts.length > 0 ||
    apiSearchCosts.length > 0 ||
    uiVendorCosts.length > 0
      ? { shadowKrw: webShadowKrw + apiSearchKrw + uiVendorKrw }
      : {}),
    ...(uiVendorCosts.length > 0
      ? { uiVendorShadow: uiVendorCosts, uiVendorShadowKrw: uiVendorKrw }
      : {}),
    ...(apiSearchCosts.length > 0
      ? { apiSearchShadow: apiSearchCosts, apiSearchShadowKrw: apiSearchKrw }
      : {}),
  };
}
