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
// ⚠️ chatgpt·claude 는 실제로는 Letsur 게이트웨이로 청구된다 — 아래는 **원 제공사 공식 정가**다.
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
 * ⚠️ chatgpt 는 검색 도구를 붙이지 않는다(Chat Completions 호출) → 검색료 없음.
 *    gemini 그라운딩은 플래그 기본 off 이고 엔진 자체가 무료 티어로 잡힌다 — 켜면 재검토.
 */
const WEB_SEARCH_USD_PER_REQUEST: Partial<Record<EngineId, number>> = {
  claude: 10 / 1000,
  perplexity: 0.0025,
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
  basis: "token" | "credit" | "browser" | "free" | "unknown";
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

function tokenCost(res: EngineResponse): EngineCost {
  const { engineId, usage } = res;
  // provider 가 직접 계산한 원가가 있으면 그게 정답이다(토큰·도구료 포함).
  if (isFiniteNonNegative(usage?.providerCostUsd)) {
    return {
      engineId,
      krw: usage.providerCostUsd * USD_TO_KRW,
      basis: "token",
      note: "provider 보고 원가(USD)",
    };
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

// EngineResponse 1건 → 원가(KRW). usage 없으면 costModel 로 근사.
export function costOf(res: EngineResponse): EngineCost {
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
  if (
    engineId === "gemini" ||
    engineId === "daum" ||
    engineId === "chatgpt-web"
  ) {
    return "free"; // gemini=무료티어, daum=검색스크랩, chatgpt-web=웹UI(베타·미과금)
  }
  if (TOKEN_PRICES[engineId]) {
    return "token";
  }
  return "unknown";
}

// 진단 1건(여러 엔진) 총원가 합산.
export interface AuditCost {
  costModelVersion: number; // 이 합계를 낸 원가 규칙 버전(COST_MODEL_VERSION)
  measuredEngines: number; // token/credit/browser 로 실제 산정된 엔진 수
  perEngine: EngineCost[];
  totalKrw: number;
}

export function auditCost(responses: EngineResponse[]): AuditCost {
  const perEngine = responses.map(costOf);
  const totalKrw = perEngine.reduce((sum, c) => sum + c.krw, 0);
  const measuredEngines = perEngine.filter(
    (c) => c.basis === "token" || c.basis === "credit" || c.basis === "browser"
  ).length;
  return {
    totalKrw,
    perEngine,
    measuredEngines,
    costModelVersion: COST_MODEL_VERSION,
  };
}
