import {
  type StabilityLimits,
  stabilityLimits,
} from "@repo/audit/stability-flags";
import { AUDIT_JOB_STALE_AFTER_MS } from "@repo/audit/stale-job";
import { database } from "@repo/database";

/**
 * 입장 관리(STABILITY_ADMISSION_ENABLED) — 지금 실제로 돌고 있는 측정이 몇 건인지 DB로 센다.
 *
 * 「돌고 있다」 = status processing 이고 lease 가 유효. 고객·내부 조직·무료 진단을 **전부** 센다(N3):
 *   외부 AI 호출 한도·함수 동시성은 누가 시작했든 같이 쓰기 때문이다.
 *   lease 가 없는 옛 행은 stale 규칙(6분)과 같은 기준으로 살아 있는지 본다.
 */

/** 시작 보류(S16): DB 조회가 이 횟수 연속 실패하면 시작을 보류(대기 줄로)한다. */
export const ADMISSION_DB_ERROR_HOLD_AFTER = 3;

export interface RunningCounts {
  /** `org:<orgId>` 같은 AuditJob.email 별 실행 중 수. */
  byEmail: Map<string, number>;
  /** 전체(무료·내부 포함) 실행 중 수. */
  global: number;
}

/**
 * 실행 중 개수를 **쿼리 1회**(groupBy)로 읽는다.
 * 🔒 N6: DB 연결 풀이 1개(max 1)라 쿼리를 병렬로 쏘면 연결 대기 오류가 난다 → 한 번에 읽고,
 *   호출부도 다른 쿼리와 직렬(await 순서대로)로만 쓴다.
 */
export async function loadRunningCounts(
  now = new Date()
): Promise<RunningCounts> {
  const legacyBefore = new Date(now.getTime() - AUDIT_JOB_STALE_AFTER_MS);
  const rows = await database.auditJob.groupBy({
    by: ["email"],
    where: {
      status: "processing",
      OR: [
        { leaseUntil: { gt: now } },
        { leaseUntil: null, attemptStartedAt: { gt: legacyBefore } },
      ],
    },
    _count: { _all: true },
  });
  const byEmail = new Map<string, number>();
  let global = 0;
  for (const row of rows) {
    byEmail.set(row.email, row._count._all);
    global += row._count._all;
  }
  return { byEmail, global };
}

/** 고객별 동시 상한 — 플랜별(스타터 1·그로스 2·스케일 2). 플랜을 모르면 플랜 구분 없는 값(orgConcurrency). */
export function orgConcurrencyFor(
  plan: string | null | undefined,
  limits: StabilityLimits = stabilityLimits()
): number {
  if (plan === "starter" || plan === "growth" || plan === "scale") {
    return limits.orgConcurrencyByPlan[plan];
  }
  return limits.orgConcurrency;
}

/** 이 org 가 지금 새 측정을 바로 시작해도 되는가(전역·고객별 상한 미만). */
export function hasRoomFor(
  counts: RunningCounts,
  orgId: string,
  plan?: string | null,
  limits: StabilityLimits = stabilityLimits()
): boolean {
  return (
    counts.global < limits.globalConcurrency &&
    (counts.byEmail.get(`org:${orgId}`) ?? 0) < orgConcurrencyFor(plan, limits)
  );
}

export type AdmissionDecision = "start" | "wait" | "hold";

let consecutiveDbErrors = 0;

/** 테스트용 — 연속 오류 기록을 비운다. */
export function resetAdmissionErrorStreak(): void {
  consecutiveDbErrors = 0;
}

/**
 * start-tracking 용 결정. start=즉시 실행, wait=상한 도달(대기 줄), hold=DB 오류 연속(대기 줄로 보류).
 * 조회가 한두 번 실패했을 때는 예전처럼 즉시 시작한다(고객을 막지 않는다).
 */
export async function decideAdmission(
  orgId: string,
  plan?: string
): Promise<AdmissionDecision> {
  try {
    const counts = await loadRunningCounts();
    consecutiveDbErrors = 0;
    return hasRoomFor(counts, orgId, plan) ? "start" : "wait";
  } catch {
    consecutiveDbErrors += 1;
    return consecutiveDbErrors >= ADMISSION_DB_ERROR_HOLD_AFTER
      ? "hold"
      : "start";
  }
}
