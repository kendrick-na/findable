import { continueAuditJob } from "@repo/audit/audit-continuation";
import { loadSetupReadinessRecord } from "@repo/audit/brand-setup";
import { runAuditJob } from "@repo/audit/runner";
import { stabilityLimits } from "@repo/audit/stability-flags";
import { AUDIT_JOB_QUEUE_STALE_ERROR } from "@repo/audit/stale-job";
import { database } from "@repo/database";
import { isInternalOrgId } from "@repo/database/internal-orgs";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { getAppDictionary } from "@/lib/i18n";
import { hasRoomFor, loadRunningCounts, type RunningCounts } from "./admission";
import { buildOrgRunInput } from "./run-input";

/**
 * 대기 줄 일꾼 1회분(cron 1회 = 함수 1개 = 최대 300초 → **작업 1건**).
 *
 * 상태 전이(새 상태값·컬럼 없음 — 기존 AuditJob 필드만):
 *   대기 = queued + leaseUntil 없음 + org 측정.  (이어가기 대기 = queued + leaseUntil, 기존 규칙 그대로)
 *   대기 ──(상한 여유 · 가장 오래 기다린 고객 순)──▶ runAuditJob 이 claim(queued→processing) ──▶ 완료/이어가기 대기/실패
 *   대기 ──(queueWaitMaxMinutes 초과)──▶ failed(기존 QUEUE_START_TIMEOUT 문구)
 *   대기 중에는 매 호출마다 attemptStartedAt 을 갱신(heartbeat)해, 30분 stale 규칙이 정리하지 않게 한다.
 *     일꾼이 죽으면 갱신이 멈추고 → 기존 규칙대로 30분 뒤 정리된다(의도).
 *
 * 🔒 N6: DB 연결 풀이 1개라 아래 쿼리는 **일부러 직렬**이다(병렬 금지 — 연결 대기 오류).
 */

/** 한 번에 후보로 읽을 대기 건 상한(가장 오래된 순). */
const CANDIDATE_LIMIT = 200;

const waitingWhere = {
  status: "queued" as const,
  leaseUntil: null,
  organizationId: { not: null },
  brandId: { not: null },
};

export type AuditQueueTickResult =
  | { reason: "no_room" | "nothing_waiting"; picked: null; expired: number }
  | {
      expired: number;
      jobId: string;
      kind: "new" | "continuation";
      picked: true;
    };

interface Candidate {
  createdAt: Date;
  id: string;
  organizationId: string | null;
}

/** 고객 먼저, 내부 조직은 뒤. 같은 그룹 안에서는 오래 기다린 순(원래 정렬 유지). */
const customerFirst = <T extends { organizationId: string | null }>(
  rows: T[]
): T[] => [
  ...rows.filter((row) => !isInternalOrgId(row.organizationId)),
  ...rows.filter((row) => isInternalOrgId(row.organizationId)),
];

/**
 * 대기 고객들의 플랜(Organization.plan, 쿼리 1회). 결제 권한의 원천은 Clerk 라 이 값이 낡았을 수 있다 —
 * 모르거나 free 면 플랜 구분 없는 상한(orgConcurrency, 가장 큰 값)을 써서 **고객을 더 막지 않는 쪽**으로 기운다.
 */
async function loadPlans(rows: Candidate[]): Promise<Map<string, string>> {
  const ids = [
    ...new Set(rows.map((row) => row.organizationId).filter(Boolean)),
  ] as string[];
  if (ids.length === 0) {
    return new Map();
  }
  const orgs = await database.organization.findMany({
    where: { id: { in: ids } },
    select: { id: true, plan: true },
  });
  return new Map(orgs.map((org) => [org.id, org.plan as string]));
}

function pickEligible<T extends Candidate>(
  rows: T[],
  counts: RunningCounts,
  limits: ReturnType<typeof stabilityLimits>,
  plans: Map<string, string>
): T | undefined {
  // 전역 상한이 가득하면 아무도 못 고른다. 고객별 상한이 찬 고객은 건너뛰어 다른 고객에게 순서가 간다.
  return customerFirst(rows).find(
    (row) =>
      row.organizationId &&
      hasRoomFor(
        counts,
        row.organizationId,
        plans.get(row.organizationId),
        limits
      )
  );
}

