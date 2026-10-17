/**
 * 멈춘(stale) processing 작업의 「이어가기 대기」 전환(U3 · 2026-10-18 · STABILITY_RESUME_STUCK_ENABLED).
 *
 * 🔴 왜: 배포·함수 급사로 측정이 중간에 끊기면 정리 cron 이 `failed`("다시 측정해 주세요")로 닫았고,
 *   고객이 다시 누르면 이미 받은 답도 처음부터 다시 묻는다(원가 2배). 질문 단위 checkpoint 에 받은 답이
 *   있으면 실패 대신 **기존 이어가기 대기(queued + leaseUntil)** 로 돌려 남은 질문만 이어서 묻는다.
 *
 * 새 상태·새 컬럼 없음. 기존 이어가기(`runner` → `requestAuditContinuation`)와 같은 규칙:
 *   · 상한 = `continuationLimitOf(checkpoint)`, 횟수 = checkpoint.continuation.count + 1
 *   · 대기 시간창 = AUDIT_CONTINUATION_WINDOW_MS, leaseToken 비움, attemptStartedAt = now
 *   · 이어가기는 반드시 `claimAuditExecution`(원자적 선점)을 거친다 → 동시 실행 없음
 *
 * 재시작 정책(`retry-policy.ts`)과의 관계: 그 정책은 「**새** 측정이 옛 실패 작업의 유료 호출을 자동 재개하지
 *   않는다」다. 여기는 **같은 작업(같은 jobId)** 을 실패로 닫기 전에 이어가는 것이라 정책 대상이 아니다.
 *   같은 칸 유료 호출은 runner 의 원장(`markPromptAttemptStarted`)이 1회로 막는다.
 *
 * 롤백 호환(N5): 쓰는 필드는 기존 필드뿐(status·leaseUntil·leaseToken·attemptStartedAt·checkpoint.continuation)
 *   이라 옛 코드도 이 행을 「이어가기 대기」로 읽어 이어간다.
 */

import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { AUDIT_CONTINUATION_WINDOW_MS } from "./audit-execution-lease";
import {
  type AuditCheckpoint,
  assertCheckpointProvenance,
  continuationLimitOf,
  readAuditCheckpoint,
} from "./checkpoint";

export type StuckResumeSkipReason =
  | "no_scope"
  | "invalid_checkpoint"
  | "no_progress"
  | "all_done"
  | "limit_reached"
  | "late_reask"
  | "too_old";

export type StuckResumeDecision =
  | {
      checkpoint: AuditCheckpoint;
      completed: number;
      resume: true;
      total: number;
    }
  | { reason: StuckResumeSkipReason; resume: false };

export interface StuckResumeCandidate {
  brandId: string | null;
  checkpoint: unknown;
  createdAt: Date;
  domain: string;
  language: string;
  organizationId: string | null;
}

/**
 * 순수 판정 — 이어가기로 돌릴 수 있는가. 판정 못 하는 모양(깨진 checkpoint 등)은 전부 resume=false(기존 실패 경로).
 * 이어가기는 조직·브랜드가 있는 작업만 한다(`continueAuditJob` 과 같은 조건).
 */
