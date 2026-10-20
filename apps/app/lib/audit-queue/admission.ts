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

/**
 * 슬롯 예약 표식(2026-10-18, 입장 판정 경합 수정).
 *
 * 판정(몇 건 돌고 있나)과 러너의 선점(claim) 사이에는 틈이 있다 — 같은 순간 도착한 요청들이 모두 「0건」을 읽고 전부 시작해
 * 상한을 넘겼다. 그래서 판정을 통과한 job 에 **예약 표식**을 DB 잠금 안에서 찍어, 다음 판정이 그것을 센다.
 *   표식 = queued job 의 `leaseToken` 이 `admit:` 로 시작 + `attemptStartedAt` 이 TTL 이내.
 *   러너가 선점하면(queued→processing) `leaseToken` 이 러너 토큰으로 덮여 표식은 자연히 사라지고 processing 으로 계속 센다
 *   (예약 → 실행 중으로 이어져 **세는 틈이 없다**). 시작하지 못한 예약은 TTL 이 지나면 세지 않는다(슬롯 반환).
 * queued job 의 leaseToken 은 다른 곳에서 읽지 않는다(선점이 덮어씀·정리 cron 이 실패 처리 때 비움) — 새 컬럼 없이 쓴다.
 */
export const RESERVATION_PREFIX = "admit:";
/** 예약이 유효한 시간. 러너 선점은 보통 수 초 안이라 넉넉히 90초. 넘으면 슬롯을 돌려주고 일꾼이 다시 대기로 되돌린다. */
export const RESERVATION_TTL_MS = 90_000;

/** 예약(아직 러너가 선점하지 않음)이 아닌 queued 인지 — 대기 줄 조회에서 예약 건을 빼는 조건. */
export const notReservedWhere = {
  OR: [
    { leaseToken: null },
    { NOT: { leaseToken: { startsWith: RESERVATION_PREFIX } } },
  ],
};

export interface RunningCounts {
  /** `org:<orgId>` 같은 AuditJob.email 별 실행 중 수. */
  byEmail: Map<string, number>;
  /** 전체(무료·내부 포함) 실행 중 수. */
  global: number;
}

/**
 * 점유 중인 슬롯 수를 **쿼리 1회**(groupBy)로 읽는다 — 실행 중(processing + 유효 lease) + 유효한 예약.
 * 🔒 N6: DB 연결 풀이 1개(max 1)라 쿼리를 병렬로 쏘면 연결 대기 오류가 난다 → 한 번에 읽고,
 *   호출부도 다른 쿼리와 직렬(await 순서대로)로만 쓴다.
 * `client` 를 넘기면(트랜잭션 안) 그 연결로 읽는다 — 트랜잭션 안에서 전역 `database` 를 쓰면 풀이 1개라 서로 기다린다.
 */
export async function loadRunningCounts(
  now = new Date(),
  client: Pick<typeof database, "auditJob"> = database
): Promise<RunningCounts> {
  const legacyBefore = new Date(now.getTime() - AUDIT_JOB_STALE_AFTER_MS);
  const reservedAfter = new Date(now.getTime() - RESERVATION_TTL_MS);
  const rows = await client.auditJob.groupBy({
    by: ["email"],
    where: {
      OR: [
        {
          status: "processing",
          OR: [
            { leaseUntil: { gt: now } },
            { leaseUntil: null, attemptStartedAt: { gt: legacyBefore } },
          ],
        },
        {
          status: "queued",
          leaseToken: { startsWith: RESERVATION_PREFIX },
          attemptStartedAt: { gt: reservedAfter },
        },
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

/** 입장 판정 DB 호출이 성공했다 — 연속 오류 기록을 비운다. */
export function noteAdmissionDbOk(): void {
  consecutiveDbErrors = 0;
}

/**
 * 입장 판정 DB 호출이 실패했다. 한두 번은 예전처럼 즉시 시작(고객을 막지 않는다), 연속 `ADMISSION_DB_ERROR_HOLD_AFTER`번이면
 * 보류(대기 줄)로 돌려보낸다(S16). start=즉시 실행, hold=DB 오류 연속.
 */
export function noteAdmissionDbError(): "hold" | "start" {
  consecutiveDbErrors += 1;
  return consecutiveDbErrors >= ADMISSION_DB_ERROR_HOLD_AFTER
    ? "hold"
    : "start";
}
