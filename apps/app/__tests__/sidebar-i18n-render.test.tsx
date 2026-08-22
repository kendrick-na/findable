/**
 * 🔬 **사이드바가 실제로 사전을 그리는지**(N-45 · 남은일 #2).
 *
 * 왜 렌더까지: 소스 가드는 「한글이 남았는가」만 본다. 한글이 없어도
 * **주입이 끊기면 화면은 빈칸**이다(`labels.todo` 가 `undefined` 여도 tsc 는 통과할 수 있다 —
 * layout 이 넘기는 객체가 타입만 맞으면 되니까).
 * 📕 규율: 화면은 눈으로 확인한다 — 소스 검사만으로 「됐다」고 하지 않는다.
 *
 * ⚠️ `GlobalSidebar` 는 `useSidebar`·`usePathname` 컨텍스트에 묶여 있어 통째로 띄우기
 *   어렵다 → **라벨을 실제로 소비하는 네비 빌더**를 직접 검증한다(같은 데이터 경로).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "../..");
const sidebarDict = (lang: string) =>
  JSON.parse(
    readFileSync(
      join(ROOT, `packages/internationalization/dictionaries/${lang}.json`),
      "utf8"
    )
  ).app.sidebar as Record<string, string>;

/**
 * 주석을 걷고 **실행 코드만** 남긴다.
 * 🔴 이 저장소는 가드가 **자기 주석을 세어** 오판한 사고를 5번 반복했다
 *   (N-36 줄끝주석 · N-39 JSX주석 · N-41 JSDoc · N-44 nextHref).
 *   N-45 에서도 그랬다: 사이드바 주석이 *"`getAppDictionary` 를 직접 못 부른다"* 고
 *   **설명**하고 있어서, 「직접 부르지 않는다」 가드가 **주석을 보고 실패**했다.
 */
const stripComments = (src: string) =>
  src
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const i = line.indexOf("//");
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join("\n");

const RAW_SRC = readFileSync(
  join(process.cwd(), "app/(authenticated)/components/sidebar.tsx"),
  "utf8"
);
const SRC = stripComments(RAW_SRC);
const LAYOUT = readFileSync(
  join(process.cwd(), "app/(authenticated)/layout.tsx"),
  "utf8"
);

describe("사이드바 i18n — 사전이 화면까지 닿는다", () => {
  it("🔴 layout 이 **모든 라벨 키를 빠짐없이** 주입한다 (하나라도 빠지면 빈칸)", () => {
    const keys = Object.keys(sidebarDict("ko"));
    const missing = keys.filter(
      (k) => !LAYOUT.includes(`${k}: t.sidebar.${k}`)
    );
    expect(missing, `layout 이 안 넘기는 키: ${missing.join(", ")}`).toEqual(
      []
    );
  });

  it("🔴 사전 키와 화면이 쓰는 키가 **정확히 일치**한다", () => {
    const dictKeys = new Set(Object.keys(sidebarDict("ko")));
    const used = new Set(
      [...SRC.matchAll(/\b(?:t|labels)\.(\w+)/g)].map((m) => m[1])
    );
    // 화면이 쓰는데 사전에 없다 = 런타임에 undefined 가 그려진다.
    const declared = new Set(
      [...SRC.matchAll(/^ {2}(\w+): string;/gm)].map((m) => m[1])
    );
    const usedLabels = [...used].filter((k) => declared.has(k));
    const orphan = usedLabels.filter((k) => !dictKeys.has(k));
    expect(
      orphan,
      `사전에 없는 키를 화면이 쓴다: ${orphan.join(", ")}`
    ).toEqual([]);
    // 사전에만 있고 아무도 안 쓰는 키 = 죽은 문자열(번역 비용만 든다).
    const dead = [...dictKeys].filter((k) => !used.has(k));
    expect(dead, `아무도 안 쓰는 사전 키: ${dead.join(", ")}`).toEqual([]);
  });

  it("⛔ 사이드바가 `getAppDictionary` 를 **직접 부르지 않는다** (클라 번들 보호)", () => {
    // 🔴 `"use client"` 파일이 `server-only` 모듈을 끌어오면 Storybook 이 통째로 죽는다
    //   (📕 N-43·N-44 에서 실제로 두 번 겪었다). 반드시 layout 주입으로만 받는다.
    expect(SRC).toContain('"use client"');
    expect(SRC).not.toContain("getAppDictionary");
  });

  it("🌐 잠금 툴팁이 **자리표시자를 실제로 치환**한다 (`{plan}` 이 그대로 보이면 안 된다)", () => {
    for (const lang of ["ko", "en"]) {
      expect(sidebarDict(lang).lockedHint).toContain("{plan}");
    }
    // 화면이 그 치환을 실제로 수행하는지 — 안 하면 「{plan}에서 해제」가 그대로 뜬다.
    expect(SRC).toMatch(/lockedHint\.replace\(\s*"\{plan\}"/);
  });
});