export function decideStuckResume(
  job: StuckResumeCandidate,
  now = Date.now()
): StuckResumeDecision {
  if (
    !(job.organizationId && job.brandId) ||
    (job.language !== "ko" && job.language !== "en" && job.language !== "both")
  ) {
    return { resume: false, reason: "no_scope" };
  }
  let checkpoint: AuditCheckpoint | null;
  try {
    checkpoint = readAuditCheckpoint(job.checkpoint, {
      brandId: job.brandId,
      domain: job.domain,
      language: job.language,
      organizationId: job.organizationId,
    });
    if (checkpoint) {
      assertCheckpointProvenance(checkpoint, job.createdAt, now);
    }
  } catch (error) {
    const tooOld =
      error instanceof Error && error.message.includes("provenance or age");
    return { resume: false, reason: tooOld ? "too_old" : "invalid_checkpoint" };
  }
  if (!checkpoint) {
    return { resume: false, reason: "no_progress" };
  }
  const completed = checkpoint.responses.length;
  const total = checkpoint.prompts.length;
  if (completed < 1) {
    return { resume: false, reason: "no_progress" };
  }
  if (completed >= total) {
    return { resume: false, reason: "all_done" };
  }
  if (checkpoint.lateReask) {
    return { resume: false, reason: "late_reask" };
  }
  const used = checkpoint.continuation?.count ?? 0;
  if (used >= continuationLimitOf(checkpoint)) {
    return { resume: false, reason: "limit_reached" };
  }
  return {
    resume: true,
    completed,
    total,
    checkpoint: {
      ...checkpoint,
      continuation: {
        count: used + 1,
        requestedAt: new Date(now).toISOString(),
      },
    },
  };
}

export type StuckResumeOutcome =
  | { resumed: true }
  | {
      reason: StuckResumeSkipReason | "lost_race" | "not_found";
      resumed: false;
    };

/**
 * stale processing 작업 1건을 이어가기 대기로 전환한다(조건부 updateMany — 원자적·멱등).
 * `staleWhere` 는 호출부가 정한 「stale processing」 조건(`staleAuditJobsWhere("processing")` 또는
 * `reconcileStaleAuditJob` 의 같은 기준)이다. 이미 완료·다른 선점·lease 갱신이면 0건 → lost_race.
 */
export async function resumeStuckAuditJob(options: {
  jobId: string;
  now?: Date;
  staleWhere: Record<string, unknown>;
}): Promise<StuckResumeOutcome> {
  const now = options.now ?? new Date();
  const job = await database.auditJob.findUnique({
    where: { id: options.jobId },
    select: {
      id: true,
      status: true,
      leaseToken: true,
      brandId: true,
      checkpoint: true,
      createdAt: true,
      domain: true,
      language: true,
      organizationId: true,
    },
  });
  if (!job) {
    return { resumed: false, reason: "not_found" };
  }
  if (job.status !== "processing") {
    return { resumed: false, reason: "lost_race" };
  }
  const decision = decideStuckResume(job, now.getTime());
  if (!decision.resume) {
    return { resumed: false, reason: decision.reason };
  }
  const written = await database.auditJob.updateMany({
    where: {
      ...options.staleWhere,
      id: job.id,
      status: "processing",
      leaseToken: job.leaseToken ?? null,
    },
    data: {
      status: "queued",
      leaseToken: null,
      leaseUntil: new Date(now.getTime() + AUDIT_CONTINUATION_WINDOW_MS),
      attemptStartedAt: now,
      checkpoint: decision.checkpoint as never,
    },
  });
  if (written.count !== 1) {
    return { resumed: false, reason: "lost_race" };
  }
  log.info("audit.stuck.resumed", {
    jobId: job.id,
    completedQuestions: decision.completed,
    totalQuestions: decision.total,
    continuation: decision.checkpoint.continuation?.count ?? 0,
  });
  return { resumed: true };
}

/** 정리 cron 용 — stale processing 후보를 훑어 이어가기 대기로 돌린다. 돌린 개수를 돌려준다. */
export async function resumeStuckProcessingJobs(options: {
  now: Date;
  staleWhere: Record<string, unknown>;
  take?: number;
}): Promise<number> {
  const candidates = await database.auditJob.findMany({
    where: options.staleWhere,
    select: { id: true },
    orderBy: { attemptStartedAt: "asc" },
    take: options.take ?? 50,
  });
  let resumed = 0;
  for (const candidate of candidates) {
    const outcome = await resumeStuckAuditJob({
      jobId: candidate.id,
      now: options.now,
      staleWhere: options.staleWhere,
    });
    if (outcome.resumed) {
      resumed += 1;
    }
  }
  return resumed;
}
