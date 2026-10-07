import "server-only";

import { clerkClient } from "@repo/auth/server";
import { database, type Industry } from "@repo/database";
import { log } from "@repo/observability/log";

/**
 * 영업 전용 조직(org) — 「회사 찾기」 [측정]이 만드는 영업 대상 브랜드는 **이 org 에만** 생긴다(대표 승인 2026-10-07).
 *
 * 왜: 예전엔 관리자가 지금 고른 org(고객 org 일 수도 있다)에 브랜드가 생기고 그 org 의 요금제 브랜드 수·24시간 한도를 탔다.
 *
 * 한도 처리(확인 2026-10-07):
 *   - 관리자 1건 측정 `runMeasureOne` → `startMeasureOne`(packages/audit/measure-one.ts)은 요금제·24시간 한도를 보지 않는다.
 *     같은 도메인 측정이 이미 돌고 있으면 건너뛰는 것(already_running)만 있다. 러너(runAuditJob)도 요금제를 보지 않는다.
 *   - 브랜드 수 한도는 고객용 등록(`assignBrandOwner` → planCapabilities.brandLimit)에만 있다.
 *   → 영업 org 브랜드는 여기서 **직접** 만들고 `runMeasureOne` 으로 측정한다. 고객 org 의 한도·과금 코드는 부르지도 바꾸지도 않는다.
 *
 * env `SALES_DISCOVERY_ORG_ID` = Clerk 조직 id(org_…). 없으면 [측정]을 막는다.
 */

const ORG_ID_RE = /^org_[A-Za-z0-9]{8,64}$/;

export function salesOrgId(
  env: Record<string, string | undefined> = process.env
): string | null {
  const value = (env.SALES_DISCOVERY_ORG_ID ?? "").trim();
  return ORG_ID_RE.test(value) ? value : null;
}

/**
 * DB 에 영업 org 행이 있도록 보장(relationMode="prisma" 라 없으면 고아 브랜드가 조용히 생긴다).
 * 없으면 Clerk 에서 이름을 읽어 최소 행만 만든다(ensure-org.ts 폴백과 같은 방식, 요금 칸은 기본값).
 * Clerk 에 없는 id 면 false.
 */
export async function ensureSalesOrg(orgId: string): Promise<boolean> {
  const existing = await database.organization.findUnique({
    where: { id: orgId },
    select: { id: true },
  });
  if (existing) {
    return true;
  }
  try {
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({
      organizationId: orgId,
    });
    await database.organization.upsert({
      where: { id: orgId },
      create: {
        id: orgId,
        name: org.name ?? orgId,
        ownerId: org.createdBy ?? orgId,
      },
      update: {},
    });
    log.warn("ax_mail.sales_org.created_row", { orgId });
    return true;
  } catch {
    log.warn("ax_mail.sales_org.missing", { orgId });
    return false;
  }
}

/** 영업 org 안에서 도메인으로 브랜드를 찾고, 없으면 만든다(요금제 브랜드 수 한도 없음 — 영업 전용). */
export async function ensureSalesBrand(input: {
  domain: string;
  industry: Industry | null;
  name: string;
  orgId: string;
}): Promise<{ created: boolean; id: string }> {
  const found = await database.brand.findFirst({
    where: { domain: input.domain, organizationId: input.orgId },
    select: { id: true },
  });
  if (found) {
    return { created: false, id: found.id };
  }
  const brand = await database.brand.create({
    data: {
      domain: input.domain,
      industry: input.industry,
      name: input.name,
      organizationId: input.orgId,
    },
    select: { id: true },
  });
  return { created: true, id: brand.id };
}
