/**
 * 🔴🔴 **`/llms.txt` 는 AI 가 그대로 인용한다 — 여기 적힌 거짓은 답변으로 퍼진다.**
 *
 * 배경(N-47 · 2026-08-19 실측): 라이브 `https://findable.co.kr/llms.txt` 가
 * **접은 기능과 빈 페이지를 AI 에게 현재형으로 알리고** 있었다.
 *
 * ```
 * - [무료 진단](…/ko/audit): 도메인 입력만으로 AI 인용 현황을 측정합니다   ← 👤 결정 A 로 접음
 * - [블로그](…/ko/blog)                                                    ← .mdx 0건(「곧 만나요」 한 장)
 * ```
 *
 * ⚠️ **규칙은 이미 있었다.** `route.ts` 헤더가 *"여기에 미출시 기능을 쓰지 말 것 —
 *   이 파일은 AI 가 그대로 인용한다"* 라고 **자기 입으로 적어놓고 스스로 어겼다.**
 *   📕 *"이미 있는 걸 안 쓰고 있을 수 있다"*(N-46) 의 변주 — 규칙은 있고 **가드가 없었다.**
 *   ⭐ 주석은 사람이 읽을 때만 작동한다. 계약은 테스트로 물려야 한다.
 *
 * 🔴 **왜 GEO 회사에 특히 치명적인가**: 우리는 *"AI 답변에 정확히 인용되게 해준다"* 를 판다.
 *   그 회사의 AI 용 표준 파일이 **틀린 정보를 배포**하면 제품 주장 자체가 무너진다.
 *   경쟁사·심사관이 30초면 확인하는 자리다(N-39 가 같은 이유로 이 파일을 만들었다).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(process.cwd(), "../web");
const LLMS = readFileSync(join(WEB, "app/llms.txt/route.ts"), "utf8");

/**
 * 🔴 **주석을 세지 않는다** — 이 파일은 헤더 주석에서 *"무료 진단"*·*"블로그"* 를
 *   **설명하려고** 언급한다(왜 뺐는지 적은 자리). 주석까지 세면 가드가 자기 문서를 물어
 *   영원히 실패한다. 📕 *"가드가 자기 주석을 세는 사고"* — `stripComments` 를 먼저 적용한다.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** 실제로 AI 에게 나가는 본문(템플릿 리터럴)만 남긴다. */
const PUBLISHED = stripComments(LLMS);

describe("/llms.txt — AI 에게 없는 것을 있다고 말하지 않는다", () => {
  it("⛔ 접은 기능(무료 진단)을 **목록으로 광고하지 않는다**", () => {
    // 👤 결정 A(2026-08-19): 페이지는 남기되 **동선·광고에서 뺀다**.
    // `[이름](URL)` 형태의 **목록 항목**만 잡는다 — 산문에서 맥락상 언급하는 건 막지 않는다.
    const entries = PUBLISHED.match(/^- \[[^\]]+\]\([^)]+\)/gm) ?? [];
    const advertisesAudit = entries.filter((e) => /\/audit/.test(e));
    expect(advertisesAudit).toEqual([]);
  });

  it("⛔ 빈 블로그를 리소스로 소개하지 않는다 (.mdx 가 0건인 동안)", () => {
    // ⭐ **해제 조건을 코드로 적는다** — 글이 실제로 생기면 이 가드는 스스로 비켜준다.
    //   그래야 "글 썼는데 테스트가 막는다"로 사람이 가드를 지우는 일이 안 생긴다.
    //   📕 *"가드가 버그의 호위병이 된다"* 의 반대편 — **낡은 가드가 개선을 막는 것**도 사고다.
    const { globSync } = require("node:fs") as typeof import("node:fs");
    let postCount = 0;
    try {
      postCount = globSync(join(WEB, "**/blog/**/*.mdx"), {
        exclude: (p: string) => p.includes("node_modules"),
      }).length;
    } catch {
      postCount = 0;
    }

    const entries = PUBLISHED.match(/^- \[[^\]]+\]\([^)]+\)/gm) ?? [];
    const advertisesBlog = entries.filter((e) => /\/blog/.test(e));

    if (postCount === 0) {
      expect(advertisesBlog).toEqual([]);
    } else {
      // 글이 생겼다 = 소개해도 된다(오히려 소개해야 GEO 상 유리하다).
      expect(advertisesBlog.length).toBeGreaterThan(0);
    }
  });

  it("✅ 실재하는 핵심 페이지는 계속 싣는다 (가드가 과잉 삭제를 부르지 않게)", () => {
    // 가드가 "빼는 쪽"으로만 작동하면 누군가 전부 지워도 통과한다. 최소 계약을 건다.
    expect(PUBLISHED).toContain("/ko/pricing");
    expect(PUBLISHED).toContain("/ko/contact");
  });
});
