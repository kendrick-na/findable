/**
 * 🔴🔴 **claude 웹검색 — Letsur Anthropic 네이티브 경로**(N-48 · 2026-08-20).
 *
 * ## 실측으로 확정한 것 (라이브 Letsur 키로 직접 호출)
 *
 * | 경로 | 결과 |
 * |---|---|
 * | `/v1/chat/completions` + anthropic 서버툴 | ❌ 검색 **안 함**(`finish_reason: tool_calls`) |
 * | `/v1/chat/completions` + function 래핑 | ❌ 검색 안 함 |
 * | **`/v1/messages` + `web_search_20250305`** | ✅ HTTP 200 · 검색 2회 · **출처 18건** |
 *
 * ⭐ 그래서 **엔드포인트가 판정의 핵심**이다. OpenAI 호환 경로로는 원리적으로 안 된다.
 *   → `@ai-sdk/anthropic` 없이 `fetch` 로 직접 부른다(**새 의존성 0**).
 *
 * ## 💰 원가 (Letsur 단가 in $3 / out $15 per 1M · 실측 토큰)
 * 추천형 0.043 unit · 경쟁사비교형 0.088 unit → 평균 **0.065/호출**.
 * 👤 보유 192.58 unit(KAIST 오버엣지 **무상** · 만료 2026-09-30) →
 * 하루 1~2회 측정이면 만료까지 **11%** 만 쓴다.
 *
 * ## 이 테스트가 지키는 것
 * ① 플래그로 갈린다(기본 off — 만료 후 되돌릴 수 있어야 한다)
 * ② 켜지면 **`/v1/messages`** 를 쓴다(chat/completions 로 되돌아가면 검색이 죽는다)
 * ③ 서버툴 이름·버전이 정확하다(`web_search_20250305`)
 * ④ **판정(`engineSourceState`)이 같이 갈린다** — 안 갈라면 출처를 받아놓고
 *    화면이 「출처 미수집」이라 말한다(📕 가드가 버그의 호위병)
 * ⑤ 실패 시 **null 로 폴백**한다(엔진을 잃지 않는다 — 📕 N-47 perplexity 사고)
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { engineSourceState } from "../../../packages/audit/market-scope";

const SRC = readFileSync(
  join(process.cwd(), "../../packages/ai/lib/engines/global-adapters.ts"),
  "utf8"
);
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const CODE = stripComments(SRC);

describe("claude 웹검색 — 경로와 계약", () => {
  it("가드가 실제 코드를 읽고 있다", () => {
    expect(CODE.length).toBeGreaterThan(3000);
    expect(CODE).toContain("makeGatewayAdapter");
  });

  it("① 플래그로 갈린다 — 기본 off(만료 후 되돌릴 수 있어야 한다)", () => {
    expect(CODE).toContain("FINDABLE_CLAUDE_WEB_SEARCH");
    // 🔴 `=== "1"` 로 **명시적 opt-in**. truthy 검사면 빈 문자열·"0" 에도 켜진다.
    expect(CODE).toMatch(/FINDABLE_CLAUDE_WEB_SEARCH\s*===\s*"1"/);
  });

  it("② **`/v1/messages`** 를 쓴다 — chat/completions 로는 검색이 안 된다(실측)", () => {
    expect(CODE).toMatch(
      /LETSUR_MESSAGES_URL\s*=\s*`\$\{LETSUR_BASE_URL\}\/messages`/
    );
    // 실제 호출 자리에서 그 URL 을 쓰는지(상수만 만들고 안 쓰면 무의미)
    expect(CODE).toMatch(/fetch\(\s*LETSUR_MESSAGES_URL/);
  });

  it("③ 서버툴 이름·버전이 정확하다", () => {
    expect(CODE).toContain("web_search_20250305");
    expect(CODE).toMatch(/name:\s*"web_search"/);
    // anthropic 네이티브는 이 헤더가 필수다(없으면 400).
    expect(CODE).toContain("anthropic-version");
  });

  it("⑤ 실패하면 null 로 폴백한다 — 엔진을 잃지 않는다", () => {
    const fn = CODE.slice(
      CODE.indexOf("async function runClaudeWithWebSearch"),
      CODE.indexOf("function makeGatewayAdapter")
    );
    expect(fn.length).toBeGreaterThan(200);
    // 응답이 나쁘면 null(→ 일반 경로로 내려간다)
    expect(fn).toMatch(/if\s*\(!res\.ok\)\s*\{\s*return null/);
    expect(fn).toMatch(/catch\s*\{\s*return null/);
    // 🔴 폴백 경로가 **일반 경로로 이어지는지**(그냥 죽으면 안 된다)
    //   ⚠️ 조건은 `tryClaudeWebSearch` 헬퍼로 빠졌다(복잡도 한도) → 두 고리를 각각 본다.
    const gate = CODE.slice(
      CODE.indexOf("async function tryClaudeWebSearch"),
      CODE.indexOf("function makeGatewayAdapter")
    );
    expect(gate).toMatch(
      /engineId !== "claude" \|\| !isClaudeWebSearchEnabled\(\)/
    );
    expect(gate).toMatch(/return await runClaudeWithWebSearch\(query, start\)/);
    const adapter = CODE.slice(CODE.indexOf("function makeGatewayAdapter"));
    expect(adapter).toMatch(
      /tryClaudeWebSearch\([\s\S]{0,120}?if\s*\(searched\)/
    );
  });

  it("🔴 웹검색 결과에 **본문 폴백을 섞지 않는다**(가짜 출처 재유입 금지)", () => {
    const fn = CODE.slice(
      CODE.indexOf("async function runClaudeWithWebSearch"),
      CODE.indexOf("function makeGatewayAdapter")
    );
    expect(fn).toMatch(/citedSources:\s*mapProviderSources\(sources\)/);
    expect(fn).not.toContain("extractCitedSources");
  });
});

describe("④ 판정이 플래그와 **같이** 갈린다", () => {
  const original = process.env.FINDABLE_CLAUDE_WEB_SEARCH;
  afterEach(() => {
    // biome(noDelete): `delete` 대신 빈 문자열로 되돌린다 — 판정이 `=== "1"` 이므로
    //   빈 문자열은 «꺼짐»과 동일하게 취급된다(원상복구와 같은 효과).
    process.env.FINDABLE_CLAUDE_WEB_SEARCH = original ?? "";
  });

  it("🔴 켜지면 claude 가 `collected` — 출처를 실제로 받는다", () => {
    process.env.FINDABLE_CLAUDE_WEB_SEARCH = "1";
    expect(engineSourceState("claude", false)).toBe("collected");
  });

  it("⚠️ 꺼지면 `not_collected` — 일반 채팅이라 구조적 0", () => {
    process.env.FINDABLE_CLAUDE_WEB_SEARCH = "0";
    expect(engineSourceState("claude", false)).toBe("not_collected");
  });

  it("✅ chatgpt 는 플래그와 무관하게 `not_collected`(회귀 방지)", () => {
    // chatgpt 는 OpenAI 라 이 서버툴이 없다 — 실측에서 도구를 무시했다(HTTP 200·검색 0).
    process.env.FINDABLE_CLAUDE_WEB_SEARCH = "1";
    expect(engineSourceState("chatgpt", false)).toBe("not_collected");
  });
});
