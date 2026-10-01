import { type AuditStatus, database } from "@repo/database";

export const AUDIT_JOB_STALE_AFTER_MS = 6 * 60 * 1000;

export const AUDIT_JOB_STALE_ERROR =
  "FUNCTION_INVOCATION_TIMEOUT: 측정 처리 시간이 6분을 초과해 자동 종료했습니다. 다시 측정해 주세요.";

export type PendingAuditStatus = "queued" | "processing";

export const isStaleAuditJob = (
  job: {
    createdAt: Date;
    attemptStartedAt?: Date | null;
    leaseUntil?: Date | null;
    status: string;
  },
  now = Date.now()
): boolean =>
  (job.status === "queued" || job.status === "processing") &&
  (job.leaseUntil
    ? job.leaseUntil.getTime() < now
    : (job.attemptStartedAt ?? job.createdAt).getTime() <
      now - AUDIT_JOB_STALE_AFTER_MS);

/** Finalize jobs killed by the serverless time limit before runner catch ran. */
export async function reconcileStaleAuditJob(job: {
  id: string;
  email: string;
  createdAt: Date;
  attemptStartedAt?: Date | null;
  leaseUntil?: Date | null;
  status: AuditStatus;
}): Promise<AuditStatus | null> {
  if (!isStaleAuditJob(job)) {
    return job.status;
  }
  const expiredAt = new Date();
  const staleBefore = new Date(expiredAt.getTime() - AUDIT_JOB_STALE_AFTER_MS);
  const staleWhere = (() => {
    if (job.leaseUntil) {
      return { leaseUntil: { lt: expiredAt } };
    }
    if (job.attemptStartedAt) {
      return { leaseUntil: null, attemptStartedAt: { lt: staleBefore } };
    }
    return {
      leaseUntil: null,
      attemptStartedAt: null,
      createdAt: { lt: staleBefore },
    };
  })();
  const expired = await database.auditJob.updateMany({
    where: {
      id: job.id,
      email: job.email,
      status: { in: ["queued", "processing"] },
      ...staleWhere,
    },
    data: {
      status: "failed",
      errorMessage: AUDIT_JOB_STALE_ERROR,
      completedAt: new Date(),
      leaseToken: null,
      leaseUntil: null,
    },
  });
  if (expired.count > 0) {
    return "failed";
  }
  const current = await database.auditJob.findUnique({
    where: { id: job.id },
    select: { status: true },
  });
  return current?.status ?? null;
}
