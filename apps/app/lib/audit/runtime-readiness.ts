type RuntimeEnv = Record<string, string | undefined>;

const present = (value: string | undefined): boolean =>
  Boolean(value?.trim());

/**
 * Checks only configuration that is required for a real audit run.
 *
 * This is intentionally a pure helper: the server action must not create an
 * AuditJob and then discover that the background runner can only return stub
 * responses (or that the optional briefing path cannot run).
 */
export function getAuditRuntimeReadiness(
  env: RuntimeEnv = process.env
): { ready: true } | { ready: false; missing: string[] } {
  const missing: string[] = [];
  const gatewayReady =
    present(env.AI_GATEWAY_API_KEY) ||
    present(env.VERCEL_OIDC_TOKEN) ||
    env.FINDABLE_FORCE_LIVE === "1";

  if (!present(env.DATABASE_URL) && !present(env.FINDABLE_DATABASE_URL)) {
    missing.push("DATABASE_URL");
  }
  if (!present(env.LETSUR_API_KEY) && !gatewayReady) {
    missing.push("LETSUR_API_KEY 또는 AI Gateway 인증");
  }
  if (!present(env.GOOGLE_API_KEY) && !gatewayReady) {
    missing.push("GOOGLE_API_KEY 또는 AI Gateway 인증");
  }
  if (!present(env.PERPLEXITY_API_KEY) && !gatewayReady) {
    missing.push("PERPLEXITY_API_KEY 또는 AI Gateway 인증");
  }
  if (
    env.AUDIT_BRIEFING_IN_MAIN_ENABLED === "true" &&
    !present(env.FIRECRAWL_API_KEY)
  ) {
    missing.push("FIRECRAWL_API_KEY");
  }

  return missing.length > 0 ? { ready: false, missing } : { ready: true };
}
