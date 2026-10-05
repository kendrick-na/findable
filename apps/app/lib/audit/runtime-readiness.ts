import { isVercelPreview } from "@repo/audit/preview-guard";

type RuntimeEnv = Record<string, string | undefined>;

const present = (value: string | undefined): boolean => Boolean(value?.trim());

/**
 * Checks only configuration that is required for a real audit run.
 *
 * This is intentionally a pure helper: the server action must not create an
 * AuditJob and then discover that the background runner can only return stub
 * responses. On-demand briefing has its own request path and must not gate core.
 */
export function getAuditRuntimeReadiness(
  env: RuntimeEnv = process.env
): { ready: true } | { ready: false; missing: string[] } {
  const missing: string[] = [];
  const gatewayReady =
    present(env.AI_GATEWAY_API_KEY) || present(env.VERCEL_OIDC_TOKEN);

  if (!(present(env.DATABASE_URL) || present(env.FINDABLE_DATABASE_URL))) {
    missing.push("DATABASE_URL");
  }
  // Stub mode (forced on Preview, opt-in "1" locally) never calls a provider,
  // so provider keys are not required. Production never runs stub mode
  // (auditStubModeEnabled refuses it), so this cannot loosen the live gate.
  const stubMode =
    env.VERCEL_ENV !== "production" &&
    (isVercelPreview(env) || env.FINDABLE_AUDIT_STUB_MODE === "1");
  if (stubMode) {
    return missing.length > 0 ? { ready: false, missing } : { ready: true };
  }
  if (!(present(env.LETSUR_API_KEY) || gatewayReady)) {
    missing.push("LETSUR_API_KEY 또는 AI Gateway 인증");
  }
  if (!(present(env.GOOGLE_API_KEY) || gatewayReady)) {
    missing.push("GOOGLE_API_KEY 또는 AI Gateway 인증");
  }
  if (!(present(env.PERPLEXITY_API_KEY) || gatewayReady)) {
    missing.push("PERPLEXITY_API_KEY 또는 AI Gateway 인증");
  }
  return missing.length > 0 ? { ready: false, missing } : { ready: true };
}
