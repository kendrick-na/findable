/**
 * 🔴 **왜 이 테스트가 있나** (세션N-39)
 *
 * Firecrawl 크레딧이 마르면 402 가 오는데, 전에는 402·401·429 가 전부
 * `Firecrawl HTTP <코드>` 한 줄로 뭉개졸 뿐 아니라 **재시도 루프가 그걸 「미노출」로
 * 오해해 없는 크레딧을 3번 더 긁었다.** 운영자는 로그를 봐도 원인을 못 골랐다.
 *
 * 근거 = Firecrawl 공식 에러 문서(2026-08-17 확인):
 *   402 Payment Required: Insufficient credits · 401 Unauthorized: Invalid token
 *   429 Rate limit exceeded — 재시도 가능은 408·429·5xx 뿐.
 *
 * ⚠️ **가드 규율**(reference_findable_traps §1): 존재 검사 금지 · 문구가 아니라 **계약**을
 *   검사한다 · 가드별로 **단독 조준** 케이스를 둔다(다른 가드에 가려 안 무는 사고 방지).
 *   그래서 아래는 402/401/429/500 을 **각각 독립적으로** 조준한다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const ADAPTER = join(ROOT, "packages/ai/lib/engines/naver-briefing-adapter.ts");
const RUNNER = join(ROOT, "packages/audit/briefing-runner.ts");
const WEB_RESULT = join(
  ROOT,
  "apps/web/app/[locale]/audit/[jobId]/components/audit-result.tsx"
);
const FAIL_CONST = join(ROOT, "packages/ai/lib/engines/briefing-failure.ts");

/**
 * 주석을 걷고 **실행 코드만** 남긴다.
 * 🔴 줄머리뿐 아니라 **줄 끝 주석**도 자른다 — 그러지 않으면
 *   `a: true, // a: false` 한 줄이 검사를 통과한다(N-36 에서 실제로 뚫렸다).
 *   문자열 리터럴 안의 `//`(URL 등)는 따옴표 상태를 보고 보존한다.
 * ♻️ `briefing-tracking-persist.test.ts` 와 **같은 구현**이다(동작이 갈리면 안 된다).
 */
const stripToCode = (raw: string): string => {
  const out: string[] = [];
  let inBlock = false;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes("*/")) {
        inBlock = false;
      }
      continue;
    }
    if (t.startsWith("//") || t.startsWith("*")) {
      continue;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) {
        inBlock = true;
      }
      continue;
    }
    let quote: string | null = null;
    let cut = -1;
    for (let i = 0; i < line.length; i++) {
      const c = line[i] as string;
      if (quote) {
        if (c === "\\") {
          i++;
        } else if (c === quote) {
          quote = null;
        }
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        continue;
      }
      if (c === "/" && line[i + 1] === "/") {
        cut = i;
        break;
      }
    }
    out.push(cut >= 0 ? line.slice(0, cut) : line);
  }
  return out.join("\n");
};

const adapterCode = stripToCode(readFileSync(ADAPTER, "utf8"));
const runnerCode = stripToCode(readFileSync(RUNNER, "utf8"));

// 정규식은 최상위에 둔다(lint: useTopLevelRegex — 함수 안에서 매번 컴파일 금지).
const BRANCH_402 = /status === 402[\s\S]{0,300}?\n\s{2}\}/;
const BRANCH_401 = /status === 401[\s\S]{0,300}?\n\s{2}\}/;
const BRANCH_429 = /status === 429[\s\S]{0,300}?\n\s{2}\}/;
const PREFIX_CREDITS = /BRIEFING_FAIL_PREFIX\.credits/;
const PREFIX_AUTH = /BRIEFING_FAIL_PREFIX\.auth/;
const PREFIX_RATE_LIMIT = /BRIEFING_FAIL_PREFIX\.rateLimit/;
const PREFIX_LITERALS = /"(\[[^"\]]+\])"/g;
const DECIDER_FN = /function isUnrecoverableBriefingFailure[\s\S]*?\n\}/;
const RETRY_LOOP =
  /for \(let i = 1; i < candidatePrompts\.length[\s\S]*?\n {4}\}/;
const CALLS_DECIDER = /isUnrecoverableBriefingFailure\(/;
const HAS_BREAK = /break;/;
const BLOCKED_LOG = /audit\.briefing\.firecrawl_blocked/;
const BLOCKED_LOG_CALL =
  /audit\.briefing\.firecrawl_blocked[\s\S]{0,400}?\}\);/;
const HAS_HINT = /hint/;

