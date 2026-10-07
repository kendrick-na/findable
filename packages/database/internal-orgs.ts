/**
 * 내부 전용 조직(org) — 고객이 아닌, 우리 DB 에만 있는 조직. 2026-10-07 대표 결정.
 *
 * 「회사 찾기」 [측정]이 만드는 영업 대상 브랜드는 **영업 전용 내부 조직** 한 곳에만 생긴다.
 *   - Clerk 에는 만들지 않는다(Clerk 를 무겁게 하지 않기). Organization.id 는 우리 DB 문자열 id 라
 *     고정 id 하나로 find-or-create 한다(스키마·migration 변경 없음).
 *   - 🔴 이 조직은 **고객이 아니다** — 정기 자동 측정·결제/요금제 만료·안내 메일·고객 목록·통계에서 빠져야 한다.
 *     그런 곳은 모두 `notInternalOrg` / `brandNotInInternalOrg` 를 where 에 넣는다
 *     (목록과 테스트: apps/app/__tests__/internal-org-exclusion.test.ts).
 *
 * 이 파일은 순수 상수만 둔다(server-only·Prisma 클라이언트 import 없음) — 어느 패키지에서나 가볍게 import.
 */

/** 영업 전용 내부 조직 id(고정, UUID 형식). 절대 바꾸지 말 것 — 바꾸면 기존 영업 브랜드가 고아가 된다. */
export const SALES_INTERNAL_ORG_ID = "f1dab1e0-5a1e-4000-8000-00000000a001";

/** 화면·로그에 보이는 이름 */
export const SALES_INTERNAL_ORG_NAME = "Findable 영업(내부)";

/** 모든 내부 조직 id — 늘어나면 여기에만 추가한다. */
export const INTERNAL_ORG_IDS: readonly string[] = [SALES_INTERNAL_ORG_ID];

export function isInternalOrgId(id: string | null | undefined): boolean {
  return Boolean(id && INTERNAL_ORG_IDS.includes(id));
}

/** Organization where 조각 — 내부 조직 제외 */
export const notInternalOrg: { id: { notIn: string[] } } = {
  id: { notIn: [...INTERNAL_ORG_IDS] },
};

/** Brand where 조각 — 내부 조직 브랜드 제외 */
export const brandNotInInternalOrg: {
  organizationId: { notIn: string[] };
} = {
  organizationId: { notIn: [...INTERNAL_ORG_IDS] },
};
