/**
 * 🔴 **온보딩 문구는 사전을 경유한다**(남은일 1-a · `CLAUDE.md §2` 하드코딩 금지).
 *
 * 배경: N-44 가 온보딩 화면 6개를 만들면서 **한글 74개를 하드코딩**했다 —
 * 부채를 갚으러 왔다가 **더 쌓은** 셈이었다(`lib/i18n.ts` 가 *"새로 쓰는 문자열은
 * 여기를 경유시킨다"* 고 규정한 바로 그 규칙 위반).
 *
 * ⚠️ 이 가드는 **ko/en 키 짝**과 **하드코딩 재발**을 함께 본다.
 *   키만 검사하면 화면이 사전을 안 써도 통과하고, 하드코딩만 검사하면 en 이 비어도 통과한다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "../..");
const dict = (lang: string) =>
  JSON.parse(
    readFileSync(
      join(ROOT, `packages/internationalization/dictionaries/${lang}.json`),
      "utf8"
    )
  ).app.onboarding as Record<string, string>;

/** 실행되는 코드만 남긴다(주석의 한글을 하드코딩으로 오판하지 않도록). */
const codeOf = (rel: string) => {
  const src = readFileSync(join(process.cwd(), rel), "utf8");
  return src
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => {
      const i = l.indexOf("//");
      return i >= 0 && !l.trimStart().startsWith("*") ? l.slice(0, i) : l;
    })
    .join("\n");
};

const SCREENS = [
  // 🆕 N-45: 사이드바 이관(남은일 #2). 모든 화면에 뜨는 내비라 **영어 사용자가 가장
  //   먼저 마주치는** 문구다 — `layout.tsx` 가 이미 사전을 쓰는데 그 옆이 한글이면
  //   한 화면에 두 언어가 섞인다.
  "app/(authenticated)/components/sidebar.tsx",
  "app/(authenticated)/welcome/welcome-flow.tsx",
  "app/(authenticated)/welcome/welcome-intro.tsx",
  "app/(authenticated)/welcome/welcome-shell.tsx",
  "app/(authenticated)/features/brand/brand-profile-editor.tsx",
];

/** JSX 텍스트·문자열 리터럴 안의 한글(주석 제거 후). */
const HARDCODED_KO = /[가-힣]/;

describe("온보딩 i18n — 사전 경유", () => {
  it("ko / en 키가 **짝을 이룬다** (한쪽만 있으면 화면이 뒤섞인다)", () => {
    const ko = Object.keys(dict("ko")).sort();
    const en = Object.keys(dict("en")).sort();
    expect(en).toEqual(ko);
    expect(ko.length).toBeGreaterThan(40);
  });

  it("🆕 `app.sidebar` 도 ko/en 짝이 맞고 값이 비지 않았다", () => {
    const ns = (lang: string) =>
      JSON.parse(
        readFileSync(
          join(ROOT, `packages/internationalization/dictionaries/${lang}.json`),
          "utf8"
        )
      ).app.sidebar as Record<string, string>;
    const ko = ns("ko");
    const en = ns("en");
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
    // 사이드바는 **모든 화면**에 뜬다 — 한 키만 비어도 메뉴에 빈칸이 생긴다.
    for (const [lang, d] of [
      ["ko", ko],
      ["en", en],
    ] as const) {
      for (const [key, value] of Object.entries(d)) {
        expect(
          value.length,
          `${lang}.sidebar.${key} 가 비었다`
        ).toBeGreaterThan(0);
      }
    }
  });

  it("사전 값이 **비어 있지 않다** (빈 문자열이면 화면에 공백만 남는다)", () => {
    for (const lang of ["ko", "en"]) {
      for (const [key, value] of Object.entries(dict(lang))) {
        expect(value.length, `${lang}.${key} 가 비었다`).toBeGreaterThan(0);
      }
    }
  });

  it("⛔ 온보딩 화면에 **한글 하드코딩이 없다**", () => {
    for (const screen of SCREENS) {
      const code = codeOf(screen);
      const lines = code
        .split("\n")
        .filter((l) => HARDCODED_KO.test(l))
        .map((l) => l.trim());
      expect(lines, `${screen} 에 하드코딩 ${lines.length}건`).toEqual([]);
    }
  });
});

/**
 * 🔴 **i18n 이관 범위 정책**(N-45) — 「남은 일」의 크기를 **사실대로** 유지한다.
 *
 * 실측(2026-08-19 · 주석 제외 UI 문구만): **52파일 · 538문구**.
 * 그런데 그중 **156문구(29%)가 `/admin` 운영자 전용 화면**이다 —
 * 👤 대표 1인만 보는 화면이라 **번역할 이유가 없다**.
 * (문서에 적혀 있던 *"74개 중 64개"* 는 낡은 수였다.)
 *
 * ⭐ 이 가드가 지키는 것: `/admin` 이 이관 대상 목록에 **들어오지 않는다**.
 *   들어오는 순간 「운영자 화면 번역」이라는 무의미한 일이 남은 일로 승격되고,
 *   부채 규모가 실제보다 29% 부풀어 보인다.
 */
describe("i18n 이관 범위 — /admin 은 대상이 아니다", () => {
  it("⛔ 이관 대상 목록(SCREENS)에 `/admin` 화면을 넣지 않는다", () => {
    const admin = SCREENS.filter((s) =>
      s.startsWith("app/(authenticated)/admin/")
    );
    expect(
      admin,
      `운영자 전용 화면은 번역 대상이 아니다: ${admin.join(", ")}`
    ).toEqual([]);
  });
});
