/**
 * 랜딩 라이브 카운터 — **실패를 0 으로 팔지 않는다** (2026-08-17 세션N-38).
 *
 * 🔴 **왜**: `getLiveStats()` 의 `catch` 가 **아무 말 없이** `auditCount: 0, brandCount: 0`
 *   을 반환했고, 화면은 그 0 을 **사실처럼** 렌더했다.
 *   실측(2026-08-17): 로컬에서 정확히 이 상태가 재현돼 히어로 바로 아래에
 *   `0 AUDITS RUN · 0 BRANDS TRACKED` 가 섰다. 프로덕션은 `103 · 29` 로 정상이었다 —
 *   즉 **조용해서 둘을 구분할 수 없다**는 것이 문제였다(로그도 없었다).
 *
 * ⚠️ 하필 이 자리는 **신뢰도 증거**로 쓰려고 둔 곳이라, 실패 시 0 을 보여주면
 *   증거가 아니라 *"아무도 안 쓰는 서비스"* 라는 **역효과**를 낸다.
 *   = 이 저장소가 반복해 온 「못 잰 것을 0 이라 부르기」(apple.com 사고)와 같은 계열.
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const FILE = join(
  import.meta.dirname,
  "../../..",
  "apps/web/app/[locale]/(home)/components/live-counter.tsx"
);
const raw = readFileSync(FILE, "utf8");

/** 주석을 걷어 **실행 코드만** 남긴다(주석 속 문구가 가드를 만족시키는 것을 막는다). */
const code = raw
  .split("\n")
  .filter((l) => {
    const t = l.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  })
  .join("\n");

/** 실패 시 `—` 로 대체하는 분기(칸별). */
const DASH_AUDIT = /stats\.isLive\s*\?[\s\S]{0,120}auditCount[\s\S]{0,60}"—"/;
const DASH_BRAND = /stats\.isLive\s*\?[\s\S]{0,120}brandCount[\s\S]{0,60}"—"/;
/** catch 가 에러를 받아 로그를 남기는지. */
const CATCH_WITH_ERROR = /catch\s*\(\s*error\s*\)/;
const FAIL_LOG = /landing\.live_counter\.query_failed/;
const IS_LIVE_FALSE = /isLive:\s*false/;
const IS_LIVE_TRUE = /isLive:\s*true/;

describe("라이브 카운터 — 조회 실패를 0 으로 표시하지 않는다", () => {
  test("🔴 실패 시 숫자 대신 `—` 를 세운다", () => {
    // `isLive` 가 false 면 두 칸 모두 대시. 이 분기가 사라지면 0 이 사실처럼 나간다.
    expect(code).toMatch(DASH_AUDIT);
    expect(code).toMatch(DASH_BRAND);
  });

  test("🔴 catch 가 조용히 지나가지 않는다 — 로그를 남긴다", () => {
    // 원래 `catch {}` 였다. 로그가 없으면 프로덕션에서 터져도 아무도 모른다.
    expect(code).toMatch(CATCH_WITH_ERROR);
    expect(code).toMatch(FAIL_LOG);
  });

  test("실패 상태는 isLive:false 로 구분된다", () => {
    expect(code).toMatch(IS_LIVE_FALSE);
    expect(code).toMatch(IS_LIVE_TRUE);
  });
});
