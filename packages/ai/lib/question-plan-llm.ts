// 질문 계획 v2 보조 LLM 호출 (2026-10-07 · 대표 승인 「질문 개선」, 그림자 전용)
//
// 브랜드 프로필 구조화 · 질문 후보 다듬기 · 후보 심사(judge) 세 군데가 같은 통로를 쓴다.
//   · 모델 = 다른 보조 호출(판정기·업종·브랜드)과 같은 Letsur haiku → Letsur 불가면 Gateway 폴백
//     (letsur-fallback.ts 규칙 그대로). Letsur 키가 없으면 Gateway 인증이 있을 때만 Gateway 직행.
//     둘 다 없으면 throw — 호출한 쪽이 규칙 기반 결과로 돌아간다(fail-open).
//   · 출력은 **글자 그대로** 돌려준다. JSON 해석·zod 검증은 호출한 쪽(packages/audit)이 한다 —
//     검증 실패를 「규칙 기반으로 돌아가기」로 처리하려면 검증 지점이 그쪽에 있어야 한다.
//   · 원가 = 토큰 × claude-haiku-4.5 정가(입력 $1 · 출력 $5 / 1M — engines/cost.ts 의 Gateway 단가표와 같다).
//     ⚠️ FINDABLE_CREW_LETSUR_MODEL 로 다른 모델을 쓰면 이 원가는 haiku 기준 추정이 된다.

import { gateway, generateText, type LanguageModel } from "ai";
import { USD_TO_KRW } from "./engines/cost";
import {
  HELPER_GATEWAY_MODEL_ID,
  isGatewayFallbackAvailable,
  letsurModelWithFallback,
  readGatewayFallback,
} from "./letsur-fallback";

const LETSUR_MODEL_ID =
  process.env.FINDABLE_CREW_LETSUR_MODEL ?? "claude-haiku-4-5-20251001";

/** claude-haiku-4.5 정가(USD / 1M tokens) — engines/cost.ts GATEWAY_MODEL_PRICES 와 같은 값. */
const HAIKU_INPUT_USD_PER_M = 1;
const HAIKU_OUTPUT_USD_PER_M = 5;

export interface QuestionPlanLlmRequest {
  /** 로그·폴백 기록용 호출 위치(예: "question-plan.profile"). */
  callSite: string;
  maxOutputTokens: number;
  prompt: string;
  signal?: AbortSignal;
  system: string;
  temperature?: number;
}

export interface QuestionPlanLlmResponse {
  costKrw: number;
  inputTokens: number | null;
  modelId: string;
  outputTokens: number | null;
  route: "letsur" | "gateway";
  text: string;
}

function helperModel(
  callSite: string
): { model: LanguageModel; route: "letsur" | "gateway" } | null {
  const letsur = letsurModelWithFallback(LETSUR_MODEL_ID, {
    callSite,
    gatewayModelId: HELPER_GATEWAY_MODEL_ID,
  });
  if (letsur) {
    return { model: letsur, route: "letsur" };
  }
  if (isGatewayFallbackAvailable()) {
    return { model: gateway(HELPER_GATEWAY_MODEL_ID), route: "gateway" };
  }
  return null;
}

/** 토큰 수 → 원(KRW). 토큰을 못 받았으면 0(지어내지 않는다). */
export function helperCostKrw(
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined
): number {
  const input = typeof inputTokens === "number" ? inputTokens : 0;
  const output = typeof outputTokens === "number" ? outputTokens : 0;
  const usd =
    (input * HAIKU_INPUT_USD_PER_M + output * HAIKU_OUTPUT_USD_PER_M) /
    1_000_000;
  return usd * USD_TO_KRW;
}

/** 보조 모델 1회 호출. 모델이 없거나 호출이 실패하면 throw(호출한 쪽이 규칙 기반으로 돌아간다). */
export async function questionPlanLlmCall(
  request: QuestionPlanLlmRequest
): Promise<QuestionPlanLlmResponse> {
  const picked = helperModel(request.callSite);
  if (!picked) {
    throw new Error("question_plan_llm_unavailable");
  }
  const result = await generateText({
    model: picked.model,
    system: request.system,
    prompt: request.prompt,
    maxOutputTokens: request.maxOutputTokens,
    temperature: request.temperature ?? 0,
    abortSignal: request.signal,
  });
  const inputTokens = result.usage?.inputTokens ?? null;
  const outputTokens = result.usage?.outputTokens ?? null;
  const viaGateway =
    picked.route === "gateway" ||
    readGatewayFallback(result.providerMetadata) !== null;
  return {
    text: result.text,
    inputTokens,
    outputTokens,
    route: viaGateway ? "gateway" : "letsur",
    modelId: viaGateway ? HELPER_GATEWAY_MODEL_ID : LETSUR_MODEL_ID,
    costKrw: helperCostKrw(inputTokens, outputTokens),
  };
}
