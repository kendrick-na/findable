import { randomUUID } from "node:crypto";
import {
  type StabilityLimits,
  stabilityLimits,
} from "@repo/audit/stability-flags";
import { database } from "@repo/database";
import {
  type AdmissionDecision,
  hasRoomFor,
  loadRunningCounts,
  noteAdmissionDbError,
  noteAdmissionDbOk,
  RESERVATION_PREFIX,
  RESERVATION_TTL_MS,
} from "./admission";

/**
 * 슬롯 예약 — 입장 판정과 자리 확보를 **한 번에, 쪼개지지 않게** 한다(2026-10-18, 판정 경합 수정).
 *
 * 문제: 「몇 건 도나 세기 → 시작」 사이에 틈이 있어, 같은 순간 도착한 요청들이 서로를 못 보고 전부 시작해 상한을 넘었다.
 * 해결: 하나의 트랜잭션에서 ① Postgres 어드바이저리 잠금(트랜잭션 단위)으로 모든 서버 인스턴스의 판정을 한 줄로 세우고
 *       ② 점유 수(실행 중 + 유효한 예약)를 세고 ③ 여유가 있으면 **그 job 에 예약 표식을 찍은 뒤** ④ 커밋(잠금 해제).
 *       다음 판정은 이 예약을 센다 → 같은 순간 몰려도 상한을 넘는 일이 없다(정확히 상한까지만 예약된다).
 *
 * 안전 장치
 *  - 새 컬럼·새 표 없음. 예약 표식은 queued job 의 leaseToken(`admit:…`) + attemptStartedAt(시각)이다(admission.ts 주석).
 *  - 러너 선점(claimAuditExecution)은 그대로 — queued→processing 때 leaseToken 이 덮여 예약이 실행 중으로 이어진다.
 *  - 🔒 N6(DB 풀 max 1): 트랜잭션은 그 연결 하나를 잡는다. **트랜잭션 안에서는 반드시 `tx` 만 쓴다**(전역 `database` 를 쓰면
 *    풀이 1개라 자기 자신을 기다리는 교착). 잠금 대기는 수십 ms 이내이고, 네트워크 호출(플랜 조회 등)은 트랜잭션 **밖**에서 끝낸다.
 *  - 어드바이저리 잠금은 트랜잭션이 끝나면 풀려서(`pg_advisory_xact_lock`) 연결 풀러(트랜잭션 모드)에서도 안전하다.
 */

/** 입장 판정 전용 잠금 이름(다른 용도와 겹치지 않게 이 파일에서만 쓴다). 저장소의 다른 잠금(`hashtext(...)`)과 같은 방식. */
export const ADMISSION_LOCK_NAME = "findable:audit-admission";

/** 잠금을 기다리는 최대 시간·트랜잭션 최대 시간. 길어지면 오류로 끝나 호출부가 「시작 보류」 규칙을 탄다. */
const TX_OPTIONS = { maxWait: 5000, timeout: 10_000 } as const;

export type SlotResult = "full" | "gone" | "reserved";

export interface ReserveSlotInput {
  /** 시험용 — 서버 인스턴스마다 따로 연결을 쥐는 상황을 흉내 낸다. 기본은 앱의 `database`. */
  client?: Pick<typeof database, "$transaction">;
  jobId: string;
  limits?: StabilityLimits;
  now?: Date;
  orgId: string;
  plan?: string | null;
}

/**
 * 이 job 에 슬롯을 예약한다. 전역·고객별 상한 미만이면 `reserved`, 가득이면 `full`,
 * job 이 더는 queued 가 아니면(다른 곳이 이미 집었음) `gone`.
 */
export async function reserveSlot(
  input: ReserveSlotInput
): Promise<SlotResult> {
  const now = input.now ?? new Date();
  const limits = input.limits ?? stabilityLimits();
  const client = input.client ?? database;
  return await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMISSION_LOCK_NAME}))`;
    const counts = await loadRunningCounts(now, tx);
    if (!hasRoomFor(counts, input.orgId, input.plan, limits)) {
      return "full" as const;
    }
    const stamped = await tx.auditJob.updateMany({
      where: { id: input.jobId, status: "queued" },
      data: {
        attemptStartedAt: now,
        leaseToken: `${RESERVATION_PREFIX}${randomUUID()}`,
      },
    });
    return stamped.count === 1 ? ("reserved" as const) : ("gone" as const);
  }, TX_OPTIONS);
}

/**
 * start-tracking 용 결정: `start`(예약 성공 → 지금 실행) / `wait`(상한 → 대기 줄) / `hold`(DB 오류 연속 → 대기 줄).
 * DB 오류 한두 번은 예전처럼 즉시 시작한다(고객을 막지 않는다).
 */
export async function admitJob(
  input: ReserveSlotInput
): Promise<AdmissionDecision> {
  try {
    const slot = await reserveSlot(input);
    noteAdmissionDbOk();
    return slot === "reserved" ? "start" : "wait";
  } catch {
    return noteAdmissionDbError();
  }
}

/**
 * 시작하지 못한 예약(요청이 죽는 등)을 대기로 되돌린다 — TTL 이 지난 예약 표식을 지운다.
 * (표식이 남은 채로는 대기 줄 조회에서 빠져 영영 시작되지 않는다.) 일꾼 1회마다 맨 앞에서 부른다.
 */
export async function releaseStaleReservations(
  now = new Date()
): Promise<number> {
  const released = await database.auditJob.updateMany({
    where: {
      status: "queued",
      leaseToken: { startsWith: RESERVATION_PREFIX },
      attemptStartedAt: { lt: new Date(now.getTime() - RESERVATION_TTL_MS) },
    },
    data: { leaseToken: null },
  });
  return released.count;
}
