/**
 * 자동 재측정 대상 조직 — 화면 게이트와 **같은 유료 판정**으로 고른다(2026-10-05).
 *
 * 왜: 결제 권한은 Clerk `publicMetadata.plan` + 비공개 결제 출처에만 쓰이고
 *   `Organization.plan` 에는 쓰이지 않는다(초대·관리자 기간 부여만 DB 에 쓴다).
 *   예전 cron 은 DB plan 만 봐서 **결제한 고객이 자동 측정에서 빠졌다**.
 *
 * 판정: 조직 구성원(소유자 + DB User) 각각을 `resolveOrganizationPlan`(= 화면의
 *   resolveEffectivePlan)으로 판정하고 가장 높은 값을 쓴다.
 *   - past_due(7일 유예): 결제 출처가 살아 있으므로 유료 그대로.
 *   - expired: `expireLapsedRenewalGrants` 가 같은 cron 실행 **앞단계**에서 출처를 지운다 → free.
 *
 * 원가 보호: Clerk 조회가 실패하면 DB 권한만으로 판정한다(예전 동작). 대상을 늘리는 쪽으로
 *   열지 않는다. 측정 상한(MAX_TRIGGERS_PER_RUN)은 호출부가 그대로 지킨다.
 */

import {
  type MemberPlanSignal,
  type Plan,
  planCapabilities,
  resolveOrganizationPlan,
} from "@repo/auth/plan";
import { database } from "@repo/database";
import { loadClerkPlanSignals, memberPlanSignal } from "./clerk-plan-signals";

export interface AutoRefreshOrganization {
  brands: Array<{
    domain: string;
    entityVariants: unknown;
    id: string;
    name: string;
  }>;
  id: string;
  plan: Plan;
}

/** 자동 재측정이 허용된(autoRefreshHours != null) 조직과 그 실효 플랜. */
export async function loadAutoRefreshOrganizations(
  now = new Date()
): Promise<AutoRefreshOrganization[]> {
  // 브랜드가 없는 조직은 측정할 것이 없으므로 처음부터 뺀다.
  const orgs = await database.organization.findMany({
    where: { brands: { some: {} } },
    select: {
      id: true,
      ownerId: true,
      plan: true,
      planExpiresAt: true,
      users: { select: { id: true } },
      brands: {
        select: { domain: true, entityVariants: true, id: true, name: true },
      },
    },
  });
  if (orgs.length === 0) {
    return [];
  }

  const membersByOrg = new Map(
    orgs.map((org) => [
      org.id,
      [...new Set([org.ownerId, ...org.users.map((u) => u.id)])],
    ])
  );
  const userIds = [...new Set([...membersByOrg.values()].flat())];

  const [clerkSignals, invites, partners] = await Promise.all([
    // 실패 시 null → DB 권한만으로 판정(대상을 늘리는 쪽으로 열지 않는다).
    loadClerkPlanSignals(userIds, "cron.auto-refresh.clerk_plan_lookup_failed"),
    database.inviteRedemption.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true },
    }),
    database.partnerApplication.findMany({
      where: { userId: { in: userIds }, status: "approved" },
      select: { userId: true },
    }),
  ]);
  const invited = new Set(invites.map((row) => row.userId));
  const approvedPartners = new Set(partners.map((row) => row.userId));

  const eligible: AutoRefreshOrganization[] = [];
  for (const org of orgs) {
    // Clerk 실패 시 사용자별 결제 권한은 모른다 → free 로 둔다(DB 권한만 남음).
    const members: MemberPlanSignal[] = (membersByOrg.get(org.id) ?? []).map(
      (userId) =>
        memberPlanSignal(userId, clerkSignals, invited, approvedPartners)
    );
    const plan = resolveOrganizationPlan({
      organizationPlan: org.plan,
      organizationPlanExpiresAt: org.planExpiresAt,
      members,
      now,
    });
    if (planCapabilities(plan).autoRefreshHours !== null) {
      eligible.push({ id: org.id, plan, brands: org.brands });
    }
  }
  return eligible;
}
