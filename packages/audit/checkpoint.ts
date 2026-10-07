import type { EngineResponse } from "@repo/ai/lib/engines";
import type { RunPrompt } from "./audit-prompts";
import type { DemandQuestionSet } from "./demand-prompts";
import type { OfficialSiteIdentity } from "./official-site-identity";
import {
  enginesForEngineSet,
  isValidShadowCheckpoint,
} from "./plan-v2-contract";
import type { ShadowPlanV2Checkpoint } from "./shadow-plan-v2";

export interface AuditCheckpointScope {
  brandId?: string;
  domain: string;
  language: "ko" | "en" | "both";
  organizationId?: string;
}

export interface AuditCheckpointContext {
  brandName: string;
  brandVariants: string[];
  /** 실제 수요 기반 질문 전체(MEASUREMENT_DEMAND_PROMPTS 일 때만). 재개 시 결과에 그대로 싣는다. */
  demandQuestionSet?: DemandQuestionSet;
  identityGrounded: boolean;
  officialSiteIdentity: OfficialSiteIdentity;
}

export interface AuditCheckpointContinuation {
  /** 지금까지 허락된 이어가기 횟수(1부터). MAX_AUDIT_CONTINUATIONS 를 넘지 않는다. */
  count: number;
  /** 마지막으로 이어가기를 요청한 시각(ISO). 관측용. */
  requestedAt: string;
}

/**
 * 질문×엔진 「칸」 하나의 상태(2026-10-07 · 늦은 엔진 반영 설계 B).
 *   done              — 답을 받았다(또는 스텁). 다시 묻지 않는다.
 *   timed_out_pending — 첫 측정의 개별 상한(60초)에 걸렸다. 「반영 예정」 — 오류가 아니다.
 *   failed            — 최종 실패. 분모에서 빠지고 화면이 엔진 이름을 말한다.
 */
export type AuditCellState = "done" | "timed_out_pending" | "failed";

/** 최종 실패 사유(운영 로그·결과 행 표시용). */
export type AuditCellFailureReason =
  /** 처음부터 늦음이 아닌 오류(429·미연결 등) — 지금까지와 같다. */
  | "engine_error"
  /** 다시 물었는데 또 상한에 걸렸다. */
  | "reask_timed_out"
  /** 다시 물었는데 다른 오류가 났다. */
  | "reask_error"
  /** 다시 묻기를 시작했지만 결과를 저장하기 전에 호출이 끝났다(1회 상한이라 또 묻지 않는다). */
  | "reask_interrupted"
  /** 다시 묻기 전에 이어가기 시간창(2시간)이 지났다. */
  | "window_expired"
  /** 다시 묻기 경로가 없는 실행(무료 진단·관리자 1건·이어가기 소진)이거나 시작할 시간이 없었다. */
  | "not_reasked";

export interface AuditCheckpointCell {
  engineId: string;
  failureReason?: AuditCellFailureReason;
  /** 칸 상태가 처음 정해진 시각(첫 답·첫 상한). */
  firstSettledAt: string;
  promptIndex: number;
  /** 다시 묻기를 시작한 시각. 있으면 이 칸은 다시 묻기 1회를 이미 썼다(결과와 무관). */
  reaskStartedAt?: string;
  state: AuditCellState;
  updatedAt: string;
}

/**
 * 늦은 칸 다시 묻기 회차 기록 — 질문 이어가기(continuation, ×2)와 **따로** 센다(×1).
 */
export interface AuditCheckpointLateReask {
  /** 지금까지 허락된 다시 묻기 회차 수. MAX_LATE_REASK_ROUNDS 를 넘지 않는다. */
  count: number;
  /** 다시 묻기 회차를 끝낸 시각. 있으면 다음 실행은 바로 마감한다. */
  finishedAt?: string;
  requestedAt: string;
}

