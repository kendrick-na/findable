import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { database } from "@repo/database";
import { cache } from "react";
import {
  type Plan,
  planFromPublicMetadata,
  resolveEffectivePlan,
} from "./plan";

/**
 * 현재 조직의 기간제 권한과 사용자별 결제·파트너 권한을 함께 판정한다.
 * currentUser() 가 없으면(비로그인) "free".
 *
 * 서버 컴포넌트/라우트에서만 호출(server-only). 클라이언트는 layout 이
 * 내려주는 plan prop 을 받아 배지 표시만.
 */
export const getCurrentPlan = cache(async (): Promise<Plan> => {
  const [user, { orgId }] = await Promise.all([currentUser(), auth()]);
  if (!user) {
    return "free";
  }
  const clerkPlan = planFromPublicMetadata(
    user.publicMetadata as Record<string, unknown> | null | undefined
  );
  if (!orgId) {
    return clerkPlan;
  }

  const [organization, redemption, partner] = await Promise.all([
    database.organization.findUnique({
      where: { id: orgId },
      select: { plan: true, planExpiresAt: true },
    }),
    clerkPlan === "free"
      ? Promise.resolve(null)
      : database.inviteRedemption.findFirst({
          where: { userId: user.id },
          select: { id: true },
        }),
    database.partnerApplication.findUnique({
      where: { userId: user.id },
      select: { status: true },
    }),
  ]);
  if (!organization) {
    return clerkPlan;
  }

  const privateMetadata = user.privateMetadata as Record<
    string,
    unknown
  > | null;
  const hasCurrentPaymentGrant =
    typeof privateMetadata?.findablePaymentId === "string";
  return resolveEffectivePlan({
    clerkPlan,
    organizationPlan: organization.plan,
    organizationPlanExpiresAt: organization.planExpiresAt,
    hasInviteRedemption: Boolean(redemption),
    hasCurrentPaymentGrant,
    isApprovedPartner: partner?.status === "approved",
  });
});
