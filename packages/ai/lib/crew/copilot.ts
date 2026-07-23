// Findable 코파일럿 챗 — 진단 결과를 대화로 풀어주는 단일 GEO 코파일럿
//
// 4 에이전트(민지·Alex·수진·준호)의 진단 결과(crewResult) + 원천 지표(metrics)를
// 시스템 컨텍스트로 주입한 뒤, 사용자의 "그래서 뭘 고쳐야 해?" 질문에 답한다.
// 에이전트를 질문마다 라우팅하지 않고, 하나의 코파일럿이 4명의 결과를 통합해 답한다.
//
// 서버 스트리밍 라우트(apps/web .../chat/route.ts)에서 이 모듈의
// COPILOT_MODEL_ID + buildCopilotSystemPrompt()를 재사용한다.
//
// 인증: crew와 동일하게 AI Gateway 경유 (VERCEL_OIDC_TOKEN / AI_GATEWAY_API_KEY).

import { gateway, streamText } from "ai";
import type { AnalystOutput, StrategistOutput } from "./agents";
import { FINDABLE_MODEL_DEFAULT } from "./agents";

// 코파일럿 모델 — crew 기본 모델과 동일 슬러그. 환경변수로 override 가능.
export const COPILOT_MODEL_ID: string =
  process.env.FINDABLE_COPILOT_MODEL ?? FINDABLE_MODEL_DEFAULT;

/**
 * AI Gateway 인증 가능 여부 (orchestrator와 동일 우선순위).
 * 미설정 시 라우트가 503으로 폴백해 stub 안내.
 */
export function isCopilotConfigured(): boolean {
  return (
    Boolean(process.env.AI_GATEWAY_API_KEY) ||
    Boolean(process.env.VERCEL_OIDC_TOKEN) ||
    process.env.FINDABLE_FORCE_LIVE === "1"
  );
}

// ──────────────────────────────────────────────────────────────────
// 컨텍스트 입력 타입 — 클라이언트가 이미 보유한 crewResult·metrics를 그대로 전달
// (audit-result.tsx의 CrewReport / JobResult와 형태 일치. 라우트에서 검증)
// ──────────────────────────────────────────────────────────────────

export interface CopilotAnalyst {
  displayName: string;
  output: AnalystOutput | null;
  role: string;
}

export interface CopilotStrategist {
  displayName: string;
  output: StrategistOutput | null;
  role: string;
}

export interface CopilotContext {
  analysts: CopilotAnalyst[];
  brandName: string;
  domain: string;
  /** SoV·mention·sentiment 요약 (사람이 읽을 수 있게 라우트에서 조립) */
  metricsSummary: string;
  strategist: CopilotStrategist | null;
}

// ──────────────────────────────────────────────────────────────────
// 시스템 프롬프트 조립 — 진단 결과 전체를 평문으로 직렬화해 컨텍스트로 주입
// ──────────────────────────────────────────────────────────────────

function serializeAnalyst(a: CopilotAnalyst): string {
  if (!a.output) {
    return `### ${a.displayName} (${a.role})\n(분석 결과 없음)`;
  }
  const findings = a.output.findings
    .map(
      (f, i) =>
        `  ${i + 1}. [${f.severity.toUpperCase()}] ${f.title} — ${f.whyItMatters}\n     ${f.detail}`
    )
    .join("\n");
  const gaps =
    a.output.dataGaps.length > 0
      ? `\n  데이터 공백: ${a.output.dataGaps.join(", ")}`
      : "";
  return `### ${a.displayName} (${a.role})
요약: ${a.output.executiveSummary}
발견:
${findings}
관찰: ${a.output.observation}${gaps}`;
}

function serializeStrategist(s: CopilotStrategist | null): string {
  if (!s?.output) {
    return "### 준호 — 액션 전략가\n(액션 결과 없음)";
  }
  const monday = s.output.mondayActionOne;
  const actions = s.output.topActions
    .map(
      (act) =>
        `  #${act.rank} [${act.channel}] ${act.title} (impact ${act.impact}/5, effort ${act.effort}/5, ${act.expectedTimeframe})\n     근거: ${act.rationale}\n     단계: ${act.steps.join(" → ")}`
    )
    .join("\n");
  return `### ${s.displayName} (${s.role})
요약: ${s.output.executiveSummary}
★ 이번 주 월요일 액션: ${monday.title}
   왜 이것부터: ${monday.whyThisOne}
   예상 결과: ${monday.expectedOutcome}
우선순위 액션:
${actions}`;
}

/**
 * 진단 결과 전체를 시스템 프롬프트로 조립.
 * 코파일럿은 이 컨텍스트 안에서만 답하며, 밖의 사실을 지어내지 않는다.
 */
export function buildCopilotSystemPrompt(ctx: CopilotContext): string {
  return `당신은 Findable의 GEO 코파일럿입니다. 방금 "${ctx.brandName}" (${ctx.domain}) 브랜드에 대해 4명의 전문 에이전트가 AI 검색 가시성(GEO)을 진단했고, 그 결과가 아래에 전부 주어졌습니다. 사용자는 이 진단 결과를 놓고 "그래서 뭘 어떻게 고쳐야 하나"를 물어봅니다.

## 당신의 역할
- 4 에이전트(한국 엔진 담당 민지 · 글로벌 담당 Alex · 인용 출처 담당 수진 · 액션 담당 준호)의 진단을 **통합해** 답한다. 특정 에이전트로 넘기지 않는다.
- 사용자가 진단 결과를 실제 **의사결정·실행**으로 옮기도록 돕는다. "측정"이 아니라 "그래서 뭘 할까"가 목적이다.
- 답변 근거는 반드시 아래 진단 데이터에서 인용한다 ("준호의 액션 분석에 따르면...", "민지 분석상 HyperCLOVA에서...").

## 절대 규칙
- **진단 데이터에 없는 사실을 지어내지 않는다.** 데이터에 없으면 "이번 진단에는 그 정보가 없습니다"라고 말한다.
- 한국어 정중·간결 ("~합니다" 존댓말). 미사여구·추상 표현 금지, 동사+구체 명사.
- 마크다운 헤더·테이블·이모지 금지. 짧은 문단과 필요 시 번호 목록만.
- 액션을 물으면 준호의 우선순위(impact×effort)를 근거로 구체적으로 답한다.

## 진단 대상
브랜드: ${ctx.brandName}
도메인: ${ctx.domain}

## 측정 지표
${ctx.metricsSummary}

## 4 에이전트 진단 결과
${ctx.analysts.map(serializeAnalyst).join("\n\n")}

${serializeStrategist(ctx.strategist)}`;
}

// ──────────────────────────────────────────────────────────────────
// 스트리밍 응답 — AI SDK 의존성을 @repo/ai 안에 가둠 (앱은 ai를 직접 import 안 함)
// ──────────────────────────────────────────────────────────────────

export interface CopilotChatMessage {
  content: string;
  role: "user" | "assistant";
}

/**
 * 코파일럿 응답을 순수 텍스트로 스트리밍하는 Response 생성.
 * 클라이언트는 @ai-sdk/react 없이 fetch + ReadableStream으로 직접 읽는다.
 */
export function streamCopilotResponse(
  ctx: CopilotContext,
  messages: CopilotChatMessage[]
): Response {
  const stream = streamText({
    model: gateway(COPILOT_MODEL_ID),
    system: buildCopilotSystemPrompt(ctx),
    messages,
  });
  return stream.toTextStreamResponse();
}