export interface AuditCheckpoint {
  /**
   * 질문×엔진 칸 상태(2026-10-07). 저장된 질문(responses)의 모든 칸이 들어간다.
   * 없으면(이 기능 이전 checkpoint) responses 에서 다시 만든다(`checkpointCells`).
   */
  cells?: AuditCheckpointCell[];
  context: AuditCheckpointContext;
  /**
   * 마감(질문 시작 상한)으로 잘린 회차의 이어가기 기록(2026-10-06).
   * 없으면 아직 한 번도 이어가지 않은 회차다. 질문 계획(planKey)에는 들어가지 않는다.
   */
  continuation?: AuditCheckpointContinuation;
  /** Bump when provider selection or adapter semantics change. Old plans fail closed. */
  engineConfigVersion: 1;
  enginePlan: string[][];
  /** 늦은 칸 다시 묻기 회차(2026-10-07). 없으면 아직 요청하지 않았다. */
  lateReask?: AuditCheckpointLateReask;
  originCreatedAt: string;
  prompts: RunPrompt[];
  /** Only a contiguous prefix is saved: one whole engine batch per question. */
  responses: EngineResponse[][];
  retry: {
    attempt: number;
    attemptStartResponses: number;
    noProgressFailures: number;
  };
  scope: {
    brandId: string | null;
    domain: string;
    language: "ko" | "en" | "both";
    organizationId: string | null;
  };
  /**
   * 질문 계획 v2 그림자(2026-10-07 · QUESTION_PLAN_V2_SHADOW). 있으면 prompts[startIndex..] 가
   * 그림자 질문이고, 이어가기 상한은 maxContinuations(계획 크기 기반)다. 점수·Tracking 에는 안 쓴다.
   */
  shadowPlanV2?: ShadowPlanV2Checkpoint;
  version: 2;
}

export const MAX_AUDIT_ATTEMPTS = 3;
export const MAX_NO_PROGRESS_FAILURES = 2;
export const MAX_CHECKPOINT_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * 마감으로 잘린 회차를 새 함수 호출로 이어 측정하는 최대 횟수(2026-10-06 관제탑 결정).
 * 원래 실행 1회 + 이어가기 2회 = 최대 3번의 호출. 그래도 남으면 오늘처럼 잠정으로 마감한다.
 */
export const MAX_AUDIT_CONTINUATIONS = 2;
/**
 * 늦은 칸 다시 묻기 회차 상한(2026-10-07 관제탑 설계 B). 질문 이어가기와 별도 카운터다.
 * 한 회차(새 300초 호출 1번)에서 「반영 예정」 칸을 칸마다 최대 1번씩 다시 묻는다.
 */
export const MAX_LATE_REASK_ROUNDS = 1;

/** Bind a checkpoint to its original Job, not merely to a matching brand. */
export function assertCheckpointProvenance(
  checkpoint: AuditCheckpoint,
  jobCreatedAt: Date,
  now = Date.now()
): void {
  if (
    checkpoint.originCreatedAt !== jobCreatedAt.toISOString() ||
    now - jobCreatedAt.getTime() > MAX_CHECKPOINT_AGE_MS ||
    jobCreatedAt.getTime() > now + 60_000
  ) {
    throw new Error("Audit checkpoint provenance or age mismatch");
  }
}

const KOREAN_ENGINES = [
  "chatgpt",
  "claude",
  "perplexity",
  "gemini",
  "naver",
  "daum",
] as const;
const GLOBAL_ENGINES = ["chatgpt", "claude", "perplexity", "gemini"] as const;

export const enginesForAuditPrompt = (lang: "ko" | "en"): readonly string[] =>
  lang === "ko" ? KOREAN_ENGINES : GLOBAL_ENGINES;

/** 질문 하나의 엔진 계획 — 그림자 v2 질문은 엔진 구성 키(daily = Claude 제외)를 따른다. */
export const enginesForRunPrompt = (
  prompt: Pick<RunPrompt, "lang" | "planV2">
): string[] =>
  enginesForEngineSet(
    enginesForAuditPrompt(prompt.lang),
    prompt.planV2?.engineSetKey
  );

/** 이 회차의 이어가기 상한 — 그림자 회차는 계획 크기로 계산한 값, 아니면 기본 2회. */
export const continuationLimitOf = (
  checkpoint: Pick<AuditCheckpoint, "shadowPlanV2">
): number =>
  checkpoint.shadowPlanV2
    ? Math.max(
        MAX_AUDIT_CONTINUATIONS,
        checkpoint.shadowPlanV2.maxContinuations
      )
    : MAX_AUDIT_CONTINUATIONS;

/** 기존 세트 질문 수(그림자 질문은 그 뒤). 그림자가 없으면 전체. */
export const mainPromptCountOf = (
  checkpoint: Pick<AuditCheckpoint, "prompts" | "shadowPlanV2">
): number => checkpoint.shadowPlanV2?.startIndex ?? checkpoint.prompts.length;

