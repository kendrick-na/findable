import type { EngineResponse } from "@repo/ai/lib/engines";
import type { RunPrompt } from "./audit-prompts";
import type { OfficialSiteIdentity } from "./official-site-identity";

export interface AuditCheckpointScope {
  brandId?: string;
  domain: string;
  language: "ko" | "en" | "both";
  organizationId?: string;
}

export interface AuditCheckpointContext {
  brandName: string;
  brandVariants: string[];
  identityGrounded: boolean;
  officialSiteIdentity: OfficialSiteIdentity;
}

export interface AuditCheckpoint {
  context: AuditCheckpointContext;
  /** Bump when provider selection or adapter semantics change. Old plans fail closed. */
  engineConfigVersion: 1;
  enginePlan: string[][];
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
  version: 2;
}

export const MAX_AUDIT_ATTEMPTS = 3;
export const MAX_NO_PROGRESS_FAILURES = 2;
export const MAX_CHECKPOINT_AGE_MS = 24 * 60 * 60 * 1000;

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
    enginePlan: prompts.map((prompt) => [
      ...enginesForAuditPrompt(prompt.lang),
    ]),
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
        plan.length === enginesForAuditPrompt(prompts[index].lang).length &&
        plan.every(
          (id, position) =>
            id === enginesForAuditPrompt(prompts[index].lang)[position]
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
    )
  ) {
    throw new Error("invalid audit checkpoint");
  }
  return value as unknown as AuditCheckpoint;
}
