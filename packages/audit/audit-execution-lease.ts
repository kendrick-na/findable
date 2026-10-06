import { randomUUID } from "node:crypto";
import { database } from "@repo/database";
import type { AuditCheckpoint } from "./checkpoint";
import { AUDIT_JOB_STALE_AFTER_MS } from "./stale-job";

/** Atomic queued→processing claim; only its token may persist this attempt. */
export async function claimAuditExecution(
  jobId: string,
  now = new Date(),
  token: string = randomUUID()
): Promise<string | null> {
  const claimed = await database.auditJob.updateMany({
    where: { id: jobId, status: "queued" },
    data: {
      status: "processing",
      attemptStartedAt: now,
      leaseToken: token,
      leaseUntil: new Date(now.getTime() + AUDIT_JOB_STALE_AFTER_MS),
    },
  });
  return claimed.count === 1 ? token : null;
}

export async function saveQuestionCheckpoint(
  jobId: string,
  leaseToken: string,
  checkpoint: AuditCheckpoint,
  // 원장 예약 transaction 안에서 같은 연결로 저장할 때만 tx 를 넘긴다.
  client: Pick<typeof database, "auditJob"> = database
): Promise<void> {
  const written = await client.auditJob.updateMany({
    where: { id: jobId, status: "processing", leaseToken },
    data: { checkpoint: checkpoint as never },
  });
  if (written.count !== 1) {
    throw new Error("Audit checkpoint lost its processing job");
  }
}

/**
 * 이어가기 대기 시간창(2026-10-06). 이 안에 화면(폴링) 또는 30분 cron 이 이어가기를 집어 간다.
 * cron 이 30분마다 한 건씩 돌므로 여러 번의 기회를 준다. 지나면 기존 대기열 만료 규칙대로
 * `QUEUE_START_TIMEOUT` 실패로 정리된다(stale-job).
 */
export const AUDIT_CONTINUATION_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * 「이어가기 대기」 판정 — 새 상태값을 만들지 않고 기존 컬럼 조합으로 표시한다.
 *   status = queued **이고** leaseUntil 이 있다 = 이어가기 대기.
 *   새로 만든 Job(create)·관리자 재개(measure-one)는 queued 일 때 leaseUntil 을 항상 비운다.
 *   claim(queued→processing)이 leaseUntil 을 실행 lease 로 덮으므로 표시는 자동으로 사라진다.
 */
export const isAuditContinuationPending = (job: {
  leaseUntil?: Date | null;
  status: string;
}): boolean => job.status === "queued" && Boolean(job.leaseUntil);

/**
 * 마감으로 남은 질문이 있는 실행을 「이어가기 대기」로 돌려놓는다.
 * 지금 lease 를 쥔 실행만 바꿀 수 있다(늦은 writer 가 재개된 Job 을 덮지 못하게).
 * checkpoint 에는 이미 받은 답이 그대로 있다 → 다음 실행은 남은 질문만 묻는다.
 */
export async function requestAuditContinuation(
  jobId: string,
  leaseToken: string,
  checkpoint: AuditCheckpoint,
  now = new Date()
): Promise<boolean> {
  const written = await database.auditJob.updateMany({
    where: { id: jobId, status: "processing", leaseToken },
    data: {
      status: "queued",
      leaseToken: null,
      leaseUntil: new Date(now.getTime() + AUDIT_CONTINUATION_WINDOW_MS),
      attemptStartedAt: now,
      checkpoint: checkpoint as never,
    },
  });
  return written.count === 1;
}