export function makeAuditCheckpoint(
  scope: AuditCheckpointScope,
  context: AuditCheckpointContext,
  prompts: RunPrompt[],
  originCreatedAt = new Date().toISOString()
): AuditCheckpoint {
  return {
    version: 2,
    scope: {
      brandId: scope.brandId ?? null,
      domain: scope.domain,
      language: scope.language,
      organizationId: scope.organizationId ?? null,
    },
    context,
    prompts,
    responses: [],
    engineConfigVersion: 1,
    enginePlan: prompts.map((prompt) => enginesForRunPrompt(prompt)),
    originCreatedAt,
    retry: { attempt: 1, attemptStartResponses: 0, noProgressFailures: 0 },
  };
}

/** A retry is explicit and bounded; no-progress failures do not loop forever. */
export function nextAuditCheckpointAttempt(
  checkpoint: AuditCheckpoint
): AuditCheckpoint | null {
  const noProgressFailures =
    checkpoint.responses.length <= checkpoint.retry.attemptStartResponses
      ? checkpoint.retry.noProgressFailures + 1
      : 0;
  if (
    checkpoint.retry.attempt >= MAX_AUDIT_ATTEMPTS ||
    noProgressFailures >= MAX_NO_PROGRESS_FAILURES
  ) {
    return null;
  }
  return {
    ...checkpoint,
    retry: {
      attempt: checkpoint.retry.attempt + 1,
      attemptStartResponses: checkpoint.responses.length,
      noProgressFailures,
    },
  };
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nullableString = (value: unknown): boolean =>
  value === null || typeof value === "string";
const validContinuation = (value: unknown, limit: number): boolean =>
  value === undefined ||
  (object(value) &&
    Number.isInteger(value.count) &&
    (value.count as number) >= 1 &&
    (value.count as number) <= limit &&
    typeof value.requestedAt === "string" &&
    Number.isFinite(Date.parse(value.requestedAt)));

const isoString = (value: unknown): boolean =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const CELL_STATES: readonly unknown[] = ["done", "timed_out_pending", "failed"];
const CELL_FAILURE_REASONS: readonly unknown[] = [
  "engine_error",
  "reask_timed_out",
  "reask_error",
  "reask_interrupted",
  "window_expired",
  "not_reasked",
];
const validLateReask = (value: unknown): boolean =>
  value === undefined ||
  (object(value) &&
    Number.isInteger(value.count) &&
    (value.count as number) >= 1 &&
    (value.count as number) <= MAX_LATE_REASK_ROUNDS &&
    isoString(value.requestedAt) &&
    (value.finishedAt === undefined || isoString(value.finishedAt)));

/**
 * 그림자 기록 — 없으면 어떤 질문에도 planV2 표시가 없어야 하고, 있으면 startIndex 뒤의 질문만
 * 표시가 있어야 한다(앞쪽 기존 세트가 그림자로 새거나, 그림자가 점수 쪽으로 새지 않게).
 */
function validShadow(value: unknown, prompts: unknown): boolean {
  if (!Array.isArray(prompts)) {
    return false;
  }
  const marked = (p: unknown) => object(p) && p.planV2 !== undefined;
  if (value === undefined) {
    return !prompts.some(marked);
  }
  if (
    !isValidShadowCheckpoint(value, prompts.length, MAX_AUDIT_CONTINUATIONS)
  ) {
    return false;
  }
  return prompts.every(
    (p, index) =>
      marked(p) === index >= value.startIndex &&
      (!marked(p) ||
        (object((p as { planV2: unknown }).planV2) &&
          (p as { planV2: { engineSetKey?: unknown } }).planV2.engineSetKey ===
            value.engineSetKey))
  );
}

/** 칸은 저장된 질문(responses) 안의 칸이어야 하고, 칸마다 정확히 하나다. */
function validCells(
  value: unknown,
  responses: unknown[],
  enginePlan: unknown[]
): boolean {
  if (value === undefined) {
    return true;
  }
  if (!Array.isArray(value)) {
    return false;
  }
  const seen = new Set<string>();
  for (const cell of value) {
    if (
      !(
        object(cell) &&
        Number.isInteger(cell.promptIndex) &&
        (cell.promptIndex as number) >= 0 &&
        (cell.promptIndex as number) < responses.length &&
        typeof cell.engineId === "string" &&
        Array.isArray(enginePlan[cell.promptIndex as number]) &&
        (enginePlan[cell.promptIndex as number] as unknown[]).includes(
          cell.engineId
        ) &&
        CELL_STATES.includes(cell.state) &&
        isoString(cell.firstSettledAt) &&
        isoString(cell.updatedAt) &&
        (cell.reaskStartedAt === undefined || isoString(cell.reaskStartedAt)) &&
        (cell.failureReason === undefined ||
          CELL_FAILURE_REASONS.includes(cell.failureReason))
      )
    ) {
      return false;
    }
    const key = `${cell.promptIndex}:${cell.engineId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
  }
  return true;
}

/** Refuse corrupt or cross-brand checkpoints before any paid provider call. */
export function readAuditCheckpoint(
  value: unknown,
  scope: AuditCheckpointScope
): AuditCheckpoint | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!(object(value) && value.version === 2 && object(value.scope))) {
    throw new Error("invalid audit checkpoint");
  }
  if (
    value.scope.brandId !== (scope.brandId ?? null) ||
    value.scope.domain !== scope.domain ||
    value.scope.language !== scope.language ||
    value.scope.organizationId !== (scope.organizationId ?? null)
  ) {
    throw new Error("audit checkpoint scope mismatch");
  }
  const context = value.context;
  const identity = object(context) ? context.officialSiteIdentity : null;
  const prompts = value.prompts;
  const responses = value.responses;
  const enginePlan = value.enginePlan;
  const retry = value.retry;
  if (
    value.engineConfigVersion !== 1 ||
    typeof value.originCreatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.originCreatedAt)) ||
    !object(retry) ||
    !Number.isInteger(retry.attempt) ||
    (retry.attempt as number) < 1 ||
    (retry.attempt as number) > MAX_AUDIT_ATTEMPTS ||
    !Number.isInteger(retry.attemptStartResponses) ||
    (retry.attemptStartResponses as number) < 0 ||
    !Number.isInteger(retry.noProgressFailures) ||
    (retry.noProgressFailures as number) < 0 ||
    !validShadow(value.shadowPlanV2, prompts) ||
    !validContinuation(
      value.continuation,
      object(value.shadowPlanV2) &&
        typeof value.shadowPlanV2.maxContinuations === "number"
        ? Math.max(MAX_AUDIT_CONTINUATIONS, value.shadowPlanV2.maxContinuations)
        : MAX_AUDIT_CONTINUATIONS
    ) ||
    !validLateReask(value.lateReask) ||
    !object(context) ||
    typeof context.brandName !== "string" ||
    !Array.isArray(context.brandVariants) ||
    !context.brandVariants.every((name) => typeof name === "string") ||
    typeof context.identityGrounded !== "boolean" ||
    !object(identity) ||
    typeof identity.finalUrl !== "string" ||
    ![
      identity.title,
      identity.description,
      identity.h1,
      identity.siteName,
    ].every(nullableString) ||
    !Array.isArray(prompts) ||
    !prompts.every(
      (prompt) =>
        object(prompt) &&
        typeof prompt.text === "string" &&
        (prompt.lang === "ko" || prompt.lang === "en") &&
        (prompt.promptId === undefined ||
          typeof prompt.promptId === "string") &&
        (prompt.kind === undefined ||
          prompt.kind === "brand" ||
          prompt.kind === "discovery")
    ) ||
    !Array.isArray(enginePlan) ||
    enginePlan.length !== prompts.length ||
    !enginePlan.every(
      (plan, index) =>
        Array.isArray(plan) &&
        plan.length === enginesForRunPrompt(prompts[index]).length &&
        plan.every(
          (id, position) => id === enginesForRunPrompt(prompts[index])[position]
        )
    ) ||
    !Array.isArray(responses) ||
    responses.length > prompts.length ||
    (retry.attemptStartResponses as number) > responses.length ||
    !responses.every(
      (batch, promptIndex) =>
        Array.isArray(batch) &&
        batch.length === enginePlan[promptIndex]?.length &&
        batch.every(
          (row, engineIndex) =>
            object(row) &&
            row.engineId === enginePlan[promptIndex]?.[engineIndex] &&
            typeof row.engineId === "string" &&
            typeof row.rawResponse === "string" &&
            typeof row.brandMentioned === "boolean" &&
            Array.isArray(row.citedSources) &&
            typeof row.durationMs === "number" &&
            typeof row.isStub === "boolean" &&
            nullableString(row.errorMessage)
        )
    ) ||
    !validCells(value.cells, responses, enginePlan)
  ) {
    throw new Error("invalid audit checkpoint");
  }
  return value as unknown as AuditCheckpoint;
}
