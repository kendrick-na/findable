import "server-only";

import { auth, clerkClient } from "@repo/auth/server";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";

/**
 * org/user DB 적재 — 확인/폴백 헬퍼 (20번, 설계문서 §3 선행조건 0).
 *
 * D2 확정: org row의 1차 소유자는 Clerk 웹훅(P1, 2026-07-29 apps/app/webhooks/auth로 이설)이다.
 *   웹훅이 organization.created 이벤트에서 database.organization.upsert를 정식 실행한다.
 *   (이설 전 apps/api 웹훅은 Vercel 미배포+시크릿 빈값으로 실행 0회였음 → app으로 옮겨 살림.)
 *   이 헬퍼는 그 웹훅이 지연·유실됐을 때의 **폴백/이중가드**다:
 *     - ensureOrgExists: Org가 DB에 있는지 확인, 없으면 Clerk에서 조회해 최소 upsert.
 *   ⚠️ relationMode="prisma"라 Brand.organizationId FK 위반이 "차단"이 아니라 "고아 row
 *      조용한 성공생성"으로 나타난다 → Brand write 전에 반드시 Org 실재를 능동 보장할 것.
 *
 * ⚠️ 서버 전용(server-only). 클라이언트에서 호출 불가.
 */

/**
 * 현재 org가 DB에 존재하도록 보장. 있으면 그대로, 없으면 Clerk에서 조회해 최소 upsert.
 *   webhook이 정상 도는 한 이 upsert는 거의 타지 않는다(findUnique에서 즉시 반환).
 * @returns 보장된 organizationId(= Clerk orgId). org 미선택이면 null.
 */
export async function ensureOrgExists(): Promise<string | null> {
  const { orgId, userId } = await auth();
  if (!orgId) {
    return null;
  }

  const existing = await database.organization.findUnique({
    where: { id: orgId },
    select: { id: true },
  });
  if (existing) {
    return orgId;
  }

  // 폴백: 웹훅 미도달. Clerk에서 org 메타를 조회해 최소 생성.
  //   ownerId는 Clerk org의 createdBy(=owner)를 우선, 없으면 현재 userId.
  //   billing 필드(plan/billingStatus)는 기입하지 않는다 → 스키마 기본값(free/trialing)에 위임,
  //   결제 웹훅이 소유(설계 R6: 잘못된 billing 고착 방지).
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
        ownerId: org.createdBy ?? userId ?? orgId,
      },
      update: {}, // 존재 확인용 upsert. 이미 있으면 웹훅이 만든 값 존중.
    });
    log.warn("audit.org.fallback_created", { orgId });
    return orgId;
  } catch (error) {
    log.error("audit.org.ensure_failed", {
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// 사용자 입력 도메인 정규화 — assign.ts와 동일 규칙(호스트만: 소문자·프로토콜/경로/www 제거).
const PROTOCOL_RE = /^https?:\/\//;
const PATH_RE = /\/.*$/;
const WWW_RE = /^www\./;
export const normalizeDomain = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(PROTOCOL_RE, "")
    .replace(PATH_RE, "")
    .replace(WWW_RE, "");

/**
 * 현재 org의 Brand를 domain 기준으로 보장(있으면 재사용, 없으면 생성).
 *   audit 트리거가 "이 도메인 브랜드"를 Tracking에 잇기 위해 사용.
 *
 * D4 확정=Brand 복합 유니크 미추가 → 완전 원자성 없음. 동시 트리거 경합 시 중복 가능성 잔존(R2 인지).
 *   findFirst→create를 tx로 감싸 최소화하되, 근본 차단은 아님(향후 유니크 추가 시 해소).
 *
 * @returns 보장된 brandId, 또는 실패 시 null.
 */
export async function ensureBrand(
  organizationId: string,
  rawDomain: string,
  name: string
): Promise<string | null> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    return null;
  }
  try {
    return await database.$transaction(async (tx) => {
      const existing = await tx.brand.findFirst({
        where: { organizationId, domain },
        select: { id: true },
      });
      if (existing) {
        return existing.id;
      }
      const created = await tx.brand.create({
        data: { organizationId, domain, name: name.trim() || domain },
        select: { id: true },
      });
      return created.id;
    });
  } catch (error) {
    log.error("audit.brand.ensure_failed", {
      organizationId,
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
