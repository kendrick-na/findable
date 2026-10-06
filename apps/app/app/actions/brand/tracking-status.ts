"use server";

import { isAuditContinuationPending } from "@repo/audit/audit-execution-lease";
import { reconcileStaleAuditJob } from "@repo/audit/stale-job";
import { database } from "@repo/database";
import { requireOrg } from "@/lib/db/scoped";

/**
 * 측정 진행 상태 폴링 — "측정 시작" 버튼이 완료/실패를 알려주기 위해 주기 호출한다(UX: 진행상태 가시화).
 * org 소유 job(email=`org:${orgId}`)만 조회 → 다른 조직 job은 not_found.
 *
 * `needs_continuation`(2026-10-06): 마감으로 질문이 남아 「이어가기 대기」인 job.
 *   화면은 이 값을 보면 `continueOrgTracking` 을 한 번 부르고 계속 폴링한다(아직 진행 중).
 */

export type TrackingJobStatus =
  | "queued"
  | "needs_continuation"
  | "processing"
  | "completed"
  | "failed"
  | "not_found";

export const getTrackingStatus = async (
  jobId: string
): Promise<TrackingJobStatus> => {
  let orgId: string;
  try {
    orgId = await requireOrg();
  } catch {
    return "not_found";
  }

  const job = await database.auditJob.findFirst({
    where: { id: jobId, email: `org:${orgId}` },
    select: {
      id: true,
      email: true,
      status: true,
      createdAt: true,
      attemptStartedAt: true,
      leaseUntil: true,
    },
  });
  if (!job) {
    return "not_found";
  }
  const status = await reconcileStaleAuditJob(job);
  if (status === "queued" && isAuditContinuationPending(job)) {
    return "needs_continuation";
  }
  return status ?? "not_found";
};
