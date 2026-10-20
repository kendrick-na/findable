/**
 * Postgres 트랜잭션 범위 advisory lock — raw SQL 단일 진입점 (2026-10-20).
 *
 * 앱에서 raw SQL 을 직접 쓰지 않도록 이 파일을 거친다. 둘 다 **트랜잭션 안에서만** 의미가 있다
 * (`_xact_` 잠금은 트랜잭션이 끝나면 저절로 풀린다 → 함수가 죽어도 잠금이 남지 않는다).
 * 키는 문자열을 `hashtext()` 로 정수화한다(충돌 시 서로 기다릴 뿐, 정합성은 깨지지 않는다).
 */

import type { Prisma } from "./generated/client";

type LockTx = Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;

/** 잠금을 얻을 때까지 기다린다. */
export async function advisoryXactLock(tx: LockTx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** 바로 얻을 수 있으면 true, 다른 트랜잭션이 쥐고 있으면 기다리지 않고 false. */
export async function tryAdvisoryXactLock(
  tx: LockTx,
  key: string
): Promise<boolean> {
  const rows = await tx.$queryRaw<
    { locked: boolean }[]
  >`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked`;
  return rows[0]?.locked === true;
}

/** 같은 Clerk 사용자에 대한 탈퇴·가입·수정·조직 연결을 한 줄로 세우는 키. */
export const clerkUserLockKey = (clerkId: string): string =>
  `clerk-user:${clerkId}`;
