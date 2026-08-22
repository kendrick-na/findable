/*
 * 🔴 **로그인한 소유자는 심층분석(crew) 자격자다** — 2026-08-13 세션N-26.
 *
 * ## 막는 사고
 * 가입·결제를 마친 고객이 **자기 무료진단 결과**에서 crew 를 누르면
 * *"가입하고 계속 쓰기"* 를 보던 것. 이미 가입한 사람에게.
 *
 * 🔬 **원인**: `canRunDeepAnalysis(job.email)` 은 **문자열만** 본다 —
 *   `org:` 로 시작하는 **앱에서 만든 측정**만 통과시킨다. 그런데 고객이 www 에서
 *   받은 무료진단 job 은 **`email` 이 개인 주소 그대로** 남는다(결제해도 안 바뀐다).
 *
 * 🔴 **같은 job 을 두고 제품 두 곳이 서로 다른 말을 했다**:
 *   - 대시보드(`(authenticated)/page.tsx`): 로그인 이메일 ∪ org → **"내 측정"**
 *   - crew 게이트: `job.email` 문자열 → **"남"**
 *   → 판정을 하나로 합친다(`isAuditOwner` 재사용).
 *
 * ⭐ 앞 커밋 `4492022` 가 스스로 적어둔 약속: *"실질은 **로그인 게이트**이고
 *   free 플랜도 **가입하면 열린다**"*. 그 약속을 실제로 지키게 만드는 작업이다.
 *
 * ⚠️ 원가 방어는 **전역 일일 상한**이 한다(자격과 역할을 섞지 않는다).
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAuditOwner } from "@repo/audit/ownership";
import { canRunDeepAnalysis } from "@repo/audit/usage-tier";
import { describe, expect, test } from "vitest";

const CREW_ROUTE = join(
  import.meta.dirname,
  "../../web/app/api/audit/[jobId]/crew/route.ts"
);

const source = readFileSync(CREW_ROUTE, "utf8");

/** 주석·import 를 걷어낸 실제 코드. */
const code = source
  .split("\n")
  .filter((line) => {
    const t = line.trimStart();
    return !(
      t.startsWith("//") ||
      t.startsWith("*") ||
      t.startsWith("/*") ||
      t.startsWith("import")
    );
  })
  .join("\n");

// biome: 정규식은 최상위 상수로.
/** 소유 판정을 **호출**한다(import 줄만으로는 통과 못 함). */
const CALLS_RESOLVE_OWNER = /resolveIsOwner\s*\(/;
/**
 * 자격 = 소유자 **또는** 기존 tier(둘 중 하나면 통과).
 * ⚠️ `!(A || B)` 형태와 삼항(`A || B ? null : …`) 형태를 **둘 다** 받는다 —
 *   판정의 본질은 *"두 조건이 OR 로 묶였는가"* 이고, 표현 방식은 biome 복잡도
 *   상한 때문에 바뀔 수 있다(실제로 한 번 바꿨다). 형태를 하나로 못 박으면
 *   **올바른 리팩터가 가드에 막힌다**(낡은 문구가 올바른 변경을 실패시키는 그 패턴).
 */
const OWNER_OR_TIER = /isOwner\s*\|\|\s*canRunDeepAnalysis\(/;
/** 소유 판별에 필요한 필드를 실제로 select 한다. */
const SELECTS_ORG_ID = /organizationId:\s*true/;
/**
 * 자격 판정이 **무료 체험 경로를 가른다** — 자격자는 쿼터 조회를 타지 않는다.
 * 조건과 `checkFreeLeadQuota` 호출이 같은 식 안에서 이어져야 한다.
 */
const GATE_CONTROLS_QUOTA =
  /isOwner\s*\|\|\s*canRunDeepAnalysis\([\s\S]{0,120}?checkFreeLeadQuota\(/;
/** 🔴 되살아나면 안 되는 옛 조건(소유자를 무시하는 형태). */
const OLD_TIER_ONLY_GATE = /if\s*\(\s*!canRunDeepAnalysis\(job\.email\)\s*\)/;

describe("🔴 결함 재현 — 기존 판정이 유료 고객을 남으로 봤다", () => {
  test("www 무료진단 job(개인 이메일)은 tier 판정만으로는 **탈락**한다", () => {
    // 이게 결함의 핵심이다. 고객이 결제해도 이 job 의 email 은 개인주소 그대로다.
    expect(canRunDeepAnalysis("customer@brand.com")).toBe(false);
  });

  test("앱에서 만든 org 측정은 통과했다 — 그래서 결함이 안 보였다", () => {
    expect(canRunDeepAnalysis("org:org_123")).toBe(true);
  });

  test("⭐ 그런데 그 개인 이메일 job 의 **소유자는 본인이다**", () => {
    // 대시보드는 이 판정으로 "내 측정"이라고 말한다 → 두 곳이 어긋나 있었다.
    const job = { email: "customer@brand.com", organizationId: null };
    expect(isAuditOwner(job, { email: "customer@brand.com" })).toBe(true);
  });
});

describe("crew 라우트 — 소유자 자격 배선", () => {
  test("🔴 `resolveIsOwner` 를 **호출**한다", () => {
    expect(code).toMatch(CALLS_RESOLVE_OWNER);
  });

  test("자격 = 소유자 **또는** 기존 tier(둘 중 하나면 통과)", () => {
    expect(code).toMatch(OWNER_OR_TIER);
  });

  test("🔴 그 판정이 **무료 체험 경로를 실제로 가른다**(계산만 하고 버리지 않는다)", () => {
    // OR 로 묶어놓고 결과를 안 쓰면 소유자는 여전히 쿼터 경로로 떨어진다.
    // 자격자는 `checkFreeLeadQuota` 를 **타지 않아야** 한다.
    expect(code).toMatch(GATE_CONTROLS_QUOTA);
  });

  test("🔴 옛 조건(소유자 무시)이 되살아나지 않았다", () => {
    expect(code).not.toMatch(OLD_TIER_ONLY_GATE);
  });

  test("소유 판별에 필요한 `organizationId` 를 select 한다", () => {
    // 없으면 항상 undefined → 조직 소유자가 조용히 탈락한다.
    expect(code).toMatch(SELECTS_ORG_ID);
  });

  test("⚠️ 전역 일일 상한이 **자격 판정보다 앞**에 남아 있다", () => {
    // 원가 방어는 자격이 아니라 실행을 막아야 한다. 순서가 뒤집히면
    // 소유자가 상한을 무시하고 크레딧을 태울 수 있다.
    const capIndex = code.indexOf("isDailyCrewCapExhausted");
    const gateIndex = code.indexOf("resolveIsOwner");
    expect(capIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeGreaterThan(capIndex);
  });
});

describe("⛔ 과잉 개방 방지 — 아무나 열리지 않는다", () => {
  test("비로그인은 소유자가 아니다 → 기존 무료 1회 쿼터 경로로 간다", () => {
    const job = { email: "customer@brand.com", organizationId: null };
    expect(isAuditOwner(job, {})).toBe(false);
  });

  test("🔴 남의 진단은 로그인해도 자격이 생기지 않는다", () => {
    const job = { email: "someone-else@other.com", organizationId: null };
    expect(isAuditOwner(job, { email: "customer@brand.com" })).toBe(false);
    expect(canRunDeepAnalysis(job.email)).toBe(false);
  });
});
