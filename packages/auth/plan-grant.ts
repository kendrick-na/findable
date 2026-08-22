import "server-only";

import { clerkClient } from "@clerk/nextjs/server";
import type { Plan } from "./plan";

/**
 * plan 부여(grant) — 서버 전용 공용 헬퍼.
 *
 * Clerk `user.publicMetadata.plan` 을 지정 plan 으로 멱등 push 한다(게이팅 캐시).
 * 파트너 승인(actions/partner/decide.ts)·결제 성공(payments verify·webhook) 등
 * "plan 을 코드로 올리는" 모든 경로가 이 함수 하나를 재사용한다(로직 중복 방지).
 *
 * ⚠️ plan 의 최종 진실은 상황마다 다르다:
 *   - 파트너: DB PartnerApplication.status=approved
 *   - 결제: PortOne 결제 PAID + 서버 금액 검증
 *   이 함수는 그 진실이 확정된 뒤 "Clerk 캐시에 반영"만 담당한다(권위 write 아님).
 *
 * push 실패를 삼키지 않고 boolean 으로 반환 → 호출부가 재시도/경고를 판단.
 * (멱등이라 같은 값 재기록도 안전. 다음 로그인/재동기화로 교정 가능.)
 */

const MAX_PUSH_RETRIES = 3;

export async function grantPlan(userId: string, plan: Plan): Promise<boolean> {
  const clerk = await clerkClient();
  for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
    try {
      await clerk.users.updateUserMetadata(userId, {
        publicMetadata: { plan },
      });
      return true;
    } catch {
      if (attempt === MAX_PUSH_RETRIES) {
        return false;
      }
    }
  }
  return false;
}
