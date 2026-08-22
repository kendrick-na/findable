import "server-only";

import { currentUser } from "@clerk/nextjs/server";
import { type Plan, planFromPublicMetadata } from "./plan";

/**
 * 로그인 유저의 plan 을 서버에서 읽는다(게이팅의 단일 진실).
 * currentUser() 가 없으면(비로그인) "free".
 *
 * 서버 컴포넌트/라우트에서만 호출(server-only). 클라이언트는 layout 이
 * 내려주는 plan prop 을 받아 배지 표시만.
 */
export async function getCurrentPlan(): Promise<Plan> {
  const user = await currentUser();
  if (!user) {
    return "free";
  }
  return planFromPublicMetadata(
    user.publicMetadata as Record<string, unknown> | null | undefined
  );
}
