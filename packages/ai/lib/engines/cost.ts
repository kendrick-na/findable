// 엔진 원가 계기 — 유닛이코노믹스(진단 1건당 실비용) 산정.
//
// 원가 동인 3종:
//   token   : LLM API. inputTokens/outputTokens × 모델 단가.
//   browser : Browserbase(naver-briefing). 세션시간 과금 → durationMs 근사.
//   free    : 무료 티어(gemini Google 1,500/일, naver Search API 무료분).
//
// ⚠️ 단가는 2026-07 기준 추정. 실제 청구서로 주기적 보정 필요(값만 여기서 수정).
//    LLM 단가 = USD per 1M tokens. 환율은 USD_TO_KRW 로 일괄 환산.

import type { EngineId, EngineResponse } from "./types";

// USD→KRW 환율(보정 지점).
export const USD_TO_KRW = 1380;

// 모델별 USD/1M tokens (input, output). 슬러그는 global/korean adapter 기본값 기준.
// 값은 공개 가격표 기반 추정 — 청구서로 보정할 것.
interface TokenPrice {
  inputPerM: number; // USD / 1M input tokens
  outputPerM: number; // USD / 1M output tokens
}

// engineId → 단가. token 과금 엔진만.
const TOKEN_PRICES: Partial<Record<EngineId, TokenPrice>> = {
  // OpenAI gpt-5.4 계열(추정). 실단가는 청구서 보정.
  chatgpt: { inputPerM: 2.5, outputPerM: 10 },
  // Anthropic claude-sonnet-4.6(추정).
  claude: { inputPerM: 3, outputPerM: 15 },
  // Perplexity sonar(추정, 요청료 별도 있을 수 있음).
  perplexity: { inputPerM: 1, outputPerM: 1 },
  // HyperCLOVA X HCX-DASH-002 — CLOVA Studio 공개가(추정, KRW 표기라 USD 환산 역산).
  hyperclova: { inputPerM: 0.4, outputPerM: 1.2 },
  // naver = Search API(무료분) + HyperCLOVA 합성. 합성 토큰만 과금 → hyperclova 단가 준용.
  naver: { inputPerM: 0.4, outputPerM: 1.2 },
};

// Browserbase 세션 대략 단가(USD/분). 추정 — 청구서 보정.
const BROWSERBASE_USD_PER_MIN = 0.1;

export interface EngineCost {
  basis: "token" | "browser" | "free" | "unknown";
  engineId: EngineId;
  krw: number; // 이 엔진 호출 1회 원가(KRW)
  note?: string;
}

// EngineResponse 1건 → 원가(KRW). usage 없으면 costModel 로 근사.
export function costOf(res: EngineResponse): EngineCost {
  const { engineId, usage, durationMs } = res;

  // stub·에러는 원가 0 (실호출 안 함).
  if (res.isStub || res.errorMessage) {
    return { engineId, krw: 0, basis: "free", note: "stub/error=미과금" };
  }

  const costModel = usage?.costModel ?? inferCostModel(engineId);

  if (costModel === "free") {
    return { engineId, krw: 0, basis: "free" };
  }

  if (costModel === "browser") {
    const minutes = durationMs / 60_000;
    const krw = minutes * BROWSERBASE_USD_PER_MIN * USD_TO_KRW;
    return { engineId, krw, basis: "browser", note: `${durationMs}ms 세션` };
  }

  if (costModel === "token") {
    const price = TOKEN_PRICES[engineId];
    if (!(price && usage?.inputTokens != null && usage?.outputTokens != null)) {
      return { engineId, krw: 0, basis: "unknown", note: "토큰/단가 미측정" };
    }
    const usd =
      (usage.inputTokens / 1_000_000) * price.inputPerM +
      (usage.outputTokens / 1_000_000) * price.outputPerM;
    return { engineId, krw: usd * USD_TO_KRW, basis: "token" };
  }

  return { engineId, krw: 0, basis: "unknown" };
}

// usage 가 없을 때 engineId 로 과금 방식 추정.
function inferCostModel(engineId: EngineId): EngineCost["basis"] {
  if (engineId === "naver-briefing") {
    return "browser";
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
  measuredEngines: number; // token/browser 로 실제 산정된 엔진 수
  perEngine: EngineCost[];
  totalKrw: number;
}

export function auditCost(responses: EngineResponse[]): AuditCost {
  const perEngine = responses.map(costOf);
  const totalKrw = perEngine.reduce((sum, c) => sum + c.krw, 0);
  const measuredEngines = perEngine.filter(
    (c) => c.basis === "token" || c.basis === "browser"
  ).length;
  return { totalKrw, perEngine, measuredEngines };
}
