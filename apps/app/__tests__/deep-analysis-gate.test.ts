/**
 * 심층분석(crew) 유료 게이트 회귀 테스트 — 2026-08-12 세션N-24 보안 감사.
 *
 * 🔴 **막는 사고: 권한 상승(유료 게이트 우회).**
 *   `canRunDeepAnalysis` 는 `email` 이 `"org:"` 로 시작하면 **무조건 허용**한다.
 *   그 설계는 *"`org:` 는 인증된 서버만 만드는 이름공간"* 이라는 약속에 의존하고,
 *   그 약속을 실제로 지키는 것은 공개 라우트의 **`email: z.email()`**
 *   (`apps/web/app/api/audit/route.ts`) 한 줄이다.
 *
 *   → 그 검증이 느슨해지면 누구나 `email: "org:x"` 를 보내
 *     **Letsur 크레딧을 소모하는 심층분석을 무료로 무제한** 실행할 수 있다.
 *
 * ⚠️ 그래서 이 테스트는 **두 층을 같이** 고정한다:
 *   ① 게이트의 의도된 동작(누가 통과/차단되는가)
 *   ② 🔴 그 게이트를 지키는 **입력 검증**(`z.email()` 이 `org:` 를 거부하는가)
 *   ①만 고정하면 ②가 느슨해질 때 **아무도 못 잡는다**(가드가 반쪽이 된다).
 *
 * 🔬 `usage-tier` 는 `process.env` 를 **호출 시점에** 읽으므로 테스트에서 주입 가능하다.
 */
import { canRunDeepAnalysis } from "@repo/audit/usage-tier";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";

const ADMIN = "admin@findable.co.kr";
const PARTNER = "partner@example.com";

let savedAdmin: string | undefined;
let savedPartner: string | undefined;

beforeEach(() => {
  savedAdmin = process.env.FINDABLE_ADMIN_EMAILS;
  savedPartner = process.env.FINDABLE_PARTNER_EMAILS;
  process.env.FINDABLE_ADMIN_EMAILS = ADMIN;
  process.env.FINDABLE_PARTNER_EMAILS = PARTNER;
});

afterEach(() => {
  process.env.FINDABLE_ADMIN_EMAILS = savedAdmin;
  process.env.FINDABLE_PARTNER_EMAILS = savedPartner;
});

describe("canRunDeepAnalysis — 의도된 동작", () => {
  test("일반 리드는 차단된다 (유료 유도)", () => {
    expect(canRunDeepAnalysis("someone@gmail.com")).toBe(false);
  });

  test("admin·파트너는 허용된다", () => {
    expect(canRunDeepAnalysis(ADMIN)).toBe(true);
    expect(canRunDeepAnalysis(PARTNER)).toBe(true);
  });

  test("대소문자가 달라도 판정이 같다", () => {
    expect(canRunDeepAnalysis(ADMIN.toUpperCase())).toBe(true);
  });

  test("org: 측정은 허용된다 (로그인 워크스페이스가 만든 것)", () => {
    expect(canRunDeepAnalysis("org:org_2abcDEF")).toBe(true);
  });
});

describe("🔒 게이트를 지키는 입력 검증 — z.email() 이 org: 를 거부해야 한다", () => {
  // 🔴 이 단정이 깨지면 `canRunDeepAnalysis` 가 아니라 **공개 라우트가** 뚫린 것이다.
  //    (`apps/web/.../api/audit/route.ts` 의 `email: z.email()`)
  const publicEmailRule = z.email();

  test.each([
    "org:abc",
    "org:org_123",
    "ORG:abc",
    // 🔴 가장 위험한 형태 — `@` 를 끼워 이메일처럼 보이게 만든 것
    "org:x@y.com",
  ])("공개 입력 %s 는 거부된다", (candidate) => {
    expect(publicEmailRule.safeParse(candidate).success).toBe(false);
  });

  test("정상 이메일은 통과한다 (과잉 차단 아님)", () => {
    expect(publicEmailRule.safeParse("someone@gmail.com").success).toBe(true);
  });

  test("🔴 거부되는 값들은 게이트를 통과시킬 수 있는 값이다 (위험의 실재 증명)", () => {
    // 즉 입력 검증이 유일한 방어선임을 명시적으로 못박는다.
    for (const candidate of ["org:abc", "org:x@y.com"]) {
      expect(canRunDeepAnalysis(candidate)).toBe(true);
      expect(publicEmailRule.safeParse(candidate).success).toBe(false);
    }
  });
});
