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
  hasCurrentPaymentGrant,
  type MemberPlanSignal,
  type Plan,
  planCapabilities,
  planFromPublicMetadata,
  resolveOrganizationPlan,
} from "@repo/auth/plan";
import { clerkClient } from "@repo/auth/server";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";

/** Clerk getUserList 한 번에 묻는 사용자 수(Clerk 목록 API 의 limit 상한 이하). */
const CLERK_USER_PAGE = 100;

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

type ClerkPlanSignal = Pick<
  MemberPlanSignal,
  "clerkPlan" | "hasCurrentPaymentGrant"
>;

/** 사용자별 Clerk 권한. 실패하면 null(호출부가 DB 만으로 판정). */
async function loadClerkSignals(
  userIds: readonly string[]
): Promise<Map<string, ClerkPlanSignal> | null> {
  const signals = new Map<string, ClerkPlanSignal>();
  if (userIds.length === 0) {
    return signals;
  }
  try {
    const clerk = await clerkClient();
    for (let i = 0; i < userIds.length; i += CLERK_USER_PAGE) {
      const chunk = userIds.slice(i, i + CLERK_USER_PAGE);
      const page = await clerk.users.getUserList({
        userId: [...chunk],
        limit: CLERK_USER_PAGE,
      });
      for (const user of page.data) {
        signals.set(user.id, {
          clerkPlan: planFromPublicMetadata(
            user.publicMetadata as Record<string, unknown> | null
          ),
          hasCurrentPaymentGrant: hasCurrentPaymentGrant(
            user.privateMetadata as Record<string, unknown> | null
          ),
        });
      }
    }
    return signals;
  } catch (error) {
    log.error("cron.auto-refresh.clerk_plan_lookup_failed", {
      users: userIds.length,
      error: String(error),
    });
    return null;
  }
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
    loadClerkSignals(userIds),
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
    const members: MemberPlanSignal[] = (membersByOrg.get(org.id) ?? []).map(
      (userId) => {
        // Clerk 실패 시 사용자별 결제 권한은 모른다 → free 로 둔다(DB 권한만 남음).
        const clerk = clerkSignals?.get(userId);
        return {
          clerkPlan: clerk?.clerkPlan ?? "free",
          hasCurrentPaymentGrant: clerk?.hasCurrentPaymentGrant ?? false,
          hasInviteRedemption: invited.has(userId),
          isApprovedPartner: approvedPartners.has(userId),
        };
      }
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
