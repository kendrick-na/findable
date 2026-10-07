// 질문 계획 v2 그림자 실행 (2026-10-07, A1 — 대표 결정 「그림자 먼저, 점수는 기존 세트」)
//
// 계약(점수 격리)
//   · QUESTION_PLAN_V2_SHADOW=true 이고 브랜드가 허용 목록(QUESTION_PLAN_V2_SHADOW_BRANDS)에 있을 때만.
//     목록이 비어 있으면 **아무 브랜드도** 돌지 않는다(원가 상한 — 전체 허용 없음).
//   · 브랜드당 최대 주 1회(QUESTION_PLAN_V2_SHADOW_MIN_DAYS, 기본 7일 · 1~30). 진행 중인 그림자도 센다.
//   · 기존 질문 세트 **뒤에** v2 20문항을 붙여 같은 회차(같은 checkpoint·칸 단위 이어가기)로 잰다.
//     결과는 result.shadowPlanV2 에만 저장하고 점수·추세·Tracking·처방·PDF 에는 넣지 않는다.
//   · 이어가기 상한은 계획 크기로 계산한다: ⌈질문 수 × 40초 ÷ 240초⌉ + 1(최대 8).
//   · 엔진 구성(engineSetKey): 주간 회차(직전 「weekly-full-v1」 그림자로부터 7일 이상)는 Claude 포함,
//     그 밖(최소 간격을 7일보다 줄였을 때)은 「daily-noclaude-v1」(Claude 제외 — 원가의 약 86%).
//
// 표기: [확인사실] 원가 근거 = docs/_적용/측정질문체계_설계안_20261007.md §5.
//
// ➕ 질문 개선(2026-10-07 대표 승인): 규칙 계획 위에 LLM 프로필 구조화 → 후보 과생성 → LLM 심사 →
//   중복 제거 → 검색량 가중 선발(question-plan-v2-refine.ts). 보조 LLM 원가는 result.cost.shadowPlanV2Krw 에만
//   더한다(totalKrw 아님). 지표는 result.shadowPlanV2.metrics.
//   ⛔ 네이버 지식iN 은 이 경로에서 쓰지 않는다(네이버 Open API 약관 · 법무 검토 대기 — brand-profile-live.ts).

import type { EngineResponse } from "@repo/ai/lib/engines";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import type { RunPrompt } from "./audit-prompts";
import {
  type CollectedProfile,
  type CollectProfileInput,
  collectBrandProfile,
} from "./brand-profile-live";
import {
  extractCompetitorLandscape,
  type KnownCompetitor,
} from "./competitor-extract";
import { type DemandMarket, demandMarketsFor } from "./demand-prompts";
import type { MarketScope } from "./market-scope";
import {
  ENGINE_SET_DAILY_NOCLAUDE,
  ENGINE_SET_WEEKLY_FULL,
  type PlanV2EngineSetKey,
  type PlanV2Provenance,
  type PlanV2Type,
  QUESTION_PLAN_V2,
  SHADOW_MAX_CONTINUATIONS,
} from "./plan-v2-contract";
import {
  PLAN_V2_TYPES,
  planV2NoteText,
  type QuestionPlanV2,
} from "./question-plan-v2";
import {
  type LlmBrandProfile,
  type PlanLlm,
  type RefineMetrics,
  type RejectedCandidate,
  refineQuestionPlanV2,
} from "./question-plan-v2-refine";

export {
  ENGINE_SET_DAILY_NOCLAUDE,
  ENGINE_SET_WEEKLY_FULL,
  enginesForEngineSet,
  isValidShadowCheckpoint,
  PLAN_V2_ENGINE_SETS,
  type PlanV2EngineSetKey,
  SHADOW_MAX_CONTINUATIONS,
} from "./plan-v2-contract";

// ── 운영 플래그·허용 목록·주기 ──────────────────────────────────────
type Env = Record<string, string | undefined>;

export function isShadowPlanV2Enabled(env: Env = process.env): boolean {
  return env.QUESTION_PLAN_V2_SHADOW === "true";
}