export async function runAuditQueueTick(
  invocationStartedAtMs: number,
  now = new Date()
): Promise<AuditQueueTickResult> {
  const limits = stabilityLimits();

  // 1) 너무 오래 기다린 대기는 실패로 닫는다(기존 오류 문구 재사용).
  const expired = await database.auditJob.updateMany({
    where: {
      ...waitingWhere,
      createdAt: {
        lt: new Date(now.getTime() - limits.queueWaitMaxMinutes * 60_000),
      },
    },
    data: {
      status: "failed",
      errorMessage: AUDIT_JOB_QUEUE_STALE_ERROR,
      completedAt: now,
      leaseToken: null,
      leaseUntil: null,
    },
  });

  // 2) 남은 대기에 heartbeat — 30분 stale 정리(stale-job.ts)가 대기 건을 실패시키지 않게 한다.
  await database.auditJob.updateMany({
    where: waitingWhere,
    data: { attemptStartedAt: now },
  });

  // 3) 지금 실행 중 개수(쿼리 1회).
  const counts = await loadRunningCounts(now);

  // 4) ①대기 중 새 측정 — 상한 여유가 있는 고객 중 가장 오래 기다린 것.
  if (counts.global < limits.globalConcurrency) {
    const waiting = await database.auditJob.findMany({
      where: waitingWhere,
      orderBy: { createdAt: "asc" },
      take: CANDIDATE_LIMIT,
      select: {
        id: true,
        createdAt: true,
        organizationId: true,
        brandId: true,
        domain: true,
        language: true,
      },
    });
    const job = pickEligible(waiting, counts, limits, await loadPlans(waiting));
    if (job?.organizationId && job.brandId) {
      await runWaitingJob(
        {
          id: job.id,
          organizationId: job.organizationId,
          brandId: job.brandId,
          domain: job.domain,
          language: job.language,
        },
        invocationStartedAtMs
      );
      return {
        expired: expired.count,
        jobId: job.id,
        kind: "new",
        picked: true,
      };
    }
  }

  // 5) ②이어가기 대기 — 가장 오래 기다린 것부터. 새 유료 질문이 나가는 「이어서 묻기」는 상한을 지키고,
  //    시간창이 지난 것(저장된 답으로 잠정 마감 — 새 질문 없음)은 상한과 무관하게 처리한다.
  const pending = await database.auditJob.findMany({
    where: {
      status: "queued",
      leaseUntil: { not: null },
      organizationId: { not: null },
      brandId: { not: null },
    },
    orderBy: { attemptStartedAt: "asc" },
    take: CANDIDATE_LIMIT,
    select: {
      id: true,
      createdAt: true,
      organizationId: true,
      leaseUntil: true,
    },
  });
  const finalizing = pending.find(
    (row) => row.leaseUntil && row.leaseUntil.getTime() < now.getTime()
  );
  const continuing =
    counts.global < limits.globalConcurrency
      ? pickEligible(pending, counts, limits, await loadPlans(pending))
      : undefined;
  const next = finalizing ?? continuing;
  if (next) {
    try {
      await continueAuditJob(next.id, { invocationStartedAtMs });
    } catch (error) {
      log.error("audit.queue.continuation_uncaught", {
        jobId: next.id,
        error: parseError(error),
      });
    }
    return {
      expired: expired.count,
      jobId: next.id,
      kind: "continuation",
      picked: true,
    };
  }

  return {
    expired: expired.count,
    picked: null,
    reason:
      counts.global < limits.globalConcurrency ? "nothing_waiting" : "no_room",
  };
}

/**
 * 대기 중이던 새 측정을 시작한다. start-tracking 과 **같은 `buildOrgRunInput`** 으로 입력을 만든다.
 * 같은 건을 두 일꾼이 동시에 집어도 러너 안의 claimAuditExecution(원자적 queued→processing)이
 * 한쪽만 통과시킨다(진 쪽은 claim_skipped 로 즉시 끝).
 */
async function runWaitingJob(
  job: {
    brandId: string;
    domain: string;
    id: string;
    language: "ko" | "en" | "both";
    organizationId: string;
  },
  invocationStartedAtMs: number
): Promise<void> {
  try {
    const brand = await database.brand.findUnique({
      where: { id: job.brandId },
      select: {
        name: true,
        entityVariants: true,
        industry: true,
        marketScope: true,
      },
    });
    if (!(brand?.industry && brand.marketScope)) {
      // 대기 중에 브랜드가 지워졌거나 기준이 비었다 — 시작하지 않고 닫는다(start 와 같은 불변식).
      await database.auditJob.updateMany({
        where: { id: job.id, ...waitingWhere },
        data: {
          status: "failed",
          errorMessage: (await getAppDictionary()).brandErrors
            .measureStartFailed,
          completedAt: new Date(),
        },
      });
      return;
    }
    // 시작 화면에서 고른 skippedSetup 은 대기 중 보관되지 않는다(기록 전용 값) → false 로 읽는다.
    const setupReadiness = await loadSetupReadinessRecord(job.brandId);
    await runAuditJob(
      buildOrgRunInput({
        invocationStartedAtMs,
        jobId: job.id,
        domain: job.domain,
        language: job.language,
        brandName: brand.name,
        brand,
        organizationId: job.organizationId,
        brandId: job.brandId,
        setupReadiness,
      })
    );
  } catch (error) {
    log.error("audit.queue.job_uncaught", {
      jobId: job.id,
      error: parseError(error),
    });
  }
}
