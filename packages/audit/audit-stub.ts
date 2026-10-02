// Preview-only audit stub mode (2026-10-02).
//
// FINDABLE_AUDIT_STUB_MODE=1 swaps every paid or network call runAuditJob makes
// — brand identity LLM, official-site fetch, engine adapters, mention verdict
// LLM — for deterministic local data, so a synthetic measurement on an
// isolated Preview DB can exercise claim → checkpoint → resume → commit
// without spending provider credits. PDF and Naver briefing are skipped by the
// runner in this mode (both are external side effects of a fake result).
//
// Without the flag the runner receives the real functions unchanged.
// The flag is refused on VERCEL_ENV=production: stub numbers must never be
// stored next to customer measurements.

import { resolveBrandIdentity } from "@repo/ai/lib/brand-identity";
import {
  type EngineId,
  type EngineResponse,
  queryAllEngines,
} from "@repo/ai/lib/engines";
import {
  type VerifiableResponse,
  verifyMentions,
} from "@repo/ai/lib/mention-verdict";
import type { AuditCheckpoint } from "./checkpoint";
import { resolveOfficialSiteIdentity } from "./official-site-identity";

export const AUDIT_STUB_ENV = "FINDABLE_AUDIT_STUB_MODE";
/** Every stub answer starts with this; live answers never may. */
export const AUDIT_STUB_MARKER = "[FINDABLE_AUDIT_STUB]";

/** Opt-in only on the exact value "1"; refused in Vercel production. */
export function auditStubModeEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env[AUDIT_STUB_ENV] !== "1") {
    return false;
  }
  if (env.VERCEL_ENV === "production") {
    throw new Error(
      `${AUDIT_STUB_ENV}=1 is not allowed in production; remove it from the production environment`
    );
  }
  return true;
}

const SCHEME_RE = /^https?:\/\//;
const WWW_RE = /^www\./;
const HOST_SPLIT_RE = /[/.]/;

const hostLabel = (domain: string): string =>
  domain.replace(SCHEME_RE, "").replace(WWW_RE, "").split(HOST_SPLIT_RE)[0] ||
  domain;

type QueryAllEngines = typeof queryAllEngines;

const stubQueryAllEngines: QueryAllEngines = (base, engineIds, onEngineEvent) =>
  Promise.resolve(
    (engineIds ?? []).map((engineId: EngineId, index): EngineResponse => {
      onEngineEvent?.({ engineId, phase: "started" });
      // Deterministic, alternating mention so aggregation has both cases.
      const mentioned = index % 2 === 0;
      const rawResponse = `${AUDIT_STUB_MARKER} ${engineId} synthetic answer for "${base.prompt}". ${
        mentioned ? base.brandName : "No brand named."
      }`;
      onEngineEvent?.({ engineId, phase: "finished", status: "fulfilled" });
      return {
        brandMentioned: mentioned,
        citedSources: [],
        durationMs: 0,
        engineId,
        errorMessage: null,
        isStub: true,
        mentionListSize: null,
        mentionPosition: mentioned ? 1 : null,
        rawResponse,
        sentiment: null,
        shareOfVoice: null,
      };
    })
  );

// Same output shape verifyMentions gives stub rows ("skipped"), with no LLM.
const stubVerifyMentions = (<T extends VerifiableResponse>(responses: T[]) =>
  Promise.resolve(
    responses.map((row) => ({
      ...row,
      mentionQuality: "absent" as const,
      verdictVia: "skipped",
    }))
  )) as unknown as typeof verifyMentions;

export interface AuditAiDeps {
  queryAllEngines: QueryAllEngines;
  resolveBrandIdentity: typeof resolveBrandIdentity;
  resolveOfficialSiteIdentity: typeof resolveOfficialSiteIdentity;
  stubMode: boolean;
  verifyMentions: typeof verifyMentions;
}

export const liveAuditAi: AuditAiDeps = {
  stubMode: false,
  queryAllEngines,
  resolveBrandIdentity,
  resolveOfficialSiteIdentity,
  verifyMentions,
};

export const stubAuditAi: AuditAiDeps = {
  stubMode: true,
  queryAllEngines: stubQueryAllEngines,
  resolveBrandIdentity: (domain, formBrandName) =>
    Promise.resolve({
      brandName: formBrandName?.trim() || hostLabel(domain),
      brandVariants: [],
    }),
  resolveOfficialSiteIdentity: (domain) => {
    const label = hostLabel(domain);
    return Promise.resolve({
      finalUrl: `https://${domain.replace(SCHEME_RE, "")}/`,
      title: `${AUDIT_STUB_MARKER} ${label}`,
      description: `${AUDIT_STUB_MARKER} synthetic official-site identity`,
      h1: label,
      siteName: label,
    });
  },
  verifyMentions: stubVerifyMentions,
};

export function selectAuditAi(
  env: Record<string, string | undefined> = process.env
): AuditAiDeps {
  return auditStubModeEnabled(env) ? stubAuditAi : liveAuditAi;
}

/** A stub checkpoint must never resume live, nor a live one resume as stub. */
export function assertCheckpointMode(
  checkpoint: AuditCheckpoint,
  stubMode: boolean
): void {
  const mixed = checkpoint.responses.some((batch) =>
    batch.some(
      (row) => row.rawResponse.startsWith(AUDIT_STUB_MARKER) !== stubMode
    )
  );
  if (mixed) {
    throw new Error(
      stubMode
        ? "Audit checkpoint holds live answers; stub mode refuses to resume it"
        : "Audit checkpoint holds stub answers; live mode refuses to resume it"
    );
  }
}