describe("Firecrawl 실패 분류 — 크레딧 소진을 「미노출」로 오해하지 않는다", () => {
  // ── 가드 ①: 402 를 단독 조준 ──────────────────────────────────
  it("🔴 402(크레딧 소진)를 전용 분기로 판정한다", () => {
    // 계약: 402 라는 코드가 credits 접두어와 **같은 분기 안에서** 이어져야 한다.
    // (단순히 "402 라는 글자가 어딘가 있다"는 존재 검사가 되지 않도록 범위를 묶는다)
    const branch = adapterCode.match(BRANCH_402);
    expect(branch, "402 전용 분기가 없다").not.toBeNull();
    expect(branch?.[0]).toMatch(PREFIX_CREDITS);
  });

  // ── 가드 ②: 401 을 단독 조준 ──────────────────────────────────
  it("401/403(키 무효)은 크레딧이 아니라 인증 실패로 판정한다", () => {
    const branch = adapterCode.match(BRANCH_401);
    expect(branch, "401 분기가 없다").not.toBeNull();
    expect(branch?.[0]).toMatch(PREFIX_AUTH);
    // 🔴 크레딧과 뒤섞이면 안 된다 — 조치 방법이 다르다(충전 vs 키 재설정)
    expect(branch?.[0]).not.toMatch(PREFIX_CREDITS);
  });

  // ── 가드 ③: 429 를 단독 조준 ──────────────────────────────────
  it("429(속도 제한)는 재시도로 풀리므로 치명 분류에서 제외한다", () => {
    const branch = adapterCode.match(BRANCH_429);
    expect(branch, "429 분기가 없다").not.toBeNull();
    expect(branch?.[0]).toMatch(PREFIX_RATE_LIMIT);
  });

  // ── 가드 ④: 세 접두어가 서로 달라야 한다 ─────────────────────
  it("세 실패 사유의 접두어가 서로 구별된다", () => {
    // 접두어가 같은 값으로 퇴화하면 분류가 무의미해진다(뮤테이션 조준점).
    // ⚠️ N-45: 정의가 `briefing-failure.ts` 로 **분리**됐다(화면이 어댑터를 통째로
    //   끌어오지 않도록). 어댑터는 이제 재수출만 한다 → 정의 파일에서 읽는다.
    //   ⭐ 이 가드가 그 이동을 **실제로 감지해 실패**했다 — 의도대로 물었다.
    const failConstCode = stripToCode(readFileSync(FAIL_CONST, "utf8"));
    const prefixes = [...failConstCode.matchAll(PREFIX_LITERALS)].map(
      (m) => m[1]
    );
    const unique = new Set(prefixes);
    expect(
      unique.size,
      `접두어가 중복됐다: ${prefixes.join(", ")}`
    ).toBeGreaterThanOrEqual(3);
  });

  // ── 가드 ⑤: 러너가 크레딧 소진 시 재시도를 멈춘다 ─────────────
  it("🔴 크레딧 소진·인증 실패면 후보 질의 재시도를 중단한다", () => {
    // 계약 ①: 「재시도 불가」 판정이 credits·auth **둘 다**를 본다.
    //   ⚠️ 판정이 함수로 빠져도 무너지지 않게, 위치가 아니라 **계약**을 검사한다
    //     (N-39 리팩터로 인라인 → `isUnrecoverableBriefingFailure` 로 이동했다).
    const decider = runnerCode.match(DECIDER_FN);
    expect(decider, "재시도 불가 판정 함수를 못 찾았다").not.toBeNull();
    expect(decider?.[0]).toMatch(PREFIX_CREDITS);
    expect(decider?.[0]).toMatch(PREFIX_AUTH);

    // 계약 ②: 그 판정이 **재시도 루프 안에서 실제로 break 를 부른다.**
    //   판정만 있고 안 쓰면 크레딧을 그대로 태운다 — 여기가 진짜 조준점이다.
    const loop = runnerCode.match(RETRY_LOOP);
    expect(loop, "후보 재시도 루프를 못 찾았다").not.toBeNull();
    const body = loop?.[0] ?? "";
    expect(body).toMatch(CALLS_DECIDER);
    expect(body).toMatch(HAS_BREAK);
  });

  // ── 가드 ⑥: 조치 방법을 로그에 남긴다 ────────────────────────
  it("차단 로그가 원인과 조치를 함께 남긴다", () => {
    expect(runnerCode).toMatch(BLOCKED_LOG);
    // 🔴 로그 이벤트 이름만 있고 hint 가 없으면 운영자가 뭘 해야 할지 모른다
    const logCall = runnerCode.match(BLOCKED_LOG_CALL);
    expect(logCall?.[0]).toMatch(HAS_HINT);
  });

  // ── 가드 ⑦: 429·500 은 치명이 아니다(과잉 차단 방지) ──────────
  it("⚠️ 속도제한·서버오류는 재시도 중단 대상이 아니다", () => {
    const decider = runnerCode.match(DECIDER_FN);
    // rateLimit 을 「재시도 불가」에 넣으면 잠시 뒤 풀릴 장애로 측정을 통째로 포기한다.
    expect(
      decider?.[0],
      "429(rateLimit)를 치명으로 분류하면 일시 장애에 과잉 반응한다"
    ).not.toMatch(PREFIX_RATE_LIMIT);
  });
});

