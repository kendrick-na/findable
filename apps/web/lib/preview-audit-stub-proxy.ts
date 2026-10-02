/**
 * The public free-audit entry point deliberately works without a Clerk session.
 * A stub-only Preview has no server Clerk secret, so the proxy must not invoke
 * Clerk before those two public routes run. Keep this narrowly scoped: every
 * other API, admin, auth, and mail route still passes through Clerk.
 */
type PreviewStubEnvironment = Readonly<{
  VERCEL_ENV?: string;
  FINDABLE_AUDIT_STUB_MODE?: string;
}>;

export function isPreviewStubAuditRequest(
  pathname: string,
  environment: PreviewStubEnvironment = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    FINDABLE_AUDIT_STUB_MODE: process.env.FINDABLE_AUDIT_STUB_MODE,
  }
): boolean {
  if (
    environment.VERCEL_ENV !== "preview" ||
    environment.FINDABLE_AUDIT_STUB_MODE !== "1"
  ) {
    return false;
  }

  return (
    pathname === "/api/audit" ||
    /^\/api\/audit\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      pathname
    )
  );
}
