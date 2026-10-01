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
  prompts: RunPrompt[];
  /** Only a contiguous prefix is saved: one whole engine batch per question. */
  responses: EngineResponse[][];
  scope: {
    brandId: string | null;
    domain: string;
    language: "ko" | "en" | "both";
    organizationId: string | null;
  };
  version: 1;
}

export function makeAuditCheckpoint(
  scope: AuditCheckpointScope,
  context: AuditCheckpointContext,
  prompts: RunPrompt[]
): AuditCheckpoint {
  return {
    version: 1,
    scope: {
      brandId: scope.brandId ?? null,
      domain: scope.domain,
      language: scope.language,
      organizationId: scope.organizationId ?? null,
    },
    context,
    prompts,
    responses: [],
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
  if (!(object(value) && value.version === 1 && object(value.scope))) {
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
  if (
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
        (prompt.kind === undefined ||
          prompt.kind === "brand" ||
          prompt.kind === "discovery")
    ) ||
    !Array.isArray(responses) ||
    responses.length > prompts.length ||
    !responses.every(
      (batch) =>
        Array.isArray(batch) &&
        batch.length > 0 &&
        batch.every(
          (row) =>
            object(row) &&
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
