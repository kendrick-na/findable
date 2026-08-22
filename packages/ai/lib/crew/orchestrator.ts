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
//   - 재시도 + 타임아웃 가드 (안정성)
//     ⚠️ 2026-08-07 세션N-10 실측 정정: 이 줄은 오래도록 *"재시도 1회 + 타임아웃 60초"* 라고
//     적혀 있었으나 **둘 다 코드와 달랐다**. 실제는 아래와 같다.
//       · 재시도 = **최대 3회**(`generateWithRetry`, 0·0.5s·1.5s 백오프)
//       · 타임아웃 = **이 파일에 없다**. 상위 `packages/audit/crew-runner.ts` 의
//         `CREW_TIMEOUT_MS`(270초)가 `runCrewDiagnose` 전체를 감싼다
//         (270s < 함수 maxDuration 300s < route STALE_AFTER_MS 900s 로 정합).
//     주석을 믿고 "60초면 충분하다"고 판단하면 실제 상한(270초)을 오해하게 된다.

import type { AuditMetrics, EngineResponse } from "../engines";
import {
  buildIndustryGuidance,
  type IndustryProfile,
  unknownIndustryProfile,
} from "../industry-profile";
import {
  type AnalystOutput,
  analystOutputSchema,
  CREW_AGENTS,
  CREW_META,
  type CrewAgentId,
  rewriterAgent,
  type StrategistOutput,
  strategistOutputSchema,
} from "./agents";
import { critiqueStrategist } from "./critique";

export interface CrewInput {
  brandName: string;
  brandVariants?: string[];
  domain: string;
  engineResponses: EngineResponse[];
  /**
   * 업종 프로파일 (2026-08-02 세션M). 없으면 "업종 미확인"으로 취급해
   * 에이전트가 업종 특화 채널을 단정하지 않도록 지시한다.
   * ⚠️ 이게 없던 시절 반도체 회사에 화장품 리뷰 채널 처방이 나갔다.
   */
  industryProfile?: IndustryProfile;
  /**
   * 측정 언어 (2026-08-02 구조감사 F9). ko 전용 측정에 영문 담당 Alex 를 돌리면
   * "한국어 프롬프트에 대한 글로벌 엔진 답변"을 영어권 시장 분석으로 오해해
   * 엉뚱한 처방이 나간다(SK하이닉스 Sephora 사고의 경로).
   * 없으면 both 로 간주해 기존 동작을 유지한다.
   */
  language?: "ko" | "en" | "both";
  metrics: AuditMetrics;
  /** 사용자가 직접 추가한 컨텍스트 (선택). 예: 경쟁사 목록, 산업 정보. */
  userContext?: string;
}

/**
 * 분석가 에이전트 (민지·Alex·수진) 리포트 — JSON 구조화
 */
export interface AnalystReport {
  agentId: Extract<CrewAgentId, "minji" | "alex" | "sujin">;
  displayName: string;
  durationMs: number;
  emoji: string;
  errorMessage: string | null;
  output: AnalystOutput | null; // 성공 시 JSON, 실패 시 null
  rawText: string | null; // 디버그용 raw text (output 못 파싱한 경우)
  role: string;
}

/**
 * 전략가 에이전트 (준호) 리포트 — JSON 구조화
 */
export interface StrategistReport {
  agentId: "junho";
  displayName: string;
  durationMs: number;
  emoji: string;
  errorMessage: string | null;
  output: StrategistOutput | null;
  rawText: string | null;
  role: string;
}

export type AgentReport = AnalystReport | StrategistReport;

/**
 * 자기평가 1패스 결과 요약 (2026-08-09).
 *
 * ⚠️ **관측 수단이 없으면 이 기능은 작동 여부를 알 수 없다.** `packages/ai` 엔 로깅
 *   의존이 없어(새 의존성 추가는 별건) 결과에 실어 보낸다 — 소비처(`crew-runner`)가
 *   이미 로깅·저장을 하므로 거기서 관측된다.
 *   같은 저장소가 과거 `mentionQuality`·`promptStats` 를 **계산만 하고 버려** 아무도
 *   품질을 몰랐던 전례가 있다. 같은 실수를 반복하지 않는다.
 */
