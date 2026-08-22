/**
 * 모바일 하단 탭바 — 2026-08-17 세션N-37 (v4 P0-4·P0-5).
 *
 * 🔴 **왜 이 검사가 있나** (전부 실제로 데인 것):
 *   ① v4 P0-5 = *"측정 0건이면 탭바를 렌더하지 않는다"* — 빈 화면에 탭 5개를 얹으면
 *      `page.tsx:167` 의 *"빈 상태에서는 영업을 걷어낸다 … 되살리지 말 것"* 을 어긴다.
 *   ② v4 P0-4 = **탭은 4개(+더보기)** — 한글 라벨은 영문보다 넓어 8개면 2.5개만 보인다.
 *   ③ 하단 바는 `fixed` 라 문서 흐름 밖이다 → **여백이 없으면 마지막 콘텐츠를 가린다.**
 *   ④ 데스크톱엔 사이드바가 있다 → 내비 두 벌이 동시에 뜨면 안 된다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BAR = readFileSync(
  join(process.cwd(), "app/(authenticated)/components/mobile-tab-bar.tsx"),
  "utf8"
);
const SIDEBAR = readFileSync(
  join(process.cwd(), "app/(authenticated)/components/sidebar.tsx"),
  "utf8"
);
const LAYOUT = readFileSync(
  join(process.cwd(), "app/(authenticated)/layout.tsx"),
  "utf8"
);

/** 주석을 걷고 실행되는 코드만 남긴다. */
const stripToCode = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");

const bar = stripToCode(BAR);
const sidebar = stripToCode(SIDEBAR);
const layout = stripToCode(LAYOUT);

describe("v4 P0-5 — 측정 0건이면 탭바를 그리지 않는다", () => {
  it("사이드바가 hasMeasurement 로 탭바를 감싼다", () => {
    // 뮤테이션 확인: 조건을 지우고 항상 렌더하면 깨진다(확인함).
    expect(sidebar).toMatch(/hasMeasurement \? \(\s*<MobileTabBar/);
  });

  it("레이아웃이 실제로 값을 계산해 넘긴다", () => {
    // 🔴 이게 없으면 항상 false 라 탭바가 **영원히 안 보인다**(반대 방향 결함).
    expect(layout).toMatch(/const hasMeasurement = /);
    expect(layout).toMatch(/hasMeasurement=\{hasMeasurement\}/);
  });

  it("세는 코드를 새로 만들지 않는다 — 헤더 지표와 같은 헬퍼", () => {
    // 같은 값을 두 벌로 세면 화면끼리 갈린다(이 저장소가 겪은 실패 유형).
    expect(layout).toMatch(/scopedHeaderMetric/);
  });
});

describe("v4 P0-4 — 탭 4개 + 더보기", () => {
  it("탭이 정확히 4개다", () => {
    const table = bar.slice(bar.indexOf("const TABS"), bar.indexOf("];"));
    // 뮤테이션 확인: 5번째 탭을 추가하면 깨진다(확인함).
    expect(table.match(/url:/g)).toHaveLength(4);
  });

  it("모든 탭에 라벨이 있다 — 아이콘만 있는 탭 금지", () => {
    const table = bar.slice(bar.indexOf("const TABS"), bar.indexOf("];"));
    // 🔄 세션N-39(v4 P0-3 다국어): 라벨이 하드코딩 문자열(`label:`)에서
    //   **사전 키**(`labelKey:`)로 바뀌었다. 검사 의도는 그대로다 —
    //   *"아이콘만 있고 글자가 없는 탭을 만들지 마라."*
    //   ⚠️ 키가 실제 문자열로 풀리는지는 타입이 보증한다
    //     (`labelKey: keyof MobileTabBarLabels` — 오타면 tsc 가 잡는다).
    expect(table.match(/labelKey:/g)).toHaveLength(4);
  });

  it("「더보기」는 새 시트가 아니라 사이드바를 연다", () => {
    // 내비를 두 벌로 만들면 하나를 고칠 때 다른 하나가 낡는다.
    expect(sidebar).toMatch(/setOpenMobile\(true\)/);
  });
});

describe("레이아웃 안전장치", () => {
  it("데스크톱에서는 숨는다 — 사이드바와 겹치지 않게", () => {
    expect(bar).toMatch(/md:hidden/);
  });

  it("하단 콘텐츠를 가리지 않게 여백을 둔다", () => {
    // `fixed` 는 문서 흐름 밖이라 여백이 없으면 마지막 카드를 덮는다.
    expect(sidebar).toMatch(/h-16 md:hidden/);
  });

  it("아이폰 홈 인디케이터를 피한다", () => {
    expect(bar).toMatch(/safe-area-inset-bottom/);
  });

  it("현재 화면을 스크린리더에 알린다", () => {
    expect(bar).toMatch(/aria-current/);
  });

  it("`/` 는 완전일치로 판정한다", () => {
    // 🔴 `startsWith("/")` 면 **모든 경로에서 활성**으로 보인다.
    expect(bar).toMatch(/tab\.url === "\/" \? pathname === "\/"/);
  });
});
