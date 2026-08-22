/**
 * env parity 게이트가 **올바른 프로젝트**를 감사하는지 못박는다.
 *
 * 🔴🔴 N-49 사고: 게이트가 루트에서 `vercel env pull` 을 했는데 **루트 `.vercel` 은
 *   `findable`(web) 을 가리킨다**. 러너는 `findable-app` 에서 돈다.
 *   → 게이트가 계속 **엉뚱한 프로젝트를 감사**했고, 그래서
 *     ① 브리핑 플래그를 못 읽어 `FIRECRAWL_API_KEY` 승격이 **안 일어났고**
 *     ② `PORTONE_API_SECRET` 이 「MISS」로 뜨는 걸 *"알려진 오탐"* 으로 문서에 적어뒀다
 *        (실제로는 app 에 **있다**. 오탐이 아니라 **오조회**였다).
 *
 * 📕 이 테스트가 무는 것 = 「어느 디렉터리에서 pull 하는가」.
 *   `vercel env ls` 는 실행 위치마다 다른 프로젝트를 찍으므로
 *   *"이름이 findable-app 이었다"* 로는 안심할 수 없다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GUARD_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "scripts",
  "check-app-env-parity.sh"
);

function readGuard(): string {
  return readFileSync(GUARD_PATH, "utf8");
}

/** 주석을 지운 실행부만 본다 — 주석의 낱말이 가드를 통과시키면 안 된다(📕 N-47 교훈 3). */
function guardBody(): string {
  return readGuard()
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

describe("env parity 게이트 — 올바른 프로젝트를 감사하는가", () => {
  it("가드 스크립트가 존재하고 비어 있지 않다(자기점검)", () => {
    const src = readGuard();
    expect(src.length).toBeGreaterThan(500);
  });

  it("🔴 `apps/app` 에서 pull 한다 — 루트에서 하면 web 을 감사한다", () => {
    const body = guardBody();
    // pull 호출이 apps/app 경로 안에서 일어나야 한다.
    expect(body).toMatch(/apps\/app/);
    expect(body).toMatch(/env pull/);
    // `cd`(또는 그에 준하는 디렉터리 전환) 없이 pull 하면 루트=web 이 된다.
    const pullLine = body
      .split("\n")
      .find((l) => l.includes("env pull") && !l.includes("echo"));
    expect(pullLine).toBeDefined();
    expect(pullLine).toMatch(/cd\s+"?\$APP_DIR"?|cd\s+.*apps\/app/);
  });

  it("pull 결과가 비면 조용히 통과하지 않는다(빈 대상 자기점검)", () => {
    const body = guardBody();
    // `-s` 검사 또는 그에 준하는 «비었으면 실패» 분기가 있어야 한다.
    expect(body).toMatch(/-s\s+"\$TMP"/);
    expect(body).toMatch(/exit 1/);
  });

  it("브리핑 플래그가 ON 이면 FIRECRAWL_API_KEY 를 필수로 승격한다", () => {
    const body = guardBody();
    expect(body).toMatch(/AUDIT_BRIEFING_IN_MAIN_ENABLED/);
    expect(body).toMatch(/FIRECRAWL_API_KEY/);
    // 승격이 «플래그 판정 뒤에» 와야 의미가 있다.
    const flagAt = body.indexOf("AUDIT_BRIEFING_IN_MAIN_ENABLED");
    const promoteAt = body.lastIndexOf("FIRECRAWL_API_KEY");
    expect(promoteAt).toBeGreaterThan(flagAt);
  });
});
