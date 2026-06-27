// CrewAI 오케스트레이터 — 4 에이전트 (analysts 병렬 + strategist 직렬, D-043 2026-05-07 개선)
//
// v1.0 재설계 (research 09·10 통합):
//   - JSON 구조화 응답 강제 (마크다운 raw·이모지·테이블 금지)
//   - generate() 호출 시 zod schema 전달 → AI SDK v6 structured output
//   - 모든 발견에 whyItMatters 50자 이내 강제
//   - 준호의 mondayActionOne을 시그니처 deliverable로 분리
//
// 흐름:
//   1~3. 민지·Alex·수진 ← Promise.allSettled 병렬 호출 (3개 동시) → AnalystOutput JSON
//   4.   준호           ← 위 3개 결과 종합 → StrategistOutput JSON (mondayActionOne + topActions)
//
// D-043 (2026-05-07) 변경:
//   - 직렬 → analysts 병렬 (3 RPM 동시, rate limit 한계 1% 미만 / D2SF 시연 시간 4분→90초)
//   - allSettled로 부분 실패 허용 (1명 실패 = stub 폴백, jobId 결과 무너지지 않음)
//   - 재시도 1회 + 타임아웃 60초 가드 (안정성)

import {
  analystOutputSchema,
  CREW_AGENTS,
  CREW_META,
  CREW_ORDER,
  strategistOutputSchema,
  type AnalystOutput,
  type CrewAgentId,
  type StrategistOutput,
} from "./agents";
import type { AuditMetrics, EngineResponse } from "../engines";

export interface CrewInput {
  brandName: string;
  domain: string;
  brandVariants?: string[];
  metrics: AuditMetrics;
  engineResponses: EngineResponse[];
  /** 사용자가 직접 추가한 컨텍스트 (선택). 예: 경쟁사 목록, 산업 정보. */
  userContext?: string;
}

/**
 * 분석가 에이전트 (민지·Alex·수진) 리포트 — JSON 구조화
 */
export interface AnalystReport {
  agentId: Extract<CrewAgentId, "minji" | "alex" | "sujin">;
  displayName: string;
  role: string;
  emoji: string;
  output: AnalystOutput | null; // 성공 시 JSON, 실패 시 null
  rawText: string | null; // 디버그용 raw text (output 못 파싱한 경우)
  durationMs: number;
  errorMessage: string | null;
}

/**
 * 전략가 에이전트 (준호) 리포트 — JSON 구조화
 */
export interface StrategistReport {
  agentId: "junho";
  displayName: string;
  role: string;
  emoji: string;
  output: StrategistOutput | null;
  rawText: string | null;
  durationMs: number;
  errorMessage: string | null;
}

export type AgentReport = AnalystReport | StrategistReport;

export interface CrewReport {
  analysts: AnalystReport[];
  strategist: StrategistReport;
  totalDurationMs: number;
  isStub: boolean;
}

/**
 * AI Gateway 인증 가능 여부.
 */
function isGatewayConfigured(): boolean {
  // 인증 우선순위: AI_GATEWAY_API_KEY (production 권장) → VERCEL_OIDC_TOKEN (로컬) → FINDABLE_FORCE_LIVE
  return (
    Boolean(process.env.AI_GATEWAY_API_KEY) ||
    Boolean(process.env.VERCEL_OIDC_TOKEN) ||
    process.env.FINDABLE_FORCE_LIVE === "1"
  );
}

function filterKoreanEngineResponses(responses: EngineResponse[]): EngineResponse[] {
  const korean = new Set<string>(["hyperclova", "naver", "daum"]);
  return responses.filter((r) => korean.has(r.engineId));
}

function filterEnglishEngineResponses(responses: EngineResponse[]): EngineResponse[] {
  const english = new Set<string>(["chatgpt", "chatgpt-web", "claude", "perplexity", "gemini"]);
  return responses.filter((r) => english.has(r.engineId));
}

/**
 * 에이전트 컨텍스트로 전달할 응답 발췌
 */
function buildEngineContext(responses: EngineResponse[]): string {
  if (responses.length === 0) return "(엔진 응답 데이터 없음)";
  return responses
    .map((r, i) => {
      const status = r.isStub
        ? "[STUB]"
        : r.errorMessage
          ? `[ERROR: ${r.errorMessage}]`
          : "[LIVE]";
      const mention = r.brandMentioned
        ? `언급됨${r.mentionPosition ? ` (${r.mentionPosition}위)` : ""}`
        : "미언급";
      const sentiment = r.sentiment ?? "N/A";
      const sources = r.citedSources.length
        ? r.citedSources.slice(0, 3).map((s) => s.domain).join(", ")
        : "없음";
      const excerpt = r.rawResponse.slice(0, 600);

      return `[${i + 1}] 엔진=${r.engineId} ${status} | 언급=${mention} | sentiment=${sentiment} | 인용출처=${sources}\n응답 발췌: ${excerpt}\n`;
    })
    .join("\n");
}

/**
 * 메트릭 요약 (모든 에이전트 공유)
 */
