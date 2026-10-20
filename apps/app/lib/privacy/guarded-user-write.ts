/**
 * 탈퇴 표식(tombstone)을 지키는 회원 쓰기 — 2026-10-20 (코덱스 2차 검토 반영).
 *
 * 탈퇴 처리(`eraseDeletedUser`)와 **같은 잠금**(`clerkUserLockKey`)을 잡은 뒤 표식을 확인하고 쓴다.
 * 그래서 「확인 → 쓰기」 사이에 탈퇴가 끼어들 수 없다(둘 중 하나가 끝날 때까지 다른 쪽이 기다린다).
 *
 * - 표식 있음 → 쓰지 않고 `"tombstoned"`.
 * - 잠금·표식 조회가 실패(표 없음 = 마이그레이션 미적용 포함) → `GuardLookupError` → 웹훅 500(fail-closed).
 * - 실제 쓰기(upsert/update)의 실패는 그대로 던진다 — 호출부가 기존 방침(로그 후 계속)대로 처리.
 */

import type { database } from "@repo/database";
import {
  advisoryXactLock,
  clerkUserLockKey,
} from "@repo/database/advisory-lock";

export class GuardLookupError extends Error {
  constructor(cause: unknown) {
    super(
      `tombstone lookup failed: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    this.name = "GuardLookupError";
  }
}

type GuardClient = Pick<typeof database, "$transaction">;
type Tx = Parameters<Parameters<GuardClient["$transaction"]>[0]>[0];

const TX_OPTIONS = { maxWait: 5000, timeout: 10_000 } as const;

/**
 * 잠금 + 표식 확인 후 `write` 를 같은 트랜잭션에서 실행한다.
 * @returns 표식이 있으면 `"tombstoned"`(write 미실행), 아니면 `"written"`.
 */
export async function writeUnlessDeleted(
  client: GuardClient,
  clerkId: string,
  write: (tx: Tx) => Promise<unknown>
): Promise<"tombstoned" | "written"> {
  return await client.$transaction(async (tx) => {
    let tombstoned: boolean;
    try {
      await advisoryXactLock(tx, clerkUserLockKey(clerkId));
      tombstoned =
        (await tx.deletedClerkUser.findUnique({
          where: { clerkId },
          select: { clerkId: true },
        })) !== null;
    } catch (error) {
      throw new GuardLookupError(error);
    }
    if (tombstoned) {
      return "tombstoned" as const;
    }
    await write(tx);
    return "written" as const;
  }, TX_OPTIONS);
}
