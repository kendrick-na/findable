/**
 * The public free-audit entry point deliberately works without a Clerk session.
 * A Preview may run without a Clerk server secret, so the proxy must not invoke
 * Clerk before these explicitly public routes run. This includes the read-only,
 * capability-URL client report. On Preview the audit runner is always in stub
 * mode (`@repo/audit/audit-stub`), so these routes cannot spend AI budget.
 * Keep this narrowly scoped: every other API, admin, auth and mail route still
 * passes through Clerk.
 */
type PreviewEnvironment = Readonly<{
  VERCEL_ENV?: string;
}>;

const AUDIT_JOB_STATUS_RE =
  /^\/api\/audit\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_REPORT_RE = /^\/r\/[A-Za-z0-9_-]{1,128}\/?$/;

export function isPreviewStubPublicRequest(
  pathname: string,
  environment: PreviewEnvironment = { VERCEL_ENV: process.env.VERCEL_ENV }
): boolean {
  if (environment.VERCEL_ENV !== "preview") {
    return false;
  }

  return (
    pathname === "/api/audit" ||
    AUDIT_JOB_STATUS_RE.test(pathname) ||
    CLIENT_REPORT_RE.test(pathname)
  );
}
