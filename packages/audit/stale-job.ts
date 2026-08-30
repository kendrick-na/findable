export const AUDIT_JOB_STALE_AFTER_MS = 6 * 60 * 1000;

export const AUDIT_JOB_STALE_ERROR =
  "FUNCTION_INVOCATION_TIMEOUT: 측정 처리 시간이 6분을 초과해 자동 종료했습니다. 다시 측정해 주세요.";

export type PendingAuditStatus = "queued" | "processing";

export const isStaleAuditJob = (
  job: { createdAt: Date; status: string },
  now = Date.now()
): boolean =>
  (job.status === "queued" || job.status === "processing") &&
  job.createdAt.getTime() < now - AUDIT_JOB_STALE_AFTER_MS;
