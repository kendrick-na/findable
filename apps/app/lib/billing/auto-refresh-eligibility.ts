/**
 * 자동 재측정 대상 조직 — 화면 게이트와 **같은 유료 판정**으로 고른다(2026-10-05).
 *
 * 왜: 결제 권한은 Clerk `publicMetadata.plan` + 비공개 결제 출처에만 쓰이고
 *   `Organization.plan` 에는 쓰이지 않는다(초대·관리자 기간 부여만 DB 에 쓴다).
 *   예전 cron 은 DB plan 만 봐서 **결제한 고객이 자동 측정에서 빠졌다**.
 *
 * 범위(scope, 2026-10-05 대표 결정 — 호출부가 env 로 정한다):
 *   - "paid": **실제 결제**로 얻은 플랜만. 결제 출처(findablePaymentId)가 있는 구성원의
 *     Clerk plan 중 그 결제가 아직 이용 기간 안이거나(1개월) 갱신 실패 7일 유예 중인 것.
 *     관리자·초대·파트너·DB 부여는 위에 얹혀도 측정 몫을 늘리지 않는다 →
 *     주기·브랜드 상한은 결제 플랜(`paymentPlan`) 기준. 브랜드가 상한보다 많으면
 *     **먼저 만든 N개**만 측정한다(createdAt 오름차순, 같으면 id).
 *   - "all": 예전 동작. 실효 플랜(결제·유예·초대·관리자·파트너) 전부, 브랜드 상한 없음.
 *
 * 판정: 조직 구성원(소유자 + DB User) 각각을 `resolveOrganizationPlanWithSource`
 *   (= 화면의 resolveEffectivePlan 과 같은 값 + 출처)로 판정하고 가장 높은 값을 쓴다.
 *
 * 원가 보호: Clerk 조회가 실패하면 결제 출처를 모른다 → "paid" 는 아무도 측정하지 않고,
 *   "all" 은 DB 권한만으로 판정한다(예전 동작). 대상을 늘리는 쪽으로 열지 않는다.
 *   측정 상한(MAX_TRIGGERS_PER_RUN)은 호출부가 그대로 지킨다.
 */

import {
  type MemberPlanSignal,
  type Plan,
  type PlanSource,
  planCapabilities,
  resolveOrganizationPlanWithSource,
} from "@repo/auth/plan";
import { database } from "@repo/database";
import { notInternalOrg } from "@repo/database/internal-orgs";
import { loadClerkPlanSignals, memberPlanSignal } from "./clerk-plan-signals";
import { isPaymentAccessActive } from "./paid-period";

/** 측정할 범위. "off" 는 호출부가 이 모듈을 부르기 전에 처리한다. */
export type AutoRefreshScope = "paid" | "all";

interface EligibleBrand {
  domain: string;
  entityVariants: unknown;
  id: string;
  name: string;
}

export interface AutoRefreshOrganization {
  brands: EligibleBrand[];
  id: string;
  /** 주기·상한을 정하는 플랜("paid" = 결제 플랜, "all" = 실효 플랜). */
  plan: Plan;
  /** 실효 플랜의 출처(로그·운영 확인용). */
  source: PlanSource;
}

/** 먼저 만든 브랜드부터 `limit` 개를 고른다(Infinity 면 전부). */
function oldestBrands<T extends EligibleBrand & { createdAt: Date }>(
  brands: readonly T[],
  limit: number
): EligibleBrand[] {
  return [...brands]
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id)
    )
    .slice(0, Number.isFinite(limit) ? limit : brands.length)
    .map(({ domain, entityVariants, id, name }) => ({
      domain,
      entityVariants,
      id,
      name,
    }));
}

/** 자동 재측정이 허용된(autoRefreshHours != null) 조직과 그 측정 플랜. */
export async function loadAutoRefreshOrganizations(
  now = new Date(),
  scope: AutoRefreshScope = "paid"
): Promise<AutoRefreshOrganization[]> {
  // 브랜드가 없는 조직은 측정할 것이 없으므로 처음부터 뺀다.
  const orgs = await database.organization.findMany({
    // 내부 조직(영업 전용)은 정기 자동 측정 대상이 아니다 — 자동 재측정은 돈이 든다.
    where: { brands: { some: {} }, ...notInternalOrg },
    select: {
      id: true,
      ownerId: true,
      plan: true,
      planExpiresAt: true,
      billingStatus: true,
      billingNextPaymentAt: true,
      users: { select: { id: true } },
      brands: {
        select: {
          createdAt: true,
          domain: true,
          entityVariants: true,
          id: true,
          name: true,
        },
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
    // 실패 시 null → 결제 출처 없음으로 판정(대상을 늘리는 쪽으로 열지 않는다).
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
      (userId) => {
        const signal = memberPlanSignal(
          userId,
          clerkSignals,
          invited,
          approvedPartners
        );
        if (scope === "all" || !signal.hasCurrentPaymentGrant) {
          return signal;
        }
        // "paid": 출처가 남아 있어도 이용 기간·유예가 끝났으면 결제 몫으로 치지 않는다
        // (만료 단계가 Clerk 쓰기에 실패해 출처가 남은 경우의 안전장치).
        const paymentId = clerkSignals?.get(userId)?.currentPaymentId ?? null;
        const active =
          paymentId !== null &&
          isPaymentAccessActive({
            paymentId,
            billingStatus: org.billingStatus,
            billingNextPaymentAt: org.billingNextPaymentAt,
            now,
          });
        return active ? signal : { ...signal, hasCurrentPaymentGrant: false };
      }
    );
    const verdict = resolveOrganizationPlanWithSource({
      organizationPlan: org.plan,
      organizationPlanExpiresAt: org.planExpiresAt,
      members,
      now,
    });
    const plan = scope === "paid" ? verdict.paymentPlan : verdict.plan;
    if (planCapabilities(plan).autoRefreshHours === null) {
      continue;
    }
    eligible.push({
      id: org.id,
      plan,
      source: verdict.source,
      // "all" 은 예전 동작 그대로 브랜드 상한을 적용하지 않는다.
      brands: oldestBrands(
        org.brands,
        scope === "paid"
          ? planCapabilities(plan).brandLimit
          : Number.POSITIVE_INFINITY
      ),
    });
  }
  return eligible;
}
