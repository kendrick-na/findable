// 글로벌 4 엔진 어댑터 — Vercel AI Gateway 사용
//
// AI SDK v6: plain `"provider/model"` 문자열을 model 인자로 전달하면
// Gateway로 자동 라우팅 (gateway() 래퍼 불필요).
//
// 인증 (우선순위):
//   1. VERCEL_OIDC_TOKEN  ← 권장. Vercel 프로젝트에 연결 후 `vercel env pull .env.local`
//      자동 프로비저닝. 약 24시간 유효, 배포 시 자동 갱신, 수동 로테이션 불필요.
//   2. (fallback) 정적 키 — CI/비-Vercel 환경 등 OIDC 사용 불가 시에만.
//
// 둘 다 미설정 시 stub 응답 반환.
//
// 모델 슬러그 규칙: 버전은 점(.) 사용, 하이픈 X. 예: anthropic/claude-sonnet-4.6

import { generateText } from "ai";
import type { EngineAdapter, EngineId, EngineResponse } from "./types";
import {
  detectBrandMention,
  estimateMentionPosition,
  estimateSentiment,
  estimateShareOfVoice,
  extractCitedSources,
} from "./utils";

// 최신 모델 ID는 `gateway.getAvailableModels()` 또는
// curl https://ai-gateway.vercel.sh/v1/models 로 확인 후 ENV에 주입 권장.
const MODEL_DEFAULTS: Record<Extract<EngineId, "chatgpt" | "claude" | "perplexity" | "gemini">, string> = {
  chatgpt: process.env.FINDABLE_MODEL_CHATGPT ?? "openai/gpt-5.4",
  claude: process.env.FINDABLE_MODEL_CLAUDE ?? "anthropic/claude-sonnet-4.6",
  perplexity: process.env.FINDABLE_MODEL_PERPLEXITY ?? "perplexity/sonar",
  gemini: process.env.FINDABLE_MODEL_GEMINI ?? "google/gemini-2.5-flash",
};

const STUB_NOTICE =
  "[STUB] AI Gateway 인증 미설정 (VERCEL_OIDC_TOKEN 권장). 실제 엔진 호출 없이 더미 응답을 반환합니다.";

function makeStubResponse(engineId: EngineId, prompt: string, durationMs: number): EngineResponse {
  return {
    engineId,
    rawResponse: `${STUB_NOTICE}\n질의: ${prompt.slice(0, 200)}`,
    brandMentioned: false,
    mentionPosition: null,
    sentiment: null,
    citedSources: [],
    shareOfVoice: null,
    errorMessage: null,
    durationMs,
    isStub: true,
  };
}

function isGatewayConfigured(): boolean {
  // 인증 우선순위 (AI SDK v6 기본 동작):
  //   1. AI_GATEWAY_API_KEY — Vercel Dashboard에서 발급한 정적 키. production 권장.
  //   2. VERCEL_OIDC_TOKEN — 로컬 개발용. `vercel env pull` 자동 프로비저닝.
  //   3. FINDABLE_FORCE_LIVE=1 — 강제 라이브 모드.
  return (
    Boolean(process.env.AI_GATEWAY_API_KEY) ||
    Boolean(process.env.VERCEL_OIDC_TOKEN) ||
    process.env.FINDABLE_FORCE_LIVE === "1"
  );
}

function makeGatewayAdapter(
  engineId: Extract<EngineId, "chatgpt" | "claude" | "perplexity" | "gemini">
): EngineAdapter {
  return async (query) => {
    const start = Date.now();

    if (!isGatewayConfigured()) {
      return makeStubResponse(engineId, query.prompt, Date.now() - start);
    }

    const modelId = MODEL_DEFAULTS[engineId];

    try {
      // plain string으로 model 전달 → AI SDK v6가 Gateway로 자동 라우팅.
      const { text } = await generateText({
        model: modelId,
        system:
          query.language === "ko"
            ? "당신은 한국어 사용자를 위한 검색 어시스턴트입니다. 사실 기반으로 답하고, 구체적인 브랜드와 출처를 명시하세요."
            : "You are a search assistant. Provide factual, brand-aware answers with concrete recommendations and sources when available.",
        prompt: query.prompt,
        providerOptions: {
          gateway: {
            tags: ["findable", `engine:${engineId}`, `lang:${query.language}`],
          },
        },
      });

      const mention = detectBrandMention(text, query.brandName, query.brandVariants);
      return {
        engineId,
        rawResponse: text,
        brandMentioned: mention.mentioned,
        mentionPosition: estimateMentionPosition(text, query.brandName, query.brandVariants),
        sentiment: estimateSentiment(text, query.brandName),
        citedSources: extractCitedSources(text),
        shareOfVoice: estimateShareOfVoice(text, query.brandName, query.brandVariants),
        errorMessage: null,
        durationMs: Date.now() - start,
        isStub: false,
      };
    } catch (error) {
      return {
        engineId,
        rawResponse: "",
        brandMentioned: false,
        mentionPosition: null,
        sentiment: null,
        citedSources: [],
        shareOfVoice: null,
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
        isStub: false,
      };
    }
  };
}

export const chatgptAdapter: EngineAdapter = makeGatewayAdapter("chatgpt");
export const claudeAdapter: EngineAdapter = makeGatewayAdapter("claude");
export const perplexityAdapter: EngineAdapter = makeGatewayAdapter("perplexity");
export const geminiAdapter: EngineAdapter = makeGatewayAdapter("gemini");
