/**
 * 마감으로 잘린 측정의 「이어가기」(2026-10-06 · 관제탑 승인).
 *
 * 🔴 왜 필요한가
 *   러너는 함수 상한(300초) 안에서 270초 마감 35초 전부터 새 유료 질문을 시작하지 않는다.
 *   질문이 남은 채로 끝나면 지금까지는 그대로 「잠정(provisional)」 공개였고,
 *   확정값을 보려면 처음부터 다시 측정(원가 2배)해야 했다.
 *
 * 상태 기계(새 enum·컬럼 없음 — 기존 AuditJob 필드만 쓴다):
 *
 *   queued ──claim──▶ processing ──(질문 다 끝남)──────────────▶ completed (확정/잠정 판정은 기존 그대로)
 *                        │
 *                        └─(질문 남음 · 이어가기 < 2회)──▶ queued + leaseUntil(=이어가기 대기)
 *                                                          checkpoint.continuation.count += 1
 *   이어가기 대기 ──claim(새 함수 호출 = 새 300초)──▶ processing ── 남은 질문만 ── …
 *   이어가기 2회를 다 쓰고도 남음 → 기존과 똑같이 잠정(provisional)으로 completed.
 *   이어가기 대기 시간창(2시간)이 지나도록 아무도 안 집어 감 → 실패가 아니라
 *     **새 질문 없이** 저장된 답으로 잠정(provisional) completed(finalizeOnly · Tracking 1회).
 *     같은 claim 을 거치므로 늦게 온 이어가기와 동시에 마감되지 않는다.
 *
 *   · 동시 실행 금지: 이어가기는 반드시 `claimAuditExecution`(queued→processing 원자 갱신)을
 *     거친다. 화면과 cron 이 같은 순간 집어도 한쪽만 이긴다(진 쪽은 claim_skipped 로 끝).
 *   · 이미 받은 답은 다시 묻지 않는다: checkpoint.responses 가 질문 단위로 저장돼 있고
 *     스케줄러가 그 앞부분을 건너뛴다(run-checkpointed-questions).
 *   · Tracking·추세는 최종 completed 때 한 번만: 대기로 돌아갈 때는 집계·커밋을 하지 않는다.
 */

import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { isAuditContinuationPending } from "./audit-execution-lease";
import { runAuditJob } from "./runner";

/** DB JSON 별칭 필드에서 실제 문자열만 골라 러너에 넘긴다. */
const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.trim() !== ""
      )
    : [];

export type AuditContinuationMode = "continue" | "finalize";

export type AuditContinuationOutcome =
  | { jobId: string; mode: AuditContinuationMode; ran: true; status: string }
  | { jobId: string; ran: false; reason: "not_found" | "not_pending" };

/**
 * 이어가기 대기 Job 하나를 처리한다.
 *   · 시간창 안 → 남은 질문만 이어서 실행(mode=continue).
 *   · 시간창이 지남 → 새 질문 없이 저장된 답으로 잠정 마감(mode=finalize).
 *
 * 입력은 Job 행에서 다시 만든다 — 호출부(화면 서버액션·cron)가 값을 넘기지 않아
 * org↔brand 정합을 서버가 보장한다. `organizationId` 를 주면 그 org 의 Job 만 다룬다.
 * 실제 동시 실행 방지는 러너의 claim 이 한다(여기서 확인한 뒤 다른 쪽이 먼저 집어도 안전).
 */
export async function continueAuditJob(
  jobId: string,
  options: { invocationStartedAtMs: number; organizationId?: string }
): Promise<AuditContinuationOutcome> {
  const job = await database.auditJob.findFirst({
    where: {
      id: jobId,
      ...(options.organizationId
        ? { email: `org:${options.organizationId}` }
        : {}),
    },
    select: {
      id: true,
      status: true,
      leaseUntil: true,
      domain: true,
      language: true,
      industry: true,
      organizationId: true,
      brandId: true,
      checkpoint: true,
    },
  });
  if (!job) {
    return { jobId, ran: false, reason: "not_found" };
  }
  if (!(isAuditContinuationPending(job) && job.organizationId && job.brandId)) {
    return { jobId, ran: false, reason: "not_pending" };
  }
  const mode: AuditContinuationMode =
    job.leaseUntil && job.leaseUntil.getTime() < Date.now()
      ? "finalize"
      : "continue";
  const brand = await database.brand.findUnique({
    where: { id: job.brandId },
    select: { name: true, entityVariants: true, marketScope: true },
  });
  log.info(
    mode === "finalize"
      ? "audit.continuation.expired"
      : "audit.continuation.started",
    { jobId, continuation: continuationCountOf(job.checkpoint) }
  );
  await runAuditJob({
    invocationStartedAtMs: options.invocationStartedAtMs,
    jobId: job.id,
    domain: job.domain,
    language: job.language,
    brandName: brand?.name,
    brandVariants: stringList(brand?.entityVariants),
    organizationId: job.organizationId,
    brandId: job.brandId,
    industry: job.industry ?? undefined,
    marketScope: brand?.marketScope ?? undefined,
    continueWhenTruncated: true,
    finalizeOnly: mode === "finalize",
  });
  const finished = await database.auditJob.findUnique({
    where: { id: job.id },
    select: { status: true },
  });
  return { jobId, mode, ran: true, status: finished?.status ?? "unknown" };
}

/** 로그용 — 지금까지 허락된 이어가기 횟수(checkpoint.continuation.count). 없으면 0. */
function continuationCountOf(checkpoint: unknown): number {
  if (
    checkpoint &&
    typeof checkpoint === "object" &&
    !Array.isArray(checkpoint) &&
    "continuation" in checkpoint
  ) {
    const continuation = checkpoint.continuation;
    if (
      continuation &&
      typeof continuation === "object" &&
      !Array.isArray(continuation) &&
      "count" in continuation &&
      typeof continuation.count === "number"
    ) {
      return continuation.count;
    }
  }
  return 0;
}

/**
 * cron 용 — 이어가기 대기 중 **가장 오래 기다린 것 하나**를 처리한다
 * (시간창이 지난 것이 가장 오래됐으므로 잠정 마감이 먼저 처리된다).
 * 한 cron 호출은 유료 실행 1건만 한다(300초 상한 · auto-refresh-tracking 규칙).
 * 대기 건이 없으면 null.
 */
export async function continueOldestPendingAudit(options: {
  invocationStartedAtMs: number;
  /** 시간창이 지난 대기(잠정 마감)만 처리한다 — 정리 cron 용. */
  expiredOnly?: boolean;
}): Promise<AuditContinuationOutcome | null> {
  const pending = await database.auditJob.findFirst({
    where: {
      status: "queued",
      leaseUntil: options.expiredOnly ? { lt: new Date() } : { not: null },
      organizationId: { not: null },
      brandId: { not: null },
    },
    orderBy: { attemptStartedAt: "asc" },
    select: { id: true },
  });
  if (!pending) {
    return null;
  }
  return await continueAuditJob(pending.id, {
    invocationStartedAtMs: options.invocationStartedAtMs,
  });
}