export interface CrewRefinement {
  /** 재작성 결과가 채택됐나(실패·악화·사실 훼손이면 false = 원본 유지). */
  applied: boolean;
  /** 길이 위반이 감지돼 재작성을 시도했나. */
  attempted: boolean;
  /** 재작성에 걸린 시간(ms). 시도하지 않았으면 0. */
  durationMs: number;
  /** 감지된 위반 수(허용 배수 초과분). */
  violationCount: number;
}

export interface CrewReport {
  analysts: AnalystReport[];
  isStub: boolean;
  /** 자기평가 1패스 결과. 스텁이면 생략된다. */
  refinement?: CrewRefinement;
  strategist: StrategistReport;
  totalDurationMs: number;
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

function filterKoreanEngineResponses(
  responses: EngineResponse[]
): EngineResponse[] {
  const korean = new Set<string>(["hyperclova", "naver", "daum"]);
  return responses.filter((r) => korean.has(r.engineId));
}

function filterEnglishEngineResponses(
  responses: EngineResponse[]
): EngineResponse[] {
  const english = new Set<string>([
    "chatgpt",
    "chatgpt-web",
    "claude",
    "perplexity",
    "gemini",
  ]);
  return responses.filter((r) => english.has(r.engineId));
}

/**
 * 에이전트 컨텍스트로 전달할 응답 발췌
 */
/**
 * 엔진 1건의 상태 라벨. STUB > ERROR > LIVE 순으로 판정한다.
 * 🔴 중첩 삼항을 쓰지 않는다(noNestedTernary) — 3상태는 조기반환이 읽기 쉽다.
 */
function engineStatusLabel(r: EngineResponse): string {
  if (r.isStub) {
    return "[STUB]";
  }
  if (r.errorMessage) {
    return `[ERROR: ${r.errorMessage}]`;
  }
  return "[LIVE]";
}

function buildEngineContext(responses: EngineResponse[]): string {
  if (responses.length === 0) {
    return "(엔진 응답 데이터 없음)";
  }
  return responses
    .map((r, i) => {
      const status = engineStatusLabel(r);
      const mention = r.brandMentioned
        ? `언급됨${r.mentionPosition ? ` (${r.mentionPosition}위)` : ""}`
        : "미언급";
      const sentiment = r.sentiment ?? "N/A";
      const sources = r.citedSources.length
        ? r.citedSources
            .slice(0, 3)
            .map((s) => s.domain)
            .join(", ")
        : "없음";
      const excerpt = r.rawResponse.slice(0, 600);

      return `[${i + 1}] 엔진=${r.engineId} ${status} | 언급=${mention} | sentiment=${sentiment} | 인용출처=${sources}\n응답 발췌: ${excerpt}\n`;
    })
    .join("\n");
}

const LANGUAGE_LABEL: Record<"ko" | "en" | "both", string> = {
  ko: "한국어만 측정",
  en: "영어만 측정",
  both: "한국어·영어 병행 측정",
};

/**
 * 메트릭 요약 (모든 에이전트 공유)
 */
function buildMetricsSummary(input: CrewInput): string {
  const m = input.metrics;
  // ⚠️ 2026-08-02 구조감사 F9: enginesCovered/WithMention 은 "엔진×프롬프트" 중복 포함
  //   리스트다. .length 를 그대로 쓰면 엔진이 7개인데 "언급된 엔진: 12개"라고 LLM 에게
  //   알려주게 된다(dedup 은 UI 에만 있었고 crew 경로엔 없었다).
  const coveredUnique = new Set(m.enginesCovered);
  const mentionedUnique = new Set(m.enginesWithMention);
  const languageLabel = LANGUAGE_LABEL[input.language ?? "both"];

  return `## 측정 컨텍스트
- 브랜드: ${input.brandName} (${input.domain})
- 측정 언어: ${languageLabel}
- 호출 엔진: ${coveredUnique.size}개
- 언급된 엔진: ${mentionedUnique.size}개 (${[...mentionedUnique].join(", ") || "없음"})
- Share of Voice: ${m.sov}/100
- 평균 인용 순위: ${m.averageMentionPosition !== null ? `${m.averageMentionPosition}위` : "N/A"}
- Sentiment 분포: 긍정 ${m.sentimentDistribution.positive} / 중립 ${m.sentimentDistribution.neutral} / 부정 ${m.sentimentDistribution.negative}
- Top 인용 도메인: ${m.topCitedDomains.map((d) => `${d.domain}(${d.count})`).join(", ") || "없음"}
- Stub 엔진 수: ${m.stubCount}
- 에러 엔진 수: ${m.errors.length}

${buildIndustryGuidance(input.industryProfile ?? unknownIndustryProfile())}${input.userContext ? `\n\n## 사용자 추가 컨텍스트\n${input.userContext}` : ""}`;
}

// Letsur가 동일 페이로드에도 간헐적으로 400(Bad Request)을 반환하는 사례 실측
// (2026-07-30: 같은 job 재실행 시 일부 에이전트만 무작위 실패, 직접 재현 시 200).
// 에이전트 호출을 최대 3회(0.5s·1.5s 백오프) 재시도해 간헐 실패를 흡수한다.
async function generateWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const delayMs of [0, 500, 1500]) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Mastra Agent.generate를 zod schema와 함께 호출.
 * AI SDK v6 structured output 패턴 — output: schema 전달 시 LLM이 JSON 강제 반환.
 */
