/**
 * 🔬 **운영 콘솔 상세(CMS) 가드** — N-46.
 *
 * 👤 *"가입 아이디, 가입하면서 입력한 브랜드 정보 등 … CMS 로서도 기능하도록"*
 *
 * 🔴🔴 **이 기능은 남의 조직 데이터를 그대로 돌려준다.** 게이트가 뚫리면 전 고객
 *   정보(이메일·도메인·경쟁사·질문)가 샌다 → **권한 검사를 최우선으로 문다.**
 *
 * ⚠️ 문구가 아니라 **계약**을 본다: 권한 게이트가 있는가 · 화면이 「없음」을 말하는가 ·
 *   빈 값 갈래가 서로 다른 문구인가(📕 「두 갈래가 같은 문구면 화면은 똑같다」).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ACTION = readFileSync(
  join(process.cwd(), "app/actions/admin/orgs.ts"),
  "utf8"
);
const PANEL = readFileSync(
  join(process.cwd(), "app/(authenticated)/admin/orgs/org-detail.tsx"),
  "utf8"
);
const TABLE = readFileSync(
  join(process.cwd(), "app/(authenticated)/admin/orgs/org-table.tsx"),
  "utf8"
);
const PAGE = readFileSync(
  join(process.cwd(), "app/(authenticated)/admin/orgs/page.tsx"),
  "utf8"
);

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** `getOrgDetail` 함수 **본문만** 잘라낸다 — 파일 전체를 보면 다른 함수의 게이트가 통과시킨다. */
function getOrgDetailBody(): string {
  const body = stripComments(ACTION);
  const start = body.indexOf("export async function getOrgDetail");
  // 🔴 **훑는 대상이 비어있지 않다** 자기점검(N-47 사고 5회 중 1번 유형 —
  //   glob·검색이 0개를 훑고 조용히 통과했다).
  //   ⚠️ `expect` 를 쓰면 biome(noMisplacedAssertion)이 막는다 — 이 함수는 `it()` 밖이라
  //   규칙이 옳다(검증문은 테스트 안에 있어야 한다). 그래서 **throw** 로 바꿨다:
  //   보호 강도는 같고(대상이 없으면 즉시 실패) 규칙과도 어긋나지 않는다.
  if (start < 0) {
    throw new Error("가드 대상이 없다: getOrgDetail — 이름이 바뀌었는지 확인할 것");
  }
  const next = body.indexOf("\nexport ", start + 10);
  return body.slice(start, next === -1 ? undefined : next);
}

describe("운영 콘솔 상세 — 권한", () => {
  it("🔴🔴 **`getOrgDetail` 이 admin 게이트로 시작한다**", () => {
    const fn = getOrgDetailBody();
    expect(
      fn.includes("requireAdmin()"),
      "admin 확인 없이 남의 조직 데이터를 돌려주면 전 고객 정보가 샌다"
    ).toBe(true);
    // 게이트가 **DB 조회보다 먼저**여야 한다 — 뒤에 있으면 이미 읽은 뒤다.
    expect(fn.indexOf("requireAdmin()")).toBeLessThan(fn.indexOf("database."));
  });

  it("⛔ **화면이 서버액션을 직접 import 하지 않는다** (주입 유지)", () => {
    // 📕 N-41: 직접 import 하면 `node:*` 가 브라우저 번들로 끌려와 Storybook 이 죽는다.
    expect(TABLE).not.toMatch(/^import\s+\{[^}]*getOrgDetail/m);
    expect(TABLE).toContain("onLoadDetail");
    // 페이지가 실제로 주입하고 있어야 기능이 산다(배선 누락 방지).
    expect(PAGE).toContain("onLoadDetail={getOrgDetail}");
  });
});

describe("운영 콘솔 상세 — 👤 가 요구한 항목이 실제로 나온다", () => {
  const fn = getOrgDetailBody();

  it("🔴 **가입 아이디(이메일)를 조회한다**", () => {
    expect(fn).toContain("email: true");
    expect(fn).toContain("database.user.findMany");
  });

  it("🔴 **브랜드 정보 4종을 조회한다** — 도메인·업종·경쟁사·별칭", () => {
    for (const field of [
      "domain: true",
      "industry: true",
      "competitors: true",
      "entityVariants: true",
      "marketScope: true",
    ]) {
      expect(fn, `${field} 가 빠졌다`).toContain(field);
    }
  });

  it("🔴 **추적 질문을 조회한다** — 무엇을 물어보는지가 결과를 정한다", () => {
    expect(fn).toContain("prompts:");
  });
});

describe("운영 콘솔 상세 — 빈 값을 정직하게 말한다", () => {
  it("⛔ **없는 값을 「없음」이라 말한다** (빈칸으로 두지 않는다)", () => {
    const body = stripComments(PANEL);
    // 고객이 안 넣은 값은 침묵하지 않고 그렇다고 말해야 운영 판단이 된다.
    expect(body).toContain("Empty");
    expect(body).toMatch(/없음|없어요/);
  });

  it("🔴 **경쟁사 빈 값은 「그래서 뭐가 달라지는지」까지 말한다**", () => {
    // 등록 경쟁사가 없으면 측정마다 AI 가 새로 추측한다 = 회차마다 흔들린다.
    // 단순히 "없음"만 쓰면 운영자가 그 의미를 모른다.
    expect(stripComments(PANEL)).toMatch(/새로 추측/);
  });

  it("⛔ **빈 상태 문구들이 서로 다르다** (분기만 있고 말이 같으면 화면은 똑같다)", () => {
    const body = stripComments(PANEL);
    const empties = [...body.matchAll(/<Empty>([^<]{2,})<\/Empty>/g)].map((m) =>
      m[1].trim()
    );
    expect(empties.length, "빈 상태 안내가 하나도 없다").toBeGreaterThan(2);
    // 「없음」처럼 같은 말이 두 번 나오는 건 허용하되(항목이 다름), 전부 같으면 실패.
    expect(new Set(empties).size).toBeGreaterThan(1);
  });
});
