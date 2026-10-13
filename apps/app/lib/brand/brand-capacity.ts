import { planCapabilities } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { database } from "@repo/database";

/**
 * 이 도메인으로 **새 브랜드를 만들면 플랜 브랜드 상한을 넘는가**(2026-10-14).
 *
 * 🔴 왜: 브랜드 상한 검사가 `assign.ts`(브랜드 추가)에만 있고, 측정 시작(`startOrgTracking` → `ensureOrgBrand`)이
 *   브랜드를 만드는 경로에는 없었다 → 그 경로로 상한을 넘겨 브랜드가 생길 수 있었다.
 *
 * 이미 같은 도메인의 브랜드가 있으면(재측정) 새로 만들지 않으므로 막지 않는다.
 * 상한이 없는 플랜(Infinity)·읽기 실패는 막지 않는다(측정을 사소한 조회 실패로 막지 않는다).
 * 막아야 하면 상한 값을 돌려준다(안내 문구에 쓴다).
 */
export async function brandCapacityBlock(
  organizationId: string,
  domain: string
): Promise<{ limit: number } | null> {
  try {
    const limit = planCapabilities(await getCurrentPlan()).brandLimit;
    if (!Number.isFinite(limit)) {
      return null;
    }
    const existing = await database.brand.findFirst({
      where: { organizationId, domain },
      select: { id: true },
    });
    if (existing) {
      return null;
    }
    const count = await database.brand.count({ where: { organizationId } });
    return count >= limit ? { limit } : null;
  } catch {
    return null;
  }
}