async function generateAnalyst(
  agentKey: "minji" | "alex" | "sujin",
  prompt: string
): Promise<{
  output: AnalystOutput | null;
  rawText: string | null;
  errorMessage: string | null;
}> {
  try {
    const result = await generateWithRetry(() =>
      CREW_AGENTS[agentKey].generate([{ role: "user", content: prompt }], {
        structuredOutput: { schema: analystOutputSchema },
      })
    );
    // Mastra의 structuredOutput 응답: { object: T, text: string, ... }
    const r = result as unknown as { object?: AnalystOutput; text?: string };
    if (r.object) {
      return { output: r.object, rawText: null, errorMessage: null };
    }
    return {
      output: null,
      rawText: r.text ?? null,
      errorMessage: "structured output 파싱 실패",
    };
  } catch (error) {
    return {
      output: null,
      rawText: null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

async function generateStrategist(prompt: string): Promise<{
  output: StrategistOutput | null;
  rawText: string | null;
  errorMessage: string | null;
}> {
  try {
    const result = await generateWithRetry(() =>
      CREW_AGENTS.junho.generate([{ role: "user", content: prompt }], {
        structuredOutput: { schema: strategistOutputSchema },
      })
    );
    const r = result as unknown as { object?: StrategistOutput; text?: string };
    if (r.object) {
      return { output: r.object, rawText: null, errorMessage: null };
    }
    return {
      output: null,
      rawText: r.text ?? null,
      errorMessage: "structured output 파싱 실패",
    };
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

  const { output, rawText, errorMessage } = await generateAnalyst(
    "minji",
    prompt
  );
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

  const { output, rawText, errorMessage } = await generateAnalyst(
    "alex",
    prompt
  );
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
    r.citedSources.map((s) => ({
      ...s,
      engineId: r.engineId,
      brandMentioned: r.brandMentioned,
    }))
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
${allSources
  .slice(0, 50)
  .map(
    (s, i) =>
      `[${i + 1}] ${s.engineId}: ${s.domain}${s.title ? ` — ${s.title}` : ""}`
  )
  .join("\n")}

위 데이터로 도메인 권위·신호 분석을 JSON 스키마에 맞춰 반환하세요. Reddit이 모든 LLM 인용의 약 40%를 차지한다는 점을 명시적으로 언급. 마크다운·이모지 금지.`;

  const { output, rawText, errorMessage } = await generateAnalyst(
    "sujin",
    prompt
  );
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
// 자기평가 1패스 (critique → refine) — 2026-08-09
//
// 🔴 배경(실측): 스키마 `.describe()` 와 지시문이 **둘 다** 길이 규칙을 말하는데
//   프로덕션 18건 전수 감사에서 `executiveSummary` 가 **18/18 전건 위반**(최장 347자,
//   약속 80자의 4.3배)이었다. *"임원이 한 문장만 읽어도 결정 가능"* 이라는 제품 약속이
//   100% 깨진 채 아무도 몰랐다. **지시만으로는 안 된다**는 증거다.
//
// 🔒 안전 설계 3가지:
//   1. **원본을 절대 잃지 않는다** — 재작성이 실패·타임아웃·스키마 미스면 원본을 그대로 쓴다.
//      즉 이 단계는 **현재보다 나빠질 수 없다**(단조 개선).
//   2. **1패스만** — 반복하면 crew 총 시간이 늘어 상위 `CREW_TIMEOUT_MS`(270초)를 위협한다.
//      실측 crew 소요가 이미 수십 초대라 여유가 크지 않다.
//   3. **명백한 위반만**(약속의 1.5배 초과) — 모든 회차를 재작성하면 비용·시간이 배로 든다.
// ──────────────────────────────────────────────────────────────────

/**
 * 재작성 1회에 허용하는 시간.
 *
 * 🔴 **왜 상한이 필요한가**(실측 2026-08-09): crew 전체가 최대 **130초**, 전략가 1회가
 *   최대 **80초**다. 상위 `CREW_TIMEOUT_MS` 는 **270초** — 재작성이 느려지면 전체가
 *   그 상한에 걸려 **리포트 자체를 잃는다**(processing 실패). 그건 "요약이 좀 긴 것"보다
 *   훨씬 나쁘다.
 *   → 재작성은 **45초 안에 못 끝내면 포기**하고 원본을 쓴다. 최악 `130+45=175초` 로
 *   270초 예산 안에 확실히 들어온다.
 */
const REWRITE_TIMEOUT_MS = 45 * 1000;

/** 재작성 전용 타임아웃 — 초과 시 reject 되어 호출부가 원본으로 폴백한다. */
function withRewriteTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("crew 재작성 타임아웃")),
      REWRITE_TIMEOUT_MS
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * 재작성 결과가 원본을 대체할 자격이 있는지.
 *
 * ⚠️ **더 나빠지면 버린다** — 압축을 시켰는데 오히려 길어졌다면 그 재작성은 실패다.
 *   길이 위반 총량(초과 글자 수 합)으로 비교한다.
 */
function overageTotal(output: StrategistOutput | null): number {
  return critiqueStrategist(output).violations.reduce(
    (sum, v) => sum + (v.actual - v.limit),
    0
  );
}

/**
 * 액션의 **숫자·분류 필드가 보존됐는지** 검사.
 *
 * 🔴 이게 어긋나면 화면 간 숫자가 달라진다 — 재작성은 "압축"이지 "재분석"이 아니다.
 *   rank·channel·impact·effort 가 바뀌면 `/actions` 카드와 결과 페이지가 서로 다른
 *   우선순위를 말하게 된다(세션N-8의 "화면 점수 ≠ 메일 점수"와 같은 계열의 사고).
 */
function preservesActionFacts(
  original: StrategistOutput,
  rewritten: StrategistOutput
): boolean {
  const a = original.topActions ?? [];
  const b = rewritten.topActions ?? [];
  if (a.length !== b.length) {
    return false;
  }
  return a.every((orig, i) => {
    const next = b[i];
    return (
      next !== undefined &&
      next.rank === orig.rank &&
      next.channel === orig.channel &&
      next.impact === orig.impact &&
      next.effort === orig.effort &&
      next.princetonStrategy === orig.princetonStrategy
    );
  });
}

/**
 * 길이 규정을 어긴 전략가 산출물을 **한 번만** 압축 재작성한다.
 * 어떤 이유로든 실패하면 원본을 그대로 돌려준다.
 */
async function refineStrategist(
  report: StrategistReport
): Promise<{ report: StrategistReport; refinement: CrewRefinement }> {
  const idle: CrewRefinement = {
    attempted: false,
    applied: false,
    violationCount: 0,
    durationMs: 0,
  };

  const original = report.output;
  if (!original) {
    return { report, refinement: idle };
  }

  const critique = critiqueStrategist(original);
  if (!critique.needsRewrite) {
    return { report, refinement: idle };
  }

  const start = Date.now();
  const base: CrewRefinement = {
    attempted: true,
    applied: false,
    violationCount: critique.violations.length,
    durationMs: 0,
  };
  const give = (applied: boolean, next?: StrategistOutput) => ({
    report: next ? { ...report, output: next } : report,
    refinement: { ...base, applied, durationMs: Date.now() - start },
  });

  const prompt = `${critique.instruction}

## 원본 JSON
${JSON.stringify(original)}`;

  try {
    // ⚠️ 재시도(`generateWithRetry`)를 쓰지 않는다 — 재작성은 **있으면 좋은 것**이라
    //   실패 시 원본으로 폴백하면 그만이고, 재시도는 시간 예산만 갉아먹는다.
    const result = await withRewriteTimeout(
      rewriterAgent.generate([{ role: "user", content: prompt }], {
        structuredOutput: { schema: strategistOutputSchema },
      })
    );
    const rewritten = (result as unknown as { object?: StrategistOutput })
      .object;
    if (!rewritten) {
      return give(false);
    }
    // 사실(숫자·채널)이 바뀌었거나 오히려 더 길어졌으면 재작성을 버린다.
    if (
      !preservesActionFacts(original, rewritten) ||
      overageTotal(rewritten) >= overageTotal(original)
    ) {
      return give(false);
    }
    return give(true, rewritten);
  } catch {
    // 재작성 실패는 조용히 원본 유지 — 리포트 자체를 잃는 것보다 낫다.
    return give(false);
  }
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
  // ⚠️ 2026-08-02 구조감사 F9: 언어별로 담당 분석가를 켠다.
  //   ko 전용 측정에 영문 담당 Alex 를 돌리면, Alex 가 받는 "글로벌 엔진 응답"은
  //   사실 한국어 프롬프트에 대한 답변이다. 그걸 영어권 시장 분석으로 해석해
  //   엉뚱한 해외 채널 처방이 나갔다(SK하이닉스 Sephora 사고의 경로).
  //   en 전용이면 반대로 한국 담당 민지를 건너뛴다.
  const lang = input.language ?? "both";
  const runAlexAgent = lang !== "ko";
  const runMinjiAgent = lang !== "en";

  const plan: Array<{
    key: Extract<CrewAgentId, "minji" | "alex" | "sujin">;
    run: () => Promise<AnalystReport>;
  }> = [];
  if (runMinjiAgent) {
    plan.push({ key: "minji", run: () => runMinji(input) });
  }
  if (runAlexAgent) {
    plan.push({ key: "alex", run: () => runAlex(input) });
  }
  plan.push({ key: "sujin", run: () => runSujin(input) });

  const settled = await Promise.allSettled(plan.map((p) => p.run()));
  const analystKeys = plan.map((p) => p.key);
  const analysts: AnalystReport[] = settled.map((result, i) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    const key = analystKeys[i];
    return {
      agentId: key,
      ...CREW_META[key],
      output: null,
      rawText: null,
      durationMs: 0,
      errorMessage:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
    };
  });

  const strategist = await runJunho(input, analysts);

  // 자기평가 1패스 — 길이 약속을 명백히 어겼을 때만 압축 재작성한다.
  // 실패하면 원본 그대로라 이 단계는 결과를 나쁘게 만들 수 없다(위 §안전 설계).
  const { report: refined, refinement } = await refineStrategist(strategist);

  return {
    analysts,
    strategist: refined,
    totalDurationMs: Date.now() - overallStart,
    isStub: false,
    refinement,
  };
}

function makeStubCrewReport(overallStart: number): CrewReport {
  const stubAnalyst = (
    id: Extract<CrewAgentId, "minji" | "alex" | "sujin">
  ): AnalystReport => ({
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
// 🔴 `import` 한 것을 `export` 하지 않는다(noExportedImports) → `export from` 으로.
export { CREW_ORDER } from "./agents";
