"use server";

import { requireAdmin } from "@repo/auth/admin";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { revalidatePath } from "next/cache";

/**
 * 운영 DB가 Prisma migration history 없이 생성된 이력 때문에 누락된
 * 카카오페이 정기결제 상태 컬럼을 한 번만 보정한다.
 *
 * `IF NOT EXISTS`라 여러 번 실행돼도 안전하며, 데이터 삭제·변환은 하지 않는다.
 * 이 액션은 보정 직후 삭제할 일회성 관리자 도구다.
 */
export async function repairBillingScheduleSchema(): Promise<void> {
  const adminId = await requireAdmin();

  await database.$executeRawUnsafe(`
    ALTER TABLE "Organization"
      ADD COLUMN IF NOT EXISTS "billingLastPaymentId" TEXT,
      ADD COLUMN IF NOT EXISTS "billingNextPaymentId" TEXT,
      ADD COLUMN IF NOT EXISTS "billingNextPaymentAt" TIMESTAMP(3);
  `);

  log.warn("admin.billing_schema_repaired", { adminId });
  revalidatePath("/billing");
}