const LIST_SPLIT_RE = /[\s,]+/;
const DOMAIN_PREFIX_RE = /^(?:https?:\/\/)?(?:www\.)?/i;
const PATH_SUFFIX_RE = /\/.*$/;
const normalizeDomain = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(DOMAIN_PREFIX_RE, "")
    .replace(PATH_SUFFIX_RE, "");

/** 허용 목록 — 브랜드 ID 또는 도메인(쉼표·공백 구분). 비어 있으면 빈 배열(= 아무도 안 돈다). */
export function shadowAllowlist(env: Env = process.env): string[] {
  return (env.QUESTION_PLAN_V2_SHADOW_BRANDS ?? "")
    .split(LIST_SPLIT_RE)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function isShadowBrandAllowed(
  brand: { brandId?: string | null; domain: string },
  env: Env = process.env
): boolean {
  const list = shadowAllowlist(env);
  if (list.length === 0) {
    return false;
  }
  const domain = normalizeDomain(brand.domain);
  return list.some(
    (entry) =>
      (brand.brandId && entry === brand.brandId) ||
      normalizeDomain(entry) === domain
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const SHADOW_DEFAULT_MIN_DAYS = 7;
export const WEEKLY_FULL_INTERVAL_DAYS = 7;

export function shadowMinIntervalDays(env: Env = process.env): number {
  const raw = Number(env.QUESTION_PLAN_V2_SHADOW_MIN_DAYS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return SHADOW_DEFAULT_MIN_DAYS;
  }
  return Math.min(30, Math.max(1, Math.floor(raw)));
}

export interface ShadowRunRecord {
  createdAt: Date;
  engineSetKey: string | null;
}

export type ShadowCadence =
  | { engineSetKey: PlanV2EngineSetKey; run: true }
  | { nextEligibleAt: Date; reason: "too_soon"; run: false };

/** 이번 회차에 그림자를 돌릴지, 돌린다면 어떤 엔진 구성으로. */
export function shadowCadence(args: {
  minIntervalDays: number;
  now: Date;
  recent: readonly ShadowRunRecord[];
}): ShadowCadence {
  const latest = Math.max(
    Number.NEGATIVE_INFINITY,
    ...args.recent.map((r) => r.createdAt.getTime())
  );
  const nextAt = latest + args.minIntervalDays * DAY_MS;
  if (Number.isFinite(latest) && args.now.getTime() < nextAt) {
    return { run: false, reason: "too_soon", nextEligibleAt: new Date(nextAt) };
  }
  const lastFull = Math.max(
    Number.NEGATIVE_INFINITY,
    ...args.recent
      .filter((r) => r.engineSetKey === ENGINE_SET_WEEKLY_FULL)
      .map((r) => r.createdAt.getTime())
  );
  const fullDue =
    !Number.isFinite(lastFull) ||
    args.now.getTime() - lastFull >= WEEKLY_FULL_INTERVAL_DAYS * DAY_MS;
  return {
    run: true,
    engineSetKey: fullDue ? ENGINE_SET_WEEKLY_FULL : ENGINE_SET_DAILY_NOCLAUDE,
  };
}

// ── 이어가기 상한(계획 크기 기반) ────────────────────────────────────
export const SECONDS_PER_QUESTION = 40;
export const SECONDS_PER_INVOCATION = 240;

/** ⌈질문 수 × 40초 ÷ 240초⌉ + 1(여유 1회). */
export function requiredContinuations(questionCount: number): number {
  const q = Math.max(0, Math.floor(questionCount));
  return Math.ceil((q * SECONDS_PER_QUESTION) / SECONDS_PER_INVOCATION) + 1;
}

/** 그림자 회차 이어가기 상한 — 기본 상한(2) 이상, 절대 상한(8) 이하. */
export function shadowContinuationLimit(
  totalQuestions: number,
  baseLimit: number
): number {
  return Math.min(
    SHADOW_MAX_CONTINUATIONS,
    Math.max(baseLimit, requiredContinuations(totalQuestions))
  );
}

// ── 질문 계획 → 실행 프롬프트 ────────────────────────────────────────

export function planV2RunPrompts(
  plan: QuestionPlanV2,
  engineSetKey: PlanV2EngineSetKey
): RunPrompt[] {
  return plan.questions.map((q) => ({
    kind: q.kind,
    lang: q.lang,
    text: q.text,
    planV2: {
      type: q.type,
      market: q.market,
      engineSetKey,
      provenance: q.provenance,
    },
  }));
}

export interface ShadowMeasurementContext {
  /** 측정 맥락 — 질문 계획 버전(이 그림자 세트만 2). */
  cadence: { minIntervalDays: number };
  counts: Record<PlanV2Type, number>;
  engineSetKey: PlanV2EngineSetKey;
  excluded: QuestionPlanV2["excluded"];
  /** LLM 심사·결정적 검사에서 떨어진 후보 예시(최대 30, 사유 포함). */
  judgeRejected: RejectedCandidate[];
  keywordRows: CollectedProfile["diagnostics"]["keywordRows"];
  markets: Record<DemandMarket, number>;
  nameLessCount: number;
  note: QuestionPlanV2["note"];
  noteText: string | null;
  profile: {
    businessType: CollectedProfile["profile"]["businessType"];
    catalogProducts: number;
    identity: CollectedProfile["profile"]["identity"];
    industry: CollectedProfile["profile"]["industry"];
    level: CollectedProfile["profile"]["level"];
    /** 처음 12개 이름(공식 사이트 공개 정보). */
    offerings: string[];
    sitePagesRead: number;
    sources: CollectedProfile["profile"]["sources"];
    /** LLM 구조화 프로필(공식 사이트 근거만). 실패하면 null(= 규칙 기반). */
    structured: LlmBrandProfile | null;
  };
  questionPlanVersion: typeof QUESTION_PLAN_V2;
  seeds: CollectedProfile["seeds"];
  /** 점수·추세·Tracking 에 쓰지 않는다(그림자). */
  usedInScores: false;
}

export interface ShadowPlanV2Checkpoint {
  createdAt: string;
  engineSetKey: PlanV2EngineSetKey;
  maxContinuations: number;
  measurementContext: ShadowMeasurementContext;
  /** 질문 개선 지표(2026-10-07). 이전 checkpoint 에는 없다. */
  metrics?: RefineMetrics;
  questionCount: number;
  questionPlanVersion: typeof QUESTION_PLAN_V2;
  /** checkpoint.prompts 에서 그림자 질문이 시작되는 위치(앞은 기존 세트). */
  startIndex: number;
}

export interface ShadowPlanDeps {
  collect: (input: CollectProfileInput) => Promise<CollectedProfile>;
  /** 질문 개선 보조 LLM(프로필·후보·심사). null 이면 규칙 계획 그대로. */
  llm: PlanLlm | null;
  previousAnswerBrands: (args: {
    brandId: string;
    brandName: string;
    brandVariants: readonly string[];
    competitors: readonly KnownCompetitor[];
  }) => Promise<string[]>;
  recentShadowRuns: (
    brandId: string,
    since: Date
  ) => Promise<ShadowRunRecord[]>;
}

/**
 * 최근 그림자 회차(완료 결과 또는 진행 중 checkpoint). JSON 안의 키만 본다 — 마이그레이션 없음.
 */
async function queryRecentShadowRuns(
  brandId: string,
  since: Date
): Promise<ShadowRunRecord[]> {
  const rows = (await database.$queryRawUnsafe(
    `SELECT "createdAt",
            COALESCE(
              "result"->'shadowPlanV2'->>'engineSetKey',
              "checkpoint"->'shadowPlanV2'->>'engineSetKey'
            ) AS "engineSetKey"
       FROM "AuditJob"
      WHERE "brandId" = $1
        AND "createdAt" >= $2
        AND ("result"->'shadowPlanV2' IS NOT NULL
             OR "checkpoint"->'shadowPlanV2' IS NOT NULL)
      ORDER BY "createdAt" DESC
      LIMIT 20`,
    brandId,
    since
  )) as Array<{ createdAt: Date | string; engineSetKey: string | null }>;
  return rows.map((r) => ({
    createdAt: new Date(r.createdAt),
    engineSetKey: r.engineSetKey ?? null,
  }));
}

const MAX_ANSWER_BRANDS = 30;

/** 지난 완료 회차의 AI 답변에서 나온 다른 브랜드 이름(키워드 「다른 브랜드」 제외용). */
async function queryPreviousAnswerBrands(args: {
  brandId: string;
  brandName: string;
  brandVariants: readonly string[];
  competitors: readonly KnownCompetitor[];
}): Promise<string[]> {
  const job = await database.auditJob.findFirst({
    where: { brandId: args.brandId, status: "completed" },
    orderBy: { createdAt: "desc" },
    select: { result: true },
  });
  const rows = (job?.result as { engineResponses?: unknown } | null)
    ?.engineResponses;
  if (!Array.isArray(rows)) {
    return [];
  }
  const excerpts = rows.flatMap((row) => {
    const excerpt = (row as { excerpt?: unknown } | null)?.excerpt;
    return typeof excerpt === "string" ? [excerpt] : [];
  });
  const landscape = extractCompetitorLandscape(
    excerpts,
    args.brandName,
    [...args.brandVariants],
    [...args.competitors]
  );
  const own = [args.brandName, ...args.brandVariants].map((n) =>
    n.toLowerCase().replace(/\s+/g, "")
  );
  return landscape.ranking
    .map((r) => r.name)
    .filter((name) => !own.includes(name.toLowerCase().replace(/\s+/g, "")))
    .slice(0, MAX_ANSWER_BRANDS);
}

/** 보조 LLM 실호출 — 필요할 때만 불러온다(규칙 경로·테스트가 `ai` 를 싣지 않게). */
const liveQuestionPlanLlm: PlanLlm = async (request) => {
  const { questionPlanLlmCall } = await import(
    "@repo/ai/lib/question-plan-llm"
  );
  return questionPlanLlmCall(request);
};

export const liveShadowPlanDeps: ShadowPlanDeps = {
  collect: (input) => collectBrandProfile(input),
  llm: liveQuestionPlanLlm,
  recentShadowRuns: queryRecentShadowRuns,
  previousAnswerBrands: queryPreviousAnswerBrands,
};

export interface ResolveShadowPlanArgs {
  /** 기존 이어가기 상한(MAX_AUDIT_CONTINUATIONS). */
  baseContinuationLimit: number;
  brandId?: string;
  brandNames: { en: string; ko: string; variants: readonly string[] };
  competitors: readonly KnownCompetitor[];
  customerIdentity?: CollectProfileInput["customerIdentity"];
  domain: string;
  env?: Env;
  footerIdentity?: CollectProfileInput["footerIdentity"];
  industry?: string | null;
  language: "ko" | "en" | "both";
  /** 기존 세트 질문 수(그림자는 그 뒤에 붙는다). */
  mainPromptCount: number;
  now?: Date;
  scope: MarketScope;
  signal?: AbortSignal;
  siteTextTerms?: readonly string[];
}

export interface ResolvedShadowPlan {
  checkpoint: ShadowPlanV2Checkpoint;
  prompts: RunPrompt[];
}

const OFFERINGS_IN_CONTEXT = 12;
/** 프로필·검색량 수집 상한 — 질문 시작 마감(run-budget)을 먹지 않게. */
export const SHADOW_COLLECT_TIMEOUT_MS = 25_000;
/** 질문 개선 LLM 3회(프로필·후보·심사) 상한. 넘기면 그 단계부터 규칙 기반으로 돌아간다. */
export const SHADOW_REFINE_TIMEOUT_MS = 45_000;
/** 그림자 계획 전체 상한(runner 가 남은 시간을 볼 때 쓴다). */
export const SHADOW_PLAN_TIMEOUT_MS =
  SHADOW_COLLECT_TIMEOUT_MS + SHADOW_REFINE_TIMEOUT_MS;

/**
 * 기존 세트 checkpoint 에 그림자 기록을 붙인다. startIndex 는 실제 기존 세트 질문 수,
 * 이어가기 상한은 실제 계획 크기(기존 + 그림자)로 다시 계산한다.
 */
export function attachShadowPlan<T extends { prompts: RunPrompt[] }>(
  checkpoint: T,
  shadow: ResolvedShadowPlan | null,
  mainPromptCount: number,
  baseContinuationLimit: number
): T & { shadowPlanV2?: ShadowPlanV2Checkpoint } {
  if (!shadow) {
    return checkpoint;
  }
  return {
    ...checkpoint,
    shadowPlanV2: {
      ...shadow.checkpoint,
      startIndex: mainPromptCount,
      questionCount: shadow.prompts.length,
      maxContinuations: shadowContinuationLimit(
        mainPromptCount + shadow.prompts.length,
        baseContinuationLimit
      ),
    },
  };
}

/**
 * 이번 회차에 붙일 그림자 질문. 꺼짐·허용 목록 밖·주기 미도래·시장 없음·오류 → null(기존 회차 그대로).
 * ⛔ 절대 throw 하지 않는다 — 그림자 실패가 고객 측정을 막으면 안 된다.
 */
export async function resolveShadowPlanV2(
  args: ResolveShadowPlanArgs,
  deps: ShadowPlanDeps = liveShadowPlanDeps
): Promise<ResolvedShadowPlan | null> {
  const env = args.env ?? process.env;
  if (!isShadowPlanV2Enabled(env)) {
    return null;
  }
  if (!args.brandId) {
    return null;
  }
  if (
    !isShadowBrandAllowed({ brandId: args.brandId, domain: args.domain }, env)
  ) {
    return null;
  }
  const now = args.now ?? new Date();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHADOW_COLLECT_TIMEOUT_MS);
  timer.unref?.();
  const refineController = new AbortController();
  let refineTimer: ReturnType<typeof setTimeout> | null = null;
  const onAbort = () => {
    controller.abort();
    refineController.abort();
  };
  args.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const minIntervalDays = shadowMinIntervalDays(env);
    const lookbackDays = Math.max(minIntervalDays, WEEKLY_FULL_INTERVAL_DAYS);
    const recent = await deps.recentShadowRuns(
      args.brandId,
      new Date(now.getTime() - lookbackDays * DAY_MS)
    );
    const cadence = shadowCadence({ now, recent, minIntervalDays });
    if (!cadence.run) {
      log.info("audit.shadow_plan_v2.skipped", {
        brandId: args.brandId,
        reason: cadence.reason,
        nextEligibleAt: cadence.nextEligibleAt.toISOString(),
      });
      return null;
    }
    const markets = demandMarketsFor(args.language, args.scope);
    if (markets.length === 0) {
      return null;
    }
    const [collected, answerBrands] = await Promise.all([
      deps.collect({
        domain: args.domain,
        brandNames: args.brandNames,
        industry: args.industry ?? null,
        customerIdentity: args.customerIdentity ?? null,
        footerIdentity: args.footerIdentity ?? null,
        siteTextTerms: args.siteTextTerms ?? [],
        markets,
        signal: controller.signal,
      }),
      deps
        .previousAnswerBrands({
          brandId: args.brandId,
          brandName: args.brandNames.ko,
          brandVariants: args.brandNames.variants,
          competitors: args.competitors,
        })
        .catch(() => [] as string[]),
    ]);
    const competitorNames = args.competitors.flatMap((c) => [
      c.name,
      ...(c.aliases ?? []),
    ]);
    clearTimeout(timer);
    refineTimer = setTimeout(
      () => refineController.abort(),
      SHADOW_REFINE_TIMEOUT_MS
    );
    refineTimer.unref?.();
    const refined = await refineQuestionPlanV2(
      {
        profile: collected.profile,
        keywords: collected.keywords,
        industry: args.industry ?? null,
        siteTextTerms: args.siteTextTerms ?? [],
        markets,
        brandNames: [
          args.brandNames.ko,
          args.brandNames.en,
          ...args.brandNames.variants,
        ],
        displayNames: { ko: args.brandNames.ko, en: args.brandNames.en },
        competitors: args.competitors.map((c) => c.name),
        otherBrandNames: [...competitorNames, ...answerBrands],
      },
      deps.llm,
      refineController.signal
    );
    const plan = refined.plan;
    const engineSetKey = cadence.engineSetKey;
    const prompts = planV2RunPrompts(plan, engineSetKey);
    if (prompts.length === 0) {
      return null;
    }
    const measurementContext: ShadowMeasurementContext = {
      questionPlanVersion: QUESTION_PLAN_V2,
      engineSetKey,
      usedInScores: false,
      counts: plan.counts,
      markets: plan.markets,
      nameLessCount: plan.nameLessCount,
      note: plan.note,
      noteText: planV2NoteText(plan.note),
      excluded: plan.excluded,
      seeds: collected.seeds,
      keywordRows: collected.diagnostics.keywordRows,
      judgeRejected: refined.rejected,
      cadence: { minIntervalDays },
      profile: {
        level: collected.profile.level,
        businessType: collected.profile.businessType,
        industry: collected.profile.industry,
        sources: collected.profile.sources,
        identity: collected.profile.identity,
        catalogProducts: collected.diagnostics.catalogProducts,
        sitePagesRead: collected.diagnostics.sitePagesRead,
        offerings: collected.profile.offerings
          .slice(0, OFFERINGS_IN_CONTEXT)
          .map((o) => o.name),
        structured: refined.llmProfile,
      },
    };
    const total = args.mainPromptCount + prompts.length;
    const checkpoint: ShadowPlanV2Checkpoint = {
      questionPlanVersion: QUESTION_PLAN_V2,
      engineSetKey,
      startIndex: args.mainPromptCount,
      questionCount: prompts.length,
      maxContinuations: shadowContinuationLimit(
        total,
        args.baseContinuationLimit
      ),
      createdAt: now.toISOString(),
      measurementContext,
      metrics: refined.metrics,
    };
    log.info("audit.shadow_plan_v2.planned", {
      brandId: args.brandId,
      engineSetKey,
      questions: prompts.length,
      nameLess: plan.nameLessCount,
      profileLevel: collected.profile.level,
      maxContinuations: checkpoint.maxContinuations,
      profileSource: refined.metrics.profileSource,
      judge: refined.metrics.judge,
      candidatesGenerated: refined.metrics.candidatesGenerated,
      judgePassRate: refined.metrics.judgePassRate,
      dedupRemoved: refined.metrics.dedupRemoved,
      demandLinkRate: refined.metrics.demandLinkRate,
      llmCostKrw: refined.metrics.llmCostKrw,
    });
    return { prompts, checkpoint };
  } catch (error) {
    log.warn("audit.shadow_plan_v2.failed", {
      brandId: args.brandId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  } finally {
    clearTimeout(timer);
    if (refineTimer) {
      clearTimeout(refineTimer);
    }
    args.signal?.removeEventListener("abort", onAbort);
  }
}

// ── 결과(저장 전용) ─────────────────────────────────────────────────
const SHADOW_EXCERPT_CHARS = 1500;
const SHADOW_CITATIONS = 5;

export interface ShadowAnswerRow {
  brandMentioned: boolean;
  citedSources: Array<{ title?: string; url: string }>;
  engineId: string;
  errorMessage: string | null;
  excerpt: string;
  lateCell?: "resolved" | "final_failed";
  mentionListSize: number | null;
  mentionPosition: number | null;
  mentionQuality?: EngineResponse["mentionQuality"];
  questionIndex: number;
  sentiment: EngineResponse["sentiment"];
  verdictVia?: string;
}

interface Tally {
  accurate: number;
  answers: number;
  mentioned: number;
}

export interface ShadowPlanV2Result {
  cost: {
    costModelVersion: number;
    perEngine: Array<{ engineId: string; krw: number }>;
    /** 질문 개선 보조 LLM(프로필·후보·심사) 원가. 엔진 원가(totalKrw)와 따로 둔다. */
    planningLlmKrw: number;
    totalKrw: number;
  };
  engineResponses: ShadowAnswerRow[];
  engineSetKey: PlanV2EngineSetKey;
  measurementContext: ShadowMeasurementContext & {
    questionsAnswered: number;
    questionsPlanned: number;
    verification: "verified" | "unverified";
  };
  /** 질문 개선 지표(이전 checkpoint 로 끝난 회차는 null). */
  metrics: RefineMetrics | null;
  questionPlanVersion: typeof QUESTION_PLAN_V2;
  questions: Array<{
    index: number;
    kind: "brand" | "discovery";
    lang: "ko" | "en";
    market: DemandMarket;
    provenance: PlanV2Provenance;
    text: string;
    type: PlanV2Type;
  }>;
  /**
   * 유형별 집계 — accurate = 「정확 노출」(언급 + 판정 confirmed). 점수에 쓰지 않는다.
   * 실패·스텁 답은 분모에서 뺀다.
   */
  summary: {
    byType: Record<PlanV2Type, Tally>;
    nameLess: Tally;
  };
  usedInScores: false;
}

const usable = (row: { errorMessage: string | null; isStub?: boolean }) =>
  !(row.errorMessage || row.isStub);

/** 그림자 응답(검증 후) → 저장 형태. 순수 함수. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one pass builds the stored rows and the per-type tallies together.
export function buildShadowPlanV2Result(args: {
  batches: readonly (readonly EngineResponse[])[];
  checkpoint: ShadowPlanV2Checkpoint;
  cost: Omit<ShadowPlanV2Result["cost"], "planningLlmKrw">;
  lateCellOf?: (
    questionIndex: number,
    engineId: string
  ) => "resolved" | "final_failed" | undefined;
  prompts: readonly RunPrompt[];
  verification: "verified" | "unverified";
}): ShadowPlanV2Result {
  const questions = args.prompts.map((p, index) => ({
    index,
    type: (p.planV2?.type ?? "A") as PlanV2Type,
    market: p.planV2?.market ?? (p.lang === "ko" ? "KR" : "US"),
    lang: p.lang,
    kind: p.kind === "brand" ? ("brand" as const) : ("discovery" as const),
    text: p.text,
    provenance: p.planV2?.provenance ?? {
      keyword: null,
      volume: null,
      source: "registration",
      expanded: false,
    },
  }));
  const byType = Object.fromEntries(
    PLAN_V2_TYPES.map((t) => [t, { answers: 0, mentioned: 0, accurate: 0 }])
  ) as Record<PlanV2Type, Tally>;
  const nameLess: Tally = { answers: 0, mentioned: 0, accurate: 0 };
  const rows: ShadowAnswerRow[] = [];
  for (const [questionIndex, batch] of args.batches.entries()) {
    const question = questions[questionIndex];
    for (const r of batch) {
      const late = args.lateCellOf?.(questionIndex, r.engineId);
      rows.push({
        questionIndex,
        engineId: r.engineId,
        brandMentioned: r.brandMentioned,
        ...(r.mentionQuality && usable(r)
          ? { mentionQuality: r.mentionQuality }
          : {}),
        ...((r as { verdictVia?: string }).verdictVia
          ? { verdictVia: (r as { verdictVia?: string }).verdictVia }
          : {}),
        mentionPosition: r.mentionPosition,
        mentionListSize: r.mentionListSize,
        sentiment: r.sentiment,
        errorMessage: r.errorMessage,
        ...(late ? { lateCell: late } : {}),
        citedSources: r.citedSources
          .slice(0, SHADOW_CITATIONS)
          .map((c) => ({ url: c.url, ...(c.title ? { title: c.title } : {}) })),
        excerpt: (r.rawResponse ?? "").slice(0, SHADOW_EXCERPT_CHARS),
      });
      // 네이버·다음은 AI 답이 아니라 검색 노출이다 — 노출률 집계에서 뺀다(기존 점수 규칙과 같다).
      if (
        !(usable(r) && question) ||
        r.engineId === "naver" ||
        r.engineId === "daum"
      ) {
        continue;
      }
      const accurate =
        r.brandMentioned && r.mentionQuality === "confirmed" ? 1 : 0;
      for (const tally of question.kind === "discovery"
        ? [byType[question.type], nameLess]
        : [byType[question.type]]) {
        tally.answers += 1;
        tally.mentioned += r.brandMentioned ? 1 : 0;
        tally.accurate += accurate;
      }
    }
  }
  return {
    questionPlanVersion: QUESTION_PLAN_V2,
    engineSetKey: args.checkpoint.engineSetKey,
    usedInScores: false,
    measurementContext: {
      ...args.checkpoint.measurementContext,
      questionsPlanned: args.checkpoint.questionCount,
      questionsAnswered: args.batches.length,
      verification: args.verification,
    },
    questions,
    engineResponses: rows,
    summary: { byType, nameLess },
    metrics: args.checkpoint.metrics ?? null,
    cost: {
      ...args.cost,
      planningLlmKrw: args.checkpoint.metrics?.llmCostKrw ?? 0,
    },
  };
}
