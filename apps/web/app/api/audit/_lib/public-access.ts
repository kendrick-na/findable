/**
 * Public access rules for audit jobs.
 *
 * Free jobs are intentionally link-readable. Workspace jobs are private and
 * must never enter the anonymous cache or public result route.
 */

export interface AuditJobVisibility {
  email?: string | null;
  organizationId?: string | null;
}

const ORG_EMAIL_PREFIX = "org:";

export function canUseAnonymousAuditCache(job: AuditJobVisibility): boolean {
  return (
    job.organizationId == null &&
    !job.email?.trim().toLowerCase().startsWith(ORG_EMAIL_PREFIX)
  );
}

export function canExposeAuditResult(
  job: AuditJobVisibility,
  isOwner: boolean
): boolean {
  return canUseAnonymousAuditCache(job) || isOwner;
}
