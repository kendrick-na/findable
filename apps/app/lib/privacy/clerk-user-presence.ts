/**
 * Clerk 에 이 사용자가 **지금도 있는가** — 늦게 도착한 가입·수정 웹훅이 탈퇴자를 되살리지 않게 (2026-10-20).
 *
 * Clerk 웹훅은 순서를 보장하지 않는다. 탈퇴(`user.deleted`)를 처리한 뒤에 그보다 먼저 생긴
 * `user.updated` 가 재전송되면, 예전 코드는 `upsert` 로 회원 행과 이메일·이름을 **다시 만들었다.**
 * 스키마 변경(삭제 표식 표) 없이 막기 위해, 적재 직전에 Clerk 서버 API 로 실제 존재를 확인한다.
 *
 * - 있음 → `"exists"`, Clerk 가 404 → `"gone"`(적재하지 않는다).
 * - 그 밖의 실패(네트워크·5xx·429)는 **던진다** → 웹훅이 500 을 돌려 Clerk 가 나중에 다시 보낸다.
 */

import { clerkClient } from "@repo/auth/server";

export type ClerkUserPresence = "exists" | "gone";

type GetUser = (userId: string) => Promise<unknown>;

const defaultGetUser: GetUser = async (userId) => {
  const clerk = await clerkClient();
  return await clerk.users.getUser(userId);
};

/** Clerk API 오류 객체의 HTTP 상태(ClerkAPIResponseError.status). 모양만 본다. */
const statusOf = (error: unknown): number | undefined => {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
};

export async function clerkUserPresence(
  userId: string,
  getUser: GetUser = defaultGetUser
): Promise<ClerkUserPresence> {
  try {
    await getUser(userId);
    return "exists";
  } catch (error) {
    if (statusOf(error) === 404) {
      return "gone";
    }
    throw error;
  }
}
