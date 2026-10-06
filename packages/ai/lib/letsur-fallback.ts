// 🔴 Letsur 불가 → Vercel AI Gateway **명시적** 폴백 (2026-10-07 · 관제탑 요청).
//
// ## 왜 필요한가
// chatgpt·claude 엔진, 언급 판정기(verdictModel), 보조 호출(brand-identity·competitor-suggest·
// industry-profile·prompt-suggestions)이 전부 `LETSUR_API_KEY` 하나에 붙어 있다.
// Letsur 선불 유닛은 **2026-10-31 만료**이고 초과사용이 **꺼져 있다** → 유닛이 떨어지거나
// 만료되면 Letsur 가 오류를 돌려주고 위 호출이 **동시에 전부** 멈춘다.
//
// ## 📕 과거 사고(2026-07-30)가 정한 규칙
// 「조용한」 Gateway 폴백이 크레딧 오류로 실패해 측정이 통째로 실패했고, 원인이 가려졌다.
//   ① 폴백은 **Letsur 불가로 분류된 오류에서만** 한다(일시적 5xx·타임아웃은 기존 재시도 경로).
//   ② 모든 폴백은 `ai.letsur.fallback` 구조화 로그를 남긴다(비밀값·응답 본문 없음).
//   ③ Gateway 도 실패하면 **원래 Letsur 오류**를 그대로 던진다(기존 오류 처리 경로 유지).
//
// ## Letsur 오류 형태 — [확인필요]
// Letsur 공식 문서에서 「유닛 소진/만료」 응답의 정확한 상태코드·본문을 찾지 못했다
// (docs.letsur.ai 미해결 · 2026-10-07). 그래서 **보수적으로** 분류한다:
//   402                              → credit (결제 필요 = 잔액 부족의 표준 의미)
//   401 · 403                        → auth   (키 만료·권한 없음)
//   429 + 본문에 할당량/크레딧 표식      → quota  (표식 없는 429 = 일시적 속도제한 → 폴백 안 함)
//   400 + 본문에 크레딧/만료 표식        → credit (일부 게이트웨이가 400 으로 잔액 부족을 알림)
//   5xx · 타임아웃 · 네트워크 오류       → 불가 아님 (기존 재시도/오류 경로 유지)
// 실제 만료 응답을 한 번 받으면 표식을 실측값으로 좁힐 것.

import { createOpenAI } from "@ai-sdk/openai";
import { log } from "@repo/observability/log";
import { gateway, type LanguageModelMiddleware } from "ai";
import { isAbortError } from "./engines/provider-error";

type WrapGenerateArgs = Parameters<
  NonNullable<LanguageModelMiddleware["wrapGenerate"]>
>[0];
/** AI SDK provider 규격의 언어모델(LanguageModelV3). `ai` 가 직접 export 하지 않아 유도한다. */
export type ProviderLanguageModel = WrapGenerateArgs["model"];
type GenerateResult = Awaited<ReturnType<WrapGenerateArgs["doGenerate"]>>;

export const LETSUR_BASE_URL = "https://gw.letsur.ai/v1";

/** Vercel AI Gateway — Anthropic Messages 호환 엔드포인트(웹검색 서버툴 지원). */
export const GATEWAY_MESSAGES_URL = "https://ai-gateway.vercel.sh/v1/messages";

/**
 * 보조 호출(판정기·브랜드·경쟁사·업종·질문추천)의 Gateway 폴백 모델.
 * Letsur `claude-haiku-4-5-20251001` 과 같은 모델의 Gateway 표기(점 표기).
 */
export const HELPER_GATEWAY_MODEL_ID =
  process.env.FINDABLE_CREW_MODEL ?? "anthropic/claude-haiku-4.5";

export type LetsurUnavailableReason = "credit" | "auth" | "quota";

const QUOTA_MARKERS =
  /quota|credit|insufficient|balance|billing|payment|expired|usage[_ ]limit|\bunits?\b|잔액|잔량|크레딧|유닛|만료|소진|한도/i;
const CREDIT_MARKERS =
  /credit|quota|balance|expired|insufficient[_ ]funds|잔액|크레딧|유닛|만료|소진/i;

function bodyText(body: unknown): string {
  if (body == null) {
    return "";
  }
  if (typeof body === "string") {
    return body.slice(0, 4000);
  }
  try {
    return JSON.stringify(body).slice(0, 4000);
  } catch {
    return "";
  }
}

/**
 * Letsur 응답이 「Letsur 를 쓸 수 없음」(유닛 소진·만료·인증/권한)인지 분류한다.
 * `null` 이면 불가가 아니다(일시적 오류 → 기존 경로).
 */
