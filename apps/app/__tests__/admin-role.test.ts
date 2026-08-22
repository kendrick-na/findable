/**
 * 플랫폼 운영자(admin) 게이트 (세션N-27 신설).
 *
 * 🔴 **막는 사고**: `/admin/ops`·`/admin/audits`·`/admin/partners`·`/admin/evidence`
 *   4개 라우트와 사이드바 「관리자」 그룹이 **전부** 이 판정 하나에 걸려 있는데
 *   테스트가 **0개**였다. 여기가 뚫리면 남의 고객 진단 목록이 통째로 노출된다.
 *
 * 🔴 **혼동 주의**: `FINDABLE_ADMIN_EMAILS`(환경변수)는 **이것과 다른 축**이다.
 *   그건 `packages/audit/usage-tier.ts` 의 **진단 무제한 티어**고,
 *   운영자 권한은 **오직 Clerk `publicMetadata.role === "admin"`** 이다.
 *   → 세션N-27 인계서가 이 둘을 섞어 *"env 에 이메일을 추가하면 관리자 화면이 열린다"* 고
 *     적었는데 **틀렸다**(env 를 아무리 바꿔도 화면은 안 열린다).
 *
 * ⚠️ 순수 함수 테스트라 jsdom 도크블록이 필요 없다.
 */
import { describe, expect, it } from "vitest";
import { hasAdminRole } from "../../../packages/auth/admin-role";

describe("hasAdminRole — 통과해야 하는 것", () => {
  it('role 이 정확히 "admin" 이면 통과', () => {
    expect(hasAdminRole({ role: "admin" })).toBe(true);
  });

  it("다른 메타데이터가 같이 있어도 통과", () => {
    expect(hasAdminRole({ plan: "growth", role: "admin" })).toBe(true);
  });
});

describe("🔒 hasAdminRole — 반드시 막아야 하는 것", () => {
  it("메타데이터가 없으면 막는다", () => {
    expect(hasAdminRole(null)).toBe(false);
    expect(hasAdminRole(undefined)).toBe(false);
    expect(hasAdminRole({})).toBe(false);
  });

  it("role 이 다른 값이면 막는다", () => {
    expect(hasAdminRole({ role: "user" })).toBe(false);
    expect(hasAdminRole({ role: "partner" })).toBe(false);
    expect(hasAdminRole({ role: "" })).toBe(false);
  });

  it("🔴 대소문자를 다르게 써도 막는다 (엄격 일치)", () => {
    expect(hasAdminRole({ role: "Admin" })).toBe(false);
    expect(hasAdminRole({ role: "ADMIN" })).toBe(false);
  });

  it("🔴 공백을 끼워 넣어도 막는다", () => {
    expect(hasAdminRole({ role: " admin" })).toBe(false);
    expect(hasAdminRole({ role: "admin " })).toBe(false);
  });

  it("🔴 타입을 바꿔치기해도 막는다 (truthy 로 통과시키지 않는다)", () => {
    expect(hasAdminRole({ role: true })).toBe(false);
    expect(hasAdminRole({ role: 1 })).toBe(false);
    expect(hasAdminRole({ role: ["admin"] })).toBe(false);
    expect(hasAdminRole({ role: { toString: () => "admin" } })).toBe(false);
  });

  it("🔴 비슷한 키 이름으로는 통과하지 않는다", () => {
    expect(hasAdminRole({ isAdmin: true })).toBe(false);
    expect(hasAdminRole({ Role: "admin" })).toBe(false);
    expect(hasAdminRole({ roles: ["admin"] })).toBe(false);
  });
});
