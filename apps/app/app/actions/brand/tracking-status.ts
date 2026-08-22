"use server";

import { database } from "@repo/database";
import { requireOrg } from "@/lib/db/scoped";

/**
 * 측정 진행 상태 폴링 — "측정 시작" 버튼이 완료/실패를 알려주기 위해 주기 호출한다(UX: 진행상태 가시화).
 * org 소유 job(email=`org:${orgId}`)만 조회 → 다른 조직 job은 not_found.
 */

export type TrackingJobStatus =
  | "queued"
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
    select: { status: true },
  });

  return (job?.status as TrackingJobStatus | undefined) ?? "not_found";
};
