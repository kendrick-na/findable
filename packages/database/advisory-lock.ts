/**
 * Postgres 트랜잭션 범위 advisory lock — raw SQL 단일 진입점 (2026-10-20, 코덱스 3차 반영).
 *
 * 앱에서 raw SQL 을 직접 쓰지 않도록 이 파일을 거친다. 둘 다 **트랜잭션 안에서만** 의미가 있다
 * (`_xact_` 잠금은 트랜잭션이 끝나면 저절로 풀린다 → 함수가 죽어도·PgBouncer 트랜잭션 모드여도 안전).
 *
 * 키 = **두 개의 int4**: `(네임스페이스, hashtext(id))`.
 *  - 네임스페이스로 잠금 종류(사용자·IP cron …)를 갈라 서로 다른 종류끼리는 절대 겹치지 않는다.
 *  - 두 인자 형식은 한 인자(bigint) 형식과 **별도 키 공간**이라, 기존 `hashtext()` 한 인자 잠금
 *    (예: 측정 대기열 슬롯)과도 겹치지 않는다.
 *  - 같은 네임스페이스 안의 hashtext 충돌은 「서로 잠깐 기다림」일 뿐 정합성은 깨지지 않는다.
 * ⚠️ 새 잠금 종류는 아래 상수에 **새 번호**를 더하고, 키는 반드시 이 파일의 함수로만 만든다.
 */

import type { Prisma } from "./generated/client";

/** 잠금 종류별 고정 번호(int4). 한 번 정한 번호는 바꾸지 않는다. */
export const ADVISORY_LOCK_NAMESPACE = {
  /** 같은 Clerk 사용자의 탈퇴·가입·수정·조직 연결·소유권 이전. */
  CLERK_USER: 20_261_001,
  /** 접속 IP 3개월 정리 cron 의 동시 실행 방지. */
  IP_PURGE_CRON: 20_261_002,
} as const;

export interface AdvisoryLockKey {
  readonly id: string;
  readonly namespace: number;
}

/** 같은 Clerk 사용자에 대한 모든 쓰기를 한 줄로 세우는 키. */
export const clerkUserLock = (clerkId: string): AdvisoryLockKey => ({
  namespace: ADVISORY_LOCK_NAMESPACE.CLERK_USER,
  id: clerkId,
});

/** IP 정리 cron 의 단일 실행 키. */
export const ipPurgeCronLock = (): AdvisoryLockKey => ({
  namespace: ADVISORY_LOCK_NAMESPACE.IP_PURGE_CRON,
  id: "purge-expired-ip",
});

type LockTx = Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;

/** 잠금을 얻을 때까지 기다린다. */
export async function advisoryXactLock(
  tx: LockTx,
  key: AdvisoryLockKey
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key.namespace}::int4, hashtext(${key.id}))`;
}

/** 바로 얻을 수 있으면 true, 다른 트랜잭션이 쥐고 있으면 기다리지 않고 false. */
export async function tryAdvisoryXactLock(
  tx: LockTx,
  key: AdvisoryLockKey
): Promise<boolean> {
  const rows = await tx.$queryRaw<
    { locked: boolean }[]
  >`SELECT pg_try_advisory_xact_lock(${key.namespace}::int4, hashtext(${key.id})) AS locked`;
  return rows[0]?.locked === true;
}
