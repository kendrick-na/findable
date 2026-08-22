import "server-only";

import { currentUser } from "@clerk/nextjs/server";
import { hasAdminRole } from "./admin-role";

/**
 * 플랫폼 운영자(admin) 판정 — 서버 전용.
 *
 * 진실 = Clerk `user.publicMetadata.role === "admin"`.
 * 운영자 소수 userId 에 Clerk 대시보드에서 수동 부여(1회).
 *
 * ⚠️ 이 admin 은 "플랫폼 운영자" 권한이다. 고객 조직(org) 의 멤버 role 과 별개 축.
 *    org membership role 과 섞지 말 것.
 * ⚠️ admin 전용 라우트/서버액션은 반드시 이 함수로 서버에서 재확인.
 *    클라이언트 클레임만 믿으면 우회 가능.
 */
export async function isAdmin(): Promise<boolean> {
  const user = await currentUser();
  if (!user) {
    return false;
  }
  return hasAdminRole(user.publicMetadata as Record<string, unknown> | null);
}

/**
 * admin 이 아니면 throw. admin 서버액션 첫 줄 게이트용.
 * 반환값 = admin 의 Clerk userId (decidedBy 기록에 사용).
 */
export async function requireAdmin(): Promise<string> {
  const user = await currentUser();
  if (!user) {
    throw new Error("FORBIDDEN: admin only");
  }
  if (!hasAdminRole(user.publicMetadata as Record<string, unknown> | null)) {
    throw new Error("FORBIDDEN: admin only");
  }
  return user.id;
}
