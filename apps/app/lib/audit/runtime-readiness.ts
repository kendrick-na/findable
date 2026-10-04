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