export function classifyLetsurUnavailable(
  status: number | null | undefined,
  body?: unknown
): LetsurUnavailableReason | null {
  if (typeof status !== "number") {
    return null;
  }
  if (status === 402) {
    return "credit";
  }
  if (status === 401 || status === 403) {
    return "auth";
  }
  const text = bodyText(body);
  if (status === 429) {
    return QUOTA_MARKERS.test(text) ? "quota" : null;
  }
  if (status === 400 && CREDIT_MARKERS.test(text)) {
    return "credit";
  }
  return null;
}

/** 분류기 — 상태코드(+본문)가 Letsur 불가면 true. */
export function isLetsurUnavailable(
  status: number | null | undefined,
  body?: unknown
): boolean {
  return classifyLetsurUnavailable(status, body) !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** AI SDK 오류(APICallError · RetryError.lastError)에서 Letsur 불가 사유를 뽑는다. */
export function letsurUnavailableReasonFromError(
  error: unknown
): LetsurUnavailableReason | null {
  const final =
    isRecord(error) && "lastError" in error ? error.lastError : error;
  if (!isRecord(final)) {
    return null;
  }
  const status =
    typeof final.statusCode === "number" ? final.statusCode : undefined;
  return classifyLetsurUnavailable(status, final.responseBody);
}

// ──────────────────────────────────────────────────────────────────
// 프로세스 단위 차단기: 한 번 「Letsur 불가」를 보면 N분 동안 Letsur 를 건너뛴다.
//   매 호출마다 실패하는 Letsur 를 먼저 두드려 지연을 치르지 않기 위함.
// ──────────────────────────────────────────────────────────────────
const DEFAULT_SKIP_MINUTES = 10;
let circuitOpenUntil = 0;

function skipWindowMs(): number {
  const raw = Number(process.env.FINDABLE_LETSUR_SKIP_MINUTES);
  const minutes = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_SKIP_MINUTES;
  return minutes * 60_000;
}

export function isLetsurCircuitOpen(now: number = Date.now()): boolean {
  return now < circuitOpenUntil;
}

/** 차단기를 연다. 이미 열린 창 안이면 아무것도 안 한다(= 창당 로그 1회). */
export function tripLetsurCircuit(
  reason: LetsurUnavailableReason,
  callSite: string,
  now: number = Date.now()
): void {
  if (isLetsurCircuitOpen(now)) {
    return;
  }
  const windowMs = skipWindowMs();
  circuitOpenUntil = now + windowMs;
  log.warn("ai.letsur.circuit_open", {
    callSite,
    reason,
    skipMinutes: windowMs / 60_000,
  });
}

/** 테스트 전용. */
export function resetLetsurCircuit(): void {
  circuitOpenUntil = 0;
}

/**
 * Gateway 인증이 있을 법한가. AI_GATEWAY_API_KEY(정적 키) · VERCEL_OIDC_TOKEN(로컬 pull) ·
 * Vercel 런타임(VERCEL=1 — OIDC 토큰을 런타임이 공급) 중 하나.
 * ⚠️ 이건 「인증 수단이 있다」일 뿐 「크레딧이 있다」가 아니다 — 크레딧 0 이면 Gateway 도 실패하고,
 *   그때는 원래 Letsur 오류가 그대로 나간다(outcome: failed 로그).
 */
export function isGatewayFallbackAvailable(): boolean {
  return (
    Boolean(process.env.AI_GATEWAY_API_KEY) ||
    Boolean(process.env.VERCEL_OIDC_TOKEN) ||
    process.env.VERCEL === "1"
  );
}

export type LetsurFallbackReason = LetsurUnavailableReason | "circuit_open";

export interface LetsurFallbackContext {
  callSite: string;
  engineId?: string;
}

export function logLetsurFallback(
  ctx: LetsurFallbackContext,
  reason: LetsurFallbackReason,
  outcome: "ok" | "failed"
): void {
  log.warn("ai.letsur.fallback", {
    callSite: ctx.callSite,
    ...(ctx.engineId ? { engineId: ctx.engineId } : {}),
    reason,
    outcome,
  });
}

/**
 * 같은 논리 호출을 Letsur → (불가면) Gateway 로 보낸다.
 *   · 차단기 열림: Letsur 를 건너뛰고 Gateway. Gateway 가 실패하면 Letsur 를 한 번 시도해
 *     **원래 경로의 오류**를 돌려준다(Letsur 가 그새 회복했으면 그대로 성공).
 *   · Letsur 오류가 불가로 분류되지 않으면(5xx 등) 원래 오류를 그대로 던진다.
 *   · Gateway 도 실패하면 원래 Letsur 오류를 던진다.
 */
export async function runWithLetsurFallback<T>(
  ctx: LetsurFallbackContext,
  callLetsur: () => PromiseLike<T>,
  callGateway: () => PromiseLike<T>
): Promise<T> {
  if (isLetsurCircuitOpen() && isGatewayFallbackAvailable()) {
    try {
      return await callGateway();
    } catch (gatewayError) {
      if (isAbortError(gatewayError)) {
        throw gatewayError;
      }
      logLetsurFallback(ctx, "circuit_open", "failed");
      return await callLetsur();
    }
  }
  try {
    return await callLetsur();
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    const reason = letsurUnavailableReasonFromError(error);
    if (!reason) {
      throw error;
    }
    tripLetsurCircuit(reason, ctx.callSite);
    if (!isGatewayFallbackAvailable()) {
      logLetsurFallback(ctx, reason, "failed");
      throw error;
    }
    try {
      const result = await callGateway();
      logLetsurFallback(ctx, reason, "ok");
      return result;
    } catch (gatewayError) {
      if (isAbortError(gatewayError)) {
        throw gatewayError;
      }
      logLetsurFallback(ctx, reason, "failed");
      throw error;
    }
  }
}

/** Gateway 폴백 결과에 붙이는 표식(`providerMetadata.findable`). */
export interface GatewayFallbackInfo {
  fallback: "gateway";
  modelId: string;
  provider: "gateway";
}

/** generateText/generateObject 결과의 providerMetadata 에서 폴백 표식을 읽는다. */
export function readGatewayFallback(
  providerMetadata: unknown
): GatewayFallbackInfo | null {
  const findable = isRecord(providerMetadata)
    ? providerMetadata.findable
    : undefined;
  if (
    isRecord(findable) &&
    findable.fallback === "gateway" &&
    typeof findable.modelId === "string"
  ) {
    return {
      fallback: "gateway",
      provider: "gateway",
      modelId: findable.modelId,
    };
  }
  return null;
}

function markGatewayResult(
  result: GenerateResult,
  modelId: string
): GenerateResult {
  return {
    ...result,
    providerMetadata: {
      ...result.providerMetadata,
      findable: { fallback: "gateway", provider: "gateway", modelId },
    },
  };
}

export interface LetsurFallbackOptions extends LetsurFallbackContext {
  /** Gateway 쪽 모델 슬러그(점 표기). 예: anthropic/claude-sonnet-4.6 */
  gatewayModelId: string;
}

/**
 * Letsur 모델을 감싸, Letsur 불가 오류에서 같은 호출 인자를 Gateway 모델로 다시 보낸다.
 * 모델 단위로 감싸므로 generateText·generateObject·streamText 어디서 쓰든 같은 규칙이 적용된다.
 * ⚠️ AI SDK 의 재시도는 이 모델 바깥에서 돈다 → 5xx 는 여기서 그대로 던져 기존 재시도를 탄다.
 */
export function withLetsurFallback(
  primary: ProviderLanguageModel,
  options: LetsurFallbackOptions
): ProviderLanguageModel {
  const { gatewayModelId } = options;
  const gatewayModel = (): ProviderLanguageModel =>
    gateway(gatewayModelId) as ProviderLanguageModel;
  return {
    specificationVersion: primary.specificationVersion,
    provider: primary.provider,
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,
    doGenerate: (params) =>
      runWithLetsurFallback(
        options,
        () => primary.doGenerate(params),
        async () =>
          markGatewayResult(
            await gatewayModel().doGenerate(params),
            gatewayModelId
          )
      ),
    doStream: (params) =>
      runWithLetsurFallback(
        options,
        () => primary.doStream(params),
        () => gatewayModel().doStream(params)
      ),
  };
}

/**
 * `LETSUR_API_KEY` 가 있으면 Letsur 모델(+Gateway 폴백)을, 없으면 `null` 을 돌려준다.
 * 보조 호출들이 같은 4줄(createOpenAI + baseURL)을 복제하던 것을 한 곳으로 모은다.
 */
export function letsurModelWithFallback(
  letsurModelId: string,
  options: LetsurFallbackOptions
): ProviderLanguageModel | null {
  const apiKey = process.env.LETSUR_API_KEY;
  if (!apiKey) {
    return null;
  }
  const letsur = createOpenAI({ baseURL: LETSUR_BASE_URL, apiKey });
  return withLetsurFallback(letsur(letsurModelId), options);
}