/**
 * 🔴 **분류가 화면까지 닿는가**(N-45).
 *
 * N-39 는 402/401/429 를 **로그에서** 갈랐다. 그런데 화면은 여전히
 * `errorMessage` 가 있으면 무조건 *"아직 네이버 AI 브리핑에 안 나와요"* 라고 했다.
 * → 크레딧이 말라 **못 잰 것**을 「네이버가 우리를 안 말한다」로 보여줬다.
 *   고객은 그 말을 믿고 GEO 개선에 돈을 쓴다 = **틀린 근거로 의사결정을 시킨다.**
 *   📕 이 저장소 최다 사고 유형(apple.com 오판 · N-36 · N-31)과 같은 계열.
 *
 * ⚠️ 문구를 하드코딩해 검사하지 않는다(가드가 버그의 호위병이 된다).
 *   **「사유에 따라 갈리는가」라는 계약**만 검사한다.
 */
describe("🔴 실패 사유가 화면까지 닿는다 (못 잰 것 ≠ 미노출)", () => {
  const web = stripToCode(readFileSync(WEB_RESULT, "utf8"));

  it("① 미노출 카드가 **사유를 보고 갈린다**", () => {
    const at = web.indexOf("function BriefingNotSurfaced");
    expect(
      at,
      "BriefingNotSurfaced 가 없다 — 분기 자체가 사라졌다"
    ).toBeGreaterThan(-1);
    // ⚠️ `\n}` 로 자르면 **매개변수 타입 블록**의 닫는 괄호에 먼저 걸려 54자만 잡힌다
    //   (첫 작성에서 실제로 그랬다). → **다음 함수 선언**까지를 본문으로 본다.
    const body = web.slice(at, web.indexOf("\nfunction ", at + 10));
    // 크레딧·인증은 「못 쟀다」쪽으로 갈라져야 한다.
    expect(body).toContain("BRIEFING_FAIL_PREFIX.credits");
    expect(body).toContain("BRIEFING_FAIL_PREFIX.auth");
    // 속도제한도 「못 쟀다」다(일시적이라 문구만 다르다).
    expect(body).toContain("BRIEFING_FAIL_PREFIX.rateLimit");
  });

  it("② 완료 카드가 그 컴포넌트를 **실제로 쓴다** (만들고 안 쓰면 소용없다)", () => {
    const at = web.indexOf("function NaverBriefingCompletedCard");
    const body = web.slice(at, web.indexOf("\nfunction ", at + 10));
    expect(body).toContain("<BriefingNotSurfaced");
    // errorMessage 를 넘겨야 갈린다 — 안 넘기면 항상 「미노출」로 돌아간다.
    expect(body).toMatch(/errorMessage=\{briefing\?\.errorMessage/);
  });

  it("③ 화면이 **어댑터를 통째로 끌어오지 않는다** (클라이언트 번들 보호)", () => {
    // 🔴 `"use client"` 파일이 어댑터를 import 하면 fetch·파싱 875줄이 브라우저로 간다.
    //   📕 N-43·N-44 에서 같은 유형으로 Storybook 이 통째로 죽었다.
    expect(web).not.toContain("engines/naver-briefing-adapter");
    expect(web).toContain("engines/briefing-failure");
  });

  it("④ 사유 태그는 **한 곳에만** 정의된다 (두 벌이면 화면과 러너가 갈린다)", () => {
    const constFile = stripToCode(readFileSync(FAIL_CONST, "utf8"));
    expect(constFile).toContain("export const BRIEFING_FAIL_PREFIX");
    // 어댑터는 재수출만 한다 — 자기 정의를 다시 들면 값이 갈릴 수 있다.
    const adapter = adapterCode;
    expect(adapter).not.toMatch(/export const BRIEFING_FAIL_PREFIX\s*=\s*\{/);
  });
});
