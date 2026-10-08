"use server";

import { continueAuditJob } from "@repo/audit/audit-continuation";
import { isAuditContinuationPending } from "@repo/audit/audit-execution-lease";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { after } from "next/server";
import { getAuditRuntimeReadiness } from "@/lib/audit/runtime-readiness";
import { requireOrg } from "@/lib/db/scoped";

/**
 * 마감으로 잘린 측정 「이어가기」 서버 액션(2026-10-06).
 *
 * 측정 화면 폴링이 `getTrackingStatus` 에서 `needs_continuation` 을 보면 **한 번** 부른다.
 * 서버 액션 호출 = 새 함수 호출이라 300초 예산을 새로 받는다(maxDuration 은 이 액션을
 * 쓰는 page 의 값 — 대시보드·브랜드·측정 대기 화면 모두 300).
 *
 * 🔒 jobId 외 입력은 받지 않는다. org 는 세션에서 재도출하고, 실행 입력은 Job 행에서 만든다.
 * 🔒 같은 Job 의 이어가기가 둘 동시에 돌지 않는다 — 러너 claim(queued→processing 원자 갱신)이
 *   한쪽만 통과시킨다(화면 두 개·cron 이 겹쳐도 유료 호출은 한 번).
 */
export type ContinueTrackingResult =
  | { ok: true }
  | { ok: false; reason: "unauthorized" | "not_pending" | "not_configured" };

export const continueOrgTracking = async (
  jobId: string
): Promise<ContinueTrackingResult> => {
  const invocationStartedAtMs = Date.now();
  let orgId: string;
  try {
    orgId = await requireOrg();
  } catch {
    return { ok: false, reason: "unauthorized" };
  }

  const job = await database.auditJob.findFirst({
    where: { id: jobId, email: `org:${orgId}` },
    select: { id: true, status: true, leaseUntil: true },
  });
  if (!(job && isAuditContinuationPending(job))) {
    return { ok: false, reason: "not_pending" };
  }
  if (!getAuditRuntimeReadiness().ready) {
    // 설정이 없으면 여기서 돌리지 않는다 — Job 은 대기로 남아 cron 이 다시 시도한다.
    return { ok: false, reason: "not_configured" };
  }

  after(async () => {
    try {
      const outcome = await continueAuditJob(jobId, {
        invocationStartedAtMs,
        organizationId: orgId,
      });
      log.info("audit.org.continuation_finished", { ...outcome });
    } catch (error) {
      log.error("audit.org.continuation_uncaught", {
        jobId,
        error: parseError(error),
      });
    }
  });
  return { ok: true };
};
