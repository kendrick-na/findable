import { type AuditStatus, database } from "@repo/database";

export const AUDIT_JOB_STALE_AFTER_MS = 6 * 60 * 1000;
export const AUDIT_JOB_QUEUE_STALE_AFTER_MS = 30 * 60 * 1000;

export const AUDIT_JOB_STALE_ERROR =
  "FUNCTION_INVOCATION_TIMEOUT: 측정 처리 시간이 6분을 초과해 자동 종료했습니다. 다시 측정해 주세요.";
export const AUDIT_JOB_QUEUE_STALE_ERROR =
  "QUEUE_START_TIMEOUT: 측정 실행이 시작되지 않아 자동 종료했습니다. 다시 측정해 주세요.";

export type PendingAuditStatus = "queued" | "processing";

// 🔴 2026-10-06: queued 도 leaseUntil 이 있으면 그 시각으로 판정한다.
//   마감으로 잘린 회차의 「이어가기 대기」(queued + leaseUntil, audit-execution-lease)는
//   30분 cron 을 기다려야 해서 일반 대기열의 30분 상한으로 죽이면 안 된다.
//   leaseUntil 이 없는 queued(새 Job·관리자 재개)는 기존 30분 규칙 그대로다.
export const isStaleAuditJob = (
  job: {
    createdAt: Date;
    attemptStartedAt?: Date | null;
    leaseUntil?: Date | null;
    status: string;
  },
  now = Date.now()
): boolean => {
  if (job.status !== "queued" && job.status !== "processing") {
    return false;
  }
  if (job.leaseUntil) {
    return job.leaseUntil.getTime() < now;
  }
  return (
    (job.attemptStartedAt ?? job.createdAt).getTime() <
    now -
      (job.status === "queued"
        ? AUDIT_JOB_QUEUE_STALE_AFTER_MS
        : AUDIT_JOB_STALE_AFTER_MS)
  );
};

/**
 * Bulk form of `isStaleAuditJob` for the sweep cron: same thresholds and the
 * same lease rule, so the cron never fails a job the per-job check still
 * treats as alive (e.g. a queued job younger than the queue limit).
 */
export const staleAuditJobsWhere = (
  status: PendingAuditStatus,
  now = new Date()
) => {
  const before = new Date(
    now.getTime() -
      (status === "queued"
        ? AUDIT_JOB_QUEUE_STALE_AFTER_MS
        : AUDIT_JOB_STALE_AFTER_MS)
  );
  const aged = [
    { attemptStartedAt: { lt: before } },
    { attemptStartedAt: null, createdAt: { lt: before } },
  ];
  // queued·processing 모두 같은 lease 규칙(위 isStaleAuditJob 주석).
  return {
    status,
    OR: [
      { leaseUntil: { lt: now } },
      ...aged.map((clause) => ({ leaseUntil: null, ...clause })),
    ],
  };
};

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
  const staleBefore = new Date(
    expiredAt.getTime() -
      (job.status === "queued"
        ? AUDIT_JOB_QUEUE_STALE_AFTER_MS
        : AUDIT_JOB_STALE_AFTER_MS)
  );
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
      status: job.status,
      ...staleWhere,
    },
    data: {
      status: "failed",
      errorMessage:
        job.status === "queued"
          ? AUDIT_JOB_QUEUE_STALE_ERROR
          : AUDIT_JOB_STALE_ERROR,
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
