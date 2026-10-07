import "server-only";

import { database, type Industry } from "@repo/database";
import {
  SALES_INTERNAL_ORG_ID,
  SALES_INTERNAL_ORG_NAME,
} from "@repo/database/internal-orgs";
import { log } from "@repo/observability/log";

/**
 * 영업 전용 **내부** 조직 — 「회사 찾기」 [측정]이 만드는 영업 대상 브랜드는 이 조직에만 생긴다.
 *
 * 2026-10-07 대표 결정: Clerk 에는 조직을 만들지 않는다(Clerk 를 무겁게 하지 않기).
 *   → 우리 DB 에만 고정 id(SALES_INTERNAL_ORG_ID) 한 줄로 find-or-create. env·Clerk 조회 없음.
 *   → ownerId 는 버튼을 누른 관리자의 Clerk user id(처음 만들 때만 기록, 이후 바꾸지 않는다).
 *
 * 한도 처리(코드 확인 2026-10-07):
 *   - 관리자 1건 측정 `runMeasureOne` → `startMeasureOne`(packages/audit/measure-one.ts)은 요금제·24시간 한도를 보지 않는다.
 *     같은 도메인 측정이 이미 돌고 있으면 건너뛰는 것(already_running)만 있다. 러너(runAuditJob)도 요금제를 보지 않는다.
 *   - 브랜드 수 한도는 고객용 등록(`assignBrandOwner` → planCapabilities.brandLimit)에만 있다.
 *   → 영업 브랜드는 여기서 직접 만들고 `runMeasureOne` 으로 측정한다. 고객 조직의 한도·과금 코드는 부르지도 바꾸지도 않는다.
 *
 * 🔴 이 조직은 고객이 아니다 — 정기 자동 측정·결제·안내 메일·고객 목록·통계에서 빠진다
 *   (packages/database/internal-orgs.ts · apps/app/__tests__/internal-org-exclusion.test.ts).
 */

export async function ensureSalesOrg(adminUserId: string): Promise<string> {
  const existing = await database.organization.findUnique({
    where: { id: SALES_INTERNAL_ORG_ID },
    select: { id: true },
  });
  if (existing) {
    return existing.id;
  }
  await database.organization.upsert({
    where: { id: SALES_INTERNAL_ORG_ID },
    create: {
      id: SALES_INTERNAL_ORG_ID,
      name: SALES_INTERNAL_ORG_NAME,
      ownerId: adminUserId,
    },
    update: {},
  });
  log.warn("ax_mail.sales_org.created", { adminUserId });
  return SALES_INTERNAL_ORG_ID;
}

/** 영업 조직 안에서 도메인으로 브랜드를 찾고, 없으면 만든다(요금제 브랜드 수 한도 없음 — 영업 전용). */
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
