/**
 * admin 판정의 **순수 함수 부분** — Clerk 호출 없이 테스트할 수 있게 분리(세션N-27).
 *
 * 왜 뺐나: `isAdmin()`·`requireAdmin()` 이 같은 판정을 **각자 인라인으로** 두 벌 갖고
 *   있었다. 한쪽만 고치면 *"목록은 막는데 서버액션은 통과"* 같은 어긋남이 생긴다.
 *   그리고 `currentUser()` 를 부르는 함수는 테스트가 어려워 **게이트가 고정되지 않는다**
 *   (실제로 admin 게이트 테스트가 **0개**였다 — 4개 라우트가 전부 이것에 의존하는데도).
 *
 * 🔴 이 admin 은 **플랫폼 운영자** 권한이다.
 *   ⚠️ `FINDABLE_ADMIN_EMAILS`(사용량 티어, `packages/audit/usage-tier.ts`) 와 **다른 축**이다.
 *      이름이 비슷해 혼동되지만 그건 "진단 무제한" 티어고, 이건 "관리자 화면 접근" 권한이다.
 *      → 운영자 권한은 **Clerk publicMetadata.role = "admin"** 으로만 부여된다.
 *
 * ⚠️ 순수 함수 — 의존성 0.
 */

/** Clerk publicMetadata 에서 운영자 여부를 판정한다. */
export function hasAdminRole(
  publicMetadata: Record<string, unknown> | null | undefined
): boolean {
  return publicMetadata?.role === "admin";
}
