/**
 * 🔴 **왜 이 테스트가 있나** (세션N-42 — 운영 콘솔)
 *
 * KAIST 오버엣지 참여 기업이 초대 코드로 들어오는데 **누가 가입했는지 앱에서 볼 화면이
 * 0곳**이었다(실측: `User`·`Organization` 을 조회하는 admin 화면이 없다).
 * 운영자가 매번 SQL 을 돌려야 하는 상태였다.
 *
 * ⚠️ **Clerk 탓이 아니었다** — 가입자 데이터는 우리 DB 에 있고 화면만 없었다.
 *   (인증을 바꿔도 이 화면은 똑같이 필요하다 → 스택 교체는 답이 아니었다.)
 *
 * 이 화면은 **플랜을 공짜로 올릴 수 있는 경로**라 게이트가 특히 중요하다:
 *   admin 판정이 빠지면 아무나 자기 조직을 growth 로 올릴 수 있다.
 *
 * ⚠️ 네트워크·DB 를 타지 않는다 — 소스의 계약만 검사한다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ACTIONS = join(process.cwd(), "app/actions/admin/orgs.ts");
const PAGE = join(process.cwd(), "app/(authenticated)/admin/orgs/page.tsx");
const TABLE = join(
  process.cwd(),
  "app/(authenticated)/admin/orgs/org-table.tsx"
);
const SIDEBAR = join(
  process.cwd(),
  "app/(authenticated)/components/sidebar.tsx"
);

const actionsSource = readFileSync(ACTIONS, "utf8");
const pageSource = readFileSync(PAGE, "utf8");
const tableSource = readFileSync(TABLE, "utf8");
const sidebarSource = readFileSync(SIDEBAR, "utf8");

// 정규식은 최상위에(lint: useTopLevelRegex).
/** 내보내는 서버액션 이름. 전부 게이트를 가져야 한다. */
const EXPORTED_ACTIONS = /export async function (\w+)/g;
/** 페이지가 admin 이 아니면 404 로 막는가. */
const PAGE_GATE = /if \(!\(await isAdmin\(\)\)\) \{\s*notFound\(\);/;
/** 표가 서버액션을 직접 import 하면 Storybook 이 죽는다(주입 패턴 강제). */
const TABLE_IMPORTS_ACTION =
  /import \{[^}]*\b(listOrgs|setOrgPlanDays|createInviteCode)\b/;
/** 사이드바 링크 — 없으면 화면이 있어도 없는 것과 같다(N-34). */
const SIDEBAR_LINK = /url: "\/admin\/orgs"/;
/** 회수(days<=0)가 free 로 떨어뜨리는가. */
const REVOKE_TO_FREE = /const plan: Plan = revoke \? "free" : "growth"/;
/** 부여 플랜을 growth 로 고정했는가(Plan enum 확장 = 상품 구성 변경). */
const GRANT_PLAN_FIXED = /grantPlan: "growth"/;

describe("운영 콘솔 — 권한 게이트", () => {
  it("🔒 내보낸 서버액션이 **전부** requireAdmin 을 부른다", () => {
    const names = [...actionsSource.matchAll(EXPORTED_ACTIONS)].map(
      (m) => m[1]
    );
    expect(names.length).toBeGreaterThanOrEqual(5);
    // 함수 본문마다 게이트가 있는지 — 하나라도 빠지면 아무나 플랜을 올린다.
    for (const name of names) {
      const start = actionsSource.indexOf(`export async function ${name}`);
      const body = actionsSource.slice(start, start + 700);
      expect(body).toContain("requireAdmin()");
    }
  });

  it("🔒 페이지가 admin 이 아니면 404 (존재를 노출하지 않는다)", () => {
    expect(PAGE_GATE.test(pageSource)).toBe(true);
  });
});

describe("운영 콘솔 — 구조 계약", () => {
  it("🔴 표가 서버액션을 직접 import 하지 않는다 (주입 패턴)", () => {
    // 직접 import 하면 node:* 가 브라우저 번들로 끌려와 Storybook 21장이 죽는다.
    expect(TABLE_IMPORTS_ACTION.test(tableSource)).toBe(false);
  });

  it("🔴 사이드바에 링크가 있다 (없으면 있어도 없는 것 — N-34)", () => {
    expect(SIDEBAR_LINK.test(sidebarSource)).toBe(true);
  });

  it("회수는 free 로 즉시 강하시킨다 (크론을 기다리지 않는다)", () => {
    expect(REVOKE_TO_FREE.test(actionsSource)).toBe(true);
  });

  it("⛔ 부여 플랜을 growth 로 고정한다 (Plan enum 확장 = 심사 항목)", () => {
    expect(GRANT_PLAN_FIXED.test(actionsSource)).toBe(true);
  });

  it("⛔ 결제 패키지를 import 하지 않는다", () => {
    expect(actionsSource).not.toContain("@repo/payments");
  });
});
