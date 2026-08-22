/**
 * 🔬 **가입자↔조직 연결 가드** — N-46 실측 버그.
 *
 * 🔴 `User.organizationId` 가 **7명 전원 NULL** 이었다. 스키마에 필드도 관계도 있는데
 *   **채우는 코드가 어디에도 없었다** — 멤버십 웹훅이 analytics 만 쏘고 DB 를 안 건드렸다.
 *   증상: 운영 콘솔이 사람이 있는 조직을 *"가입자 0"* 이라고 말한다.
 *   📕 「못 잰 것을 0이라 부르기」의 데이터판.
 *
 * ⚠️ `// Need to unlink the user from the group` 이라는 next-forge 기본 주석이
 *   **주석인 채로** 남아 있었다 → 탈퇴도 반영이 안 됐다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(process.cwd(), "app/webhooks/auth/route.ts"),
  "utf8"
);
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** 특정 핸들러 **본문만** 자른다 — 파일 전체를 보면 다른 핸들러가 통과시킨다. */
function handlerBody(name: string): string {
  const body = stripComments(SRC);
  const start = body.indexOf(`const ${name}`);
  // 🔴 훑는 대상 비어있지 않음 자기점검(N-47). `expect` → `throw`
  //   (이 함수는 `it()` 밖이라 biome noMisplacedAssertion 이 옳다. 보호 강도는 동일.)
  if (start < 0) {
    throw new Error(`가드 대상이 없다: ${name} — 이름이 바뀌었는지 확인할 것`);
  }
  const next = body.indexOf("\nconst handle", start + 10);
  return body.slice(start, next === -1 ? undefined : next);
}

describe("멤버십 웹훅이 DB 에 반영된다", () => {
  it("🔴 **가입하면 조직에 연결한다** (analytics 만 쏘지 않는다)", () => {
    const fn = handlerBody("handleOrganizationMembershipCreated");
    expect(
      fn.includes("linkUserToOrg"),
      "DB 를 안 건드리면 운영 콘솔이 '가입자 0'이라 말한다"
    ).toBe(true);
    // 실제 org id 를 넘겨야 한다(null 을 넘기면 연결이 아니라 해제다).
    expect(fn).toMatch(/linkUserToOrg\([^)]*organization\.id/);
  });

  it("🔴 **탈퇴하면 연결을 끊는다** — 나간 사람이 가입자로 남지 않게", () => {
    const fn = handlerBody("handleOrganizationMembershipDeleted");
    expect(fn).toContain("linkUserToOrg");
    expect(fn).toMatch(/linkUserToOrg\([^)]*,\s*null\s*\)/);
  });

  it("⛔ **두 핸들러가 서로 반대로 쓴다** (연결/해제가 같으면 한쪽이 버그)", () => {
    const created = handlerBody("handleOrganizationMembershipCreated");
    const deleted = handlerBody("handleOrganizationMembershipDeleted");
    const argOf = (s: string) =>
      s.match(/linkUserToOrg\(([^;]*)\);/)?.[1]?.trim();
    expect(argOf(created)).not.toBe(argOf(deleted));
  });

  it("⛔ **DB 실패가 웹훅을 막지 않는다** — Clerk 재시도 폭주 방지", () => {
    const fn = handlerBody("linkUserToOrg");
    expect(fn).toContain("try");
    expect(fn).toContain("catch");
    expect(fn).toContain("log.error");
  });

  it("⛔ **호출부가 await 한다** — 안 하면 응답이 먼저 나가 write 가 유실될 수 있다", () => {
    const body = stripComments(SRC);
    expect(body).toContain("await handleOrganizationMembershipCreated");
    expect(body).toContain("await handleOrganizationMembershipDeleted");
  });
});