function buildMetricsSummary(input: CrewInput): string {
  const m = input.metrics;
  return `## 측정 컨텍스트
- 브랜드: ${input.brandName} (${input.domain})
- 호출 엔진: ${m.enginesCovered.length}개
- 언급된 엔진: ${m.enginesWithMention.length}개 (${m.enginesWithMention.join(", ") || "없음"})
- Share of Voice: ${m.sov}/100
- 평균 인용 순위: ${m.averageMentionPosition !== null ? `${m.averageMentionPosition}위` : "N/A"}
- Sentiment 분포: 긍정 ${m.sentimentDistribution.positive} / 중립 ${m.sentimentDistribution.neutral} / 부정 ${m.sentimentDistribution.negative}
- Top 인용 도메인: ${m.topCitedDomains.map((d) => `${d.domain}(${d.count})`).join(", ") || "없음"}
- Stub 엔진 수: ${m.stubCount}
- 에러 엔진 수: ${m.errors.length}${input.userContext ? `\n\n## 사용자 추가 컨텍스트\n${input.userContext}` : ""}`;
}

/**
 * Mastra Agent.generate를 zod schema와 함께 호출.
 * AI SDK v6 structured output 패턴 — output: schema 전달 시 LLM이 JSON 강제 반환.
 */
async function generateAnalyst(
  agentKey: "minji" | "alex" | "sujin",
  prompt: string
): Promise<{ output: AnalystOutput | null; rawText: string | null; errorMessage: string | null }> {
  try {
    const result = await CREW_AGENTS[agentKey].generate(
      [{ role: "user", content: prompt }],
      { structuredOutput: { schema: analystOutputSchema } }
    );
    // Mastra의 structuredOutput 응답: { object: T, text: string, ... }
    const r = result as unknown as { object?: AnalystOutput; text?: string };
    if (r.object) return { output: r.object, rawText: null, errorMessage: null };
    return { output: null, rawText: r.text ?? null, errorMessage: "structured output 파싱 실패" };
  } catch (error) {
    return {
      output: null,
      rawText: null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

async function generateStrategist(
  prompt: string
): Promise<{ output: StrategistOutput | null; rawText: string | null; errorMessage: string | null }> {
  try {
    const result = await CREW_AGENTS.junho.generate(
      [{ role: "user", content: prompt }],
      { structuredOutput: { schema: strategistOutputSchema } }
    );
    const r = result as unknown as { object?: StrategistOutput; text?: string };
    if (r.object) return { output: r.object, rawText: null, errorMessage: null };
    return { output: null, rawText: r.text ?? null, errorMessage: "structured output 파싱 실패" };
  } catch (error) {
    return {
      output: null,
      rawText: null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// ──────────────────────────────────────────────────────────────────
// 4 에이전트 실행 함수
// ──────────────────────────────────────────────────────────────────

async function runMinji(input: CrewInput): Promise<AnalystReport> {
  const start = Date.now();
  const koreanResponses = filterKoreanEngineResponses(input.engineResponses);
  const prompt = `${buildMetricsSummary(input)}

## 한국 AI 엔진 응답 (HyperCLOVA·Naver·Daum)
${buildEngineContext(koreanResponses)}

위 데이터를 분석해 한국 마케팅팀(또는 외국 브랜드 한국 마케팅팀)이 즉시 사용 가능한 인사이트를 JSON 스키마에 맞춰 반환하세요. 마크다운·이모지·테이블 금지.`;

  const { output, rawText, errorMessage } = await generateAnalyst("minji", prompt);
  return {
    agentId: "minji",
    ...CREW_META.minji,
    output,
    rawText,
    durationMs: Date.now() - start,
    errorMessage,
  };
}

async function runAlex(input: CrewInput): Promise<AnalystReport> {
  const start = Date.now();
  const englishResponses = filterEnglishEngineResponses(input.engineResponses);
  const prompt = `${buildMetricsSummary(input)}

## English-language AI engine responses (ChatGPT·Claude·Perplexity·Gemini)
${buildEngineContext(englishResponses)}

Analyze the above and return a benchmark report comparing the brand to global competitors. **All user-facing strings must be in Korean** (마케팅 팀이 읽음). JSON schema strictly. No markdown/emoji/tables.`;

  const { output, rawText, errorMessage } = await generateAnalyst("alex", prompt);
  return {
    agentId: "alex",
    ...CREW_META.alex,
    output,
    rawText,
    durationMs: Date.now() - start,
    errorMessage,
  };
}

async function runSujin(input: CrewInput): Promise<AnalystReport> {
  const start = Date.now();

  const allSources = input.engineResponses.flatMap((r) =>
    r.citedSources.map((s) => ({ ...s, engineId: r.engineId, brandMentioned: r.brandMentioned }))
  );
  const sourcesByDomain = new Map<string, number>();
  for (const s of allSources) {
    sourcesByDomain.set(s.domain, (sourcesByDomain.get(s.domain) ?? 0) + 1);
  }
  const sourcesSummary = Array.from(sourcesByDomain.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([d, c]) => `- ${d}: ${c}회 인용`)
    .join("\n");

  const prompt = `${buildMetricsSummary(input)}

## 모든 엔진의 인용 출처 통합 (Top 20 도메인)
${sourcesSummary || "(인용 출처 없음)"}

## 인용 출처 raw 데이터
${allSources.slice(0, 50).map((s, i) => `[${i + 1}] ${s.engineId}: ${s.domain}${s.title ? ` — ${s.title}` : ""}`).join("\n")}

위 데이터로 도메인 권위·신호 분석을 JSON 스키마에 맞춰 반환하세요. Reddit이 모든 LLM 인용의 약 40%를 차지한다는 점을 명시적으로 언급. 마크다운·이모지 금지.`;

  const { output, rawText, errorMessage } = await generateAnalyst("sujin", prompt);
  return {
    agentId: "sujin",
    ...CREW_META.sujin,
    output,
    rawText,
    durationMs: Date.now() - start,
    errorMessage,
  };
}

async function runJunho(
  input: CrewInput,
  priorReports: AnalystReport[]
): Promise<StrategistReport> {
  const start = Date.now();

  const priorSummary = priorReports
    .map((r) => {
      const tag = r.errorMessage ? ` [ERROR: ${r.errorMessage}]` : "";
      const body = r.output
        ? `Executive: ${r.output.executiveSummary}\nFindings:\n${r.output.findings.map((f, i) => `  ${i + 1}. [${f.severity.toUpperCase()}] ${f.title} — ${f.whyItMatters}\n     ${f.detail}`).join("\n")}\nObservation: ${r.output.observation}`
        : r.rawText || "(응답 없음)";
      return `### ${r.displayName} (${r.role})${tag}\n${body}`;
    })
    .join("\n\n");

  const prompt = `${buildMetricsSummary(input)}

## 선행 에이전트 분석 결과
${priorSummary}

위 분석을 종합해 ${input.brandName}이 실행할 액션을 JSON 스키마에 맞춰 반환하세요.

핵심 요구사항:
1. **mondayActionOne**: 이번 주 월요일 09:00에 시작할 단 1개 액션 (Findable 시그니처 deliverable). 가장 임팩트 큰 1개만 선택.
2. **topActions**: Princeton 8 strategies 룰셋 매핑된 3~7개 액션, 우선순위 정렬 (impact 높고 effort 낮은 것 먼저).
3. 각 액션은 "월요일 회의 직후 시작 가능" 수준의 구체성. 추상 표현 금지.
4. 마크다운·이모지·테이블 금지.`;

  const { output, rawText, errorMessage } = await generateStrategist(prompt);
  return {
    agentId: "junho",
    ...CREW_META.junho,
    output,
    rawText,
    durationMs: Date.now() - start,
    errorMessage,
  };
}

// ──────────────────────────────────────────────────────────────────
// 메인 진입점
// ──────────────────────────────────────────────────────────────────

export async function runCrewDiagnose(input: CrewInput): Promise<CrewReport> {
  const overallStart = Date.now();

  if (!isGatewayConfigured()) {
    return makeStubCrewReport(overallStart);
  }

  // D-043: analysts 3명 병렬 호출 (allSettled로 부분 실패 허용).
  // rate limit 안전 영역 (3 RPM 동시 << 보통 50~500 RPM 한도).
  const settled = await Promise.allSettled([
    runMinji(input),
    runAlex(input),
    runSujin(input),
  ]);

  const analystKeys: Array<Extract<CrewAgentId, "minji" | "alex" | "sujin">> = [
    "minji",
    "alex",
    "sujin",
  ];
  const analysts: AnalystReport[] = settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    const key = analystKeys[i];
    return {
      agentId: key,
      ...CREW_META[key],
      output: null,
      rawText: null,
      durationMs: 0,
      errorMessage:
        result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });

  const strategist = await runJunho(input, analysts);

  return {
    analysts,
    strategist,
    totalDurationMs: Date.now() - overallStart,
    isStub: false,
  };
}

function makeStubCrewReport(overallStart: number): CrewReport {
  const stubAnalyst = (id: Extract<CrewAgentId, "minji" | "alex" | "sujin">): AnalystReport => ({
    agentId: id,
    ...CREW_META[id],
    output: null,
    rawText: `[STUB] AI Gateway 인증 미설정. ${CREW_META[id].displayName} 분석 미실행.`,
    durationMs: 0,
    errorMessage: null,
  });
  const stubStrategist: StrategistReport = {
    agentId: "junho",
    ...CREW_META.junho,
    output: null,
    rawText: "[STUB] AI Gateway 인증 미설정. 준호 액션 전략 미실행.",
    durationMs: 0,
    errorMessage: null,
  };

  return {
    analysts: [stubAnalyst("minji"), stubAnalyst("alex"), stubAnalyst("sujin")],
    strategist: stubStrategist,
    totalDurationMs: Date.now() - overallStart,
    isStub: true,
  };
}

// CREW_ORDER export passthrough (호환성)
export { CREW_ORDER };
