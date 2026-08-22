/**
 * 🅰️ **무료 진단은 동선에서 뺐다**(2026-08-19 · 👤 결정 A) — 그런데 **페이지는 지우지 않는다**.
 *
 * 배경(실측): 랜딩 CTA 는 전부 `/sign-up` 으로 가는데 버튼 문구는 *"무료로 진단받기"* 였다.
 * **문구가 거짓말**이었다 — 누르면 진단 폼이 아니라 가입 화면이 열린다.
 * 게다가 `robots.ts` 는 `/audit` 를 *"리드 유입의 핵심 랜딩"* 으로 대우하고 있었다.
 *
 * 👤 결정: **접되 삭제하지 않는다.**
 *   · 문구는 실제 동작에 맞춘다(가입 = 무료로 시작하기)
 *   · `/audit` 페이지·결과 링크는 **그대로 둔다** — 이미 배포된 `/audit/<jobId>` 가 있고
 *     404 를 만들면 기존 사용자의 결과가 사라진다
 *
 * ⚠️ 이 가드는 `apps/web` 소스를 **파일로 읽는다** — 그 워크스페이스에는 테스트 러너가 없다.
 *   📕 「엔진 분모 불변」 가드가 `packages/audit/runner.ts` 를 읽는 것과 같은 방식.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(process.cwd(), "../web");
const read = (rel: string) => readFileSync(join(WEB, rel), "utf8");

/**
 * 🔴🔴 **2026-08-19(N-47) — 이 가드가 실제로 샜다. 파일 목록을 버리고 web 전체를 훑는다.**
 *
 * 예전엔 랜딩 3파일만 하드코딩해 봤다(`footer-cta`·`rent-vs-equity`·`showcase`).
 * 그래서 **블로그 페이지**의 CTA 가 그대로 살아남아 **라이브에서 클릭 가능**했다:
 *   `blog/page.tsx` — *"무료 진단부터 시작하기"* → `href={`${lp}/audit`}`
 *
 * ⚠️ 📕 N-45 는 *"가드는 「어디서 찾는지」도 좁혀야 한다"* 를 배웠는데, 여기선 **반대**로
 *   너무 좁혀서 샜다. 교훈은 **「좁게」가 아니라 「맞게」** 다:
 *     · 한 함수 안의 계약을 볼 땐 → **좁힌다**(다른 분기·주석이 통과시키니까)
 *     · **어디에도 있으면 안 되는 문구**를 볼 땐 → **전부 훑는다**(빠뜨리면 그게 구멍)
 *   ⭐ 새 페이지가 생겨도 자동으로 검사 대상이 된다 — 그게 목록 방식과의 차이다.
 */
/**
 * ⚠️ **`[locale]` 을 glob 에 그대로 넣지 말 것** — 대괄호는 glob 에서 **문자 클래스**다
 *   (`[locale]` = l·o·c·a·e 중 한 글자). 실측: 그대로 넣으면 **0개**를 훑고 조용히 통과했다.
 *   → `app/**` 로 훑는다. 어차피 화면은 전부 그 아래다(실측 41개).
 */
const CTA_DIR = "app";

/** 버튼이 「진단받기」라고 말하는데 목적지가 가입이면 거짓말이다. */
const CLAIMS_AUDIT =
  /무료로 진단받기|무료 진단부터|Get a free audit|Start with a free audit/;

/** 주석은 세지 않는다 — 「왜 뺐는지」 적은 자리가 가드를 물면 안 된다(📕 자기 주석 세는 사고). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** `apps/web` 의 화면 소스를 전부 모은다(빌드 산출물·의존성 제외). */
function allScreenSources(): string[] {
  const { globSync } = require("node:fs") as typeof import("node:fs");
  return globSync(join(WEB, CTA_DIR, "**/*.tsx"), {
    exclude: (p: string) => p.includes("node_modules") || p.includes(".next"),
  }) as string[];
}

describe("무료 진단 접기 — 문구가 실제 동작과 맞는가", () => {
  it("⛔ **요금제 표를 뺀 어느 화면도** 접은 기능(무료 진단)을 광고하지 않는다", () => {
    // 🔴 **판정 기준을 「목적지」로 잡았다가 틀렸다**(N-47 · 자기 가드를 뮤테이션해서 발견).
    //   원래 버그였던 블로그 CTA 는 *"무료 진단부터 시작하기"* → `${lp}/audit` 였다.
    //   목적지가 `/audit` 이라 「문구와 목적지가 맞나」 검사는 **통과시켜 버린다**.
    //   ⚠️ 즉 그 화면은 **정직하게 접은 기능으로 보내고 있었다** — 문제는 거짓말이 아니라
    //     **접기로 한 동선을 계속 노출**한 것이다. 👤 결정 A 는 *"동선에서 뺀다"* 였다.
    //   ⭐ 교훈: 가드를 짤 땐 **원래 버그를 되살려 무는지** 반드시 확인한다(안 물었다).
    //
    // ✅ **단 하나의 예외 = 요금제 표**: `Free Audit` 는 실재하는 **상품 등급**이라
    //   그 자리에서 설명·판매되는 게 맞다. 게다가 요금제는 **카카오페이 심사 항목**이라
    //   승인 전까지 손대지 않는다(📕 심사 동결 · 블로그·랜딩은 심사 항목 아님).
    const PRICING = "pricing/page.tsx";
    const offenders = allScreenSources()
      .filter((file) => !file.endsWith(PRICING))
      .filter((file) =>
        CLAIMS_AUDIT.test(stripComments(readFileSync(file, "utf8")))
      );
    expect(
      offenders.map((f) => f.replace(WEB, "apps/web")),
      "접은 기능(무료 진단)을 광고하는 화면이 있다"
    ).toEqual([]);
  });

  it("⛔ 훑는 대상이 **비어 있지 않다** (glob 이 깨지면 가드가 조용히 통과한다)", () => {
    // 🔴 전수 훑기 가드의 고질병: 경로가 틀리면 `[]` 을 훑고 **항상 통과**한다.
    //   실제 파일이 잡히는지 먼저 못박는다(N-47 에 web 화면은 13개 이상).
    expect(allScreenSources().length).toBeGreaterThan(5);
  });

  it("✅ `/audit` 페이지는 **지우지 않는다** (👤 지시 · 배포된 결과 링크 보호)", () => {
    // 페이지가 사라지면 이미 나간 `/audit/<jobId>` 결과가 전부 404 가 된다.
    expect(() => read("app/[locale]/audit/page.tsx")).not.toThrow();
    expect(() => read("app/[locale]/audit/[jobId]/page.tsx")).not.toThrow();
  });

  it("✅ 남의 진단 결과는 여전히 색인에서 막는다", () => {
    const robots = read("app/robots.ts");
    expect(robots).toContain('"/audit/*"');
    expect(robots).toContain('"/ko/audit/*"');
  });
});
