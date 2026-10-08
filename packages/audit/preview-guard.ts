// Vercel Preview side-effect guard (2026-10-05).
//
// A Preview deployment may hold real provider keys or point at a shared
// database. Anything that spends money or leaves the deployment (paid AI
// without a stub, PDF render + Blob upload) must refuse there. Kept free of
// imports so cheap call sites (PDF generator, crew, briefing) can use it.

/** True on a Vercel Preview deployment (never on production or local dev). */
export function isVercelPreview(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.VERCEL_ENV === "preview";
}

/**
 * Throws on a Vercel Preview deployment. Call it before any paid or external
 * side effect that has no stub (crew analysis, Naver briefing, PDF/Blob).
 */
export function assertNotVercelPreview(
  action: string,
  env: Record<string, string | undefined> = process.env
): void {
  if (isVercelPreview(env)) {
    throw new Error(`${action} is disabled on Vercel Preview deployments`);
  }
}
