/**
 * 🔴 **왜 이 테스트가 있나** (세션N-39 · v4 P0-3)
 *
 * `apps/app` 은 i18n 이 **아예 없었다**: `@repo/internationalization` import 0건 ·
 * dictionary 최상위 키 `["web"]` 뿐 · `.tsx` **74개 중 64개(86%)에 한글 하드코딩**.
 * `CLAUDE.md §2` 가 *"다국어 문자열은 dictionary 사용(하드코딩 금지)"* 를 규정하는데
 * 앱 전체가 그 규칙 밖에 있었다.
 *
 * 👤 2026-08-17: *"대시보드는 한국어랑 영어를 기본으로."*
 *
 * 📐 이 테스트가 지키는 것은 **"앱이 영어로 돈다"가 아니다**(아직 대부분 하드코딩이다).
 *   지키는 계약은 **뼈대가 살아 있고 두 사전이 어긋나지 않는 것** —
 *   ko 에만 키를 넣으면 영어 사용자에게 **폴백이 섞여 화면이 뒤죽박죽**이 된다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const KO = join(ROOT, "packages/internationalization/dictionaries/ko.json");
const EN = join(ROOT, "packages/internationalization/dictionaries/en.json");
const I18N = join(ROOT, "apps/app/lib/i18n.ts");
const LAYOUT = join(ROOT, "apps/app/app/(authenticated)/layout.tsx");
const TABBAR = join(
  ROOT,
  "apps/app/app/(authenticated)/components/mobile-tab-bar.tsx"
);

type Dict = Record<string, unknown>;
const ko = JSON.parse(readFileSync(KO, "utf8")) as Dict;
const en = JSON.parse(readFileSync(EN, "utf8")) as Dict;
const i18nCode = readFileSync(I18N, "utf8");
const layoutCode = readFileSync(LAYOUT, "utf8");
const tabbarCode = readFileSync(TABBAR, "utf8");

/** 중첩 객체를 `a.b.c` 경로 목록으로 편다. */
const flatten = (obj: unknown, prefix = ""): string[] => {
  if (typeof obj !== "object" || obj === null) {
    return [prefix];
  }
  return Object.entries(obj as Dict).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k)
  );
};

const DEFAULT_KO = /APP_DEFAULT_LOCALE: AppLocale = "ko"/;
const READS_COOKIE = /NEXT_LOCALE/;
const RETURNS_APP_NS = /dictionary\.app/;
const LAYOUT_CALLS = /await getAppDictionary\(\)/;
const TABBAR_TAKES_LABELS = /labels: MobileTabBarLabels/;
const TABBAR_NO_HARDCODED_NAV = /"(한눈에|할 일|이력|더보기)"/;

describe("v4 P0-3 — apps/app 다국어 뼈대", () => {
  // ── 가드 ①: app 네임스페이스가 두 사전에 **둘 다** 있다 ────────
  it("🔴 ko·en 사전에 app 네임스페이스가 있다", () => {
    expect(ko.app, "ko.json 에 app 네임스페이스가 없다").toBeDefined();
    expect(en.app, "en.json 에 app 네임스페이스가 없다").toBeDefined();
  });

  // ── 가드 ②: 두 사전의 키가 **정확히 같다**(진짜 조준점) ─────────
  it("🔴 ko·en 의 app 키가 완전히 일치한다", () => {
    const koKeys = flatten(ko.app).sort();
    const enKeys = flatten(en.app).sort();
    // 한쪽에만 키를 추가하면 폴백이 다른 언어를 섞어 **화면이 뒤죽박죽**이 된다.
    expect(
      enKeys,
      `키가 어긋났다.\n  ko 만: ${koKeys.filter((k) => !enKeys.includes(k)).join(", ") || "(없음)"}\n  en 만: ${enKeys.filter((k) => !koKeys.includes(k)).join(", ") || "(없음)"}`
    ).toEqual(koKeys);
  });

  // ── 가드 ③: 값이 비어 있지 않다 ───────────────────────────────
  it("빈 문자열 키가 없다", () => {
    for (const [lang, d] of [
      ["ko", ko.app],
      ["en", en.app],
    ] as const) {
      const empties = flatten(d).filter((path) => {
        const v = path
          .split(".")
          .reduce<unknown>((acc, k) => (acc as Dict)?.[k], d);
        return typeof v === "string" && v.trim() === "";
      });
      expect(empties, `${lang} 에 빈 값: ${empties.join(", ")}`).toHaveLength(
        0
      );
    }
  });

  // ── 가드 ④: 기본 로케일이 한국어다 ────────────────────────────
  it("🔴 기본 로케일은 한국어다(영어로 떨어지면 화면이 섞인다)", () => {
    // 아직 대부분 하드코딩(한국어)이라 기본을 en 으로 두면
    // **사전에 있는 것만 영어**가 되어 한 화면에 두 언어가 뜬다.
    expect(i18nCode).toMatch(DEFAULT_KO);
    expect(i18nCode, "로케일 출처(NEXT_LOCALE 쿠키)가 없다").toMatch(
      READS_COOKIE
    );
    expect(i18nCode, "app 네임스페이스를 반환하지 않는다").toMatch(
      RETURNS_APP_NS
    );
  });

  // ── 가드 ⑤: 뼈대가 실제로 **연결**돼 있다 ──────────────────────
  it("🔴 사전이 실사용 화면에 실제로 연결돼 있다", () => {
    // 접근자만 만들고 아무도 안 쓰면 **아무것도 안 하는 뼈대**다(가짜 안심).
    expect(layoutCode, "레이아웃이 사전을 읽지 않는다").toMatch(LAYOUT_CALLS);
    expect(tabbarCode, "탭바가 라벨을 주입받지 않는다").toMatch(
      TABBAR_TAKES_LABELS
    );
  });

  // ── 가드 ⑥: 이관한 화면에 하드코딩이 되살아나지 않는다 ──────────
  it("탭바에 하드코딩 한국어 라벨이 되살아나지 않는다", () => {
    expect(
      tabbarCode,
      "탭바에 하드코딩 라벨이 돌아왔다 — 사전을 경유해야 한다(CLAUDE.md §2)"
    ).not.toMatch(TABBAR_NO_HARDCODED_NAV);
  });
});
