import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_LOCALE_SWITCHER_VISIBLE } from "@/lib/i18n";

/**
 * 🔴 KO/EN 토글은 핵심 화면 영어화 전까지 숨긴다
 *   (`docs/_적용/영어화면_범위_20261006.md` 5장). 반쯤 영어인 화면 = 고장처럼 보임.
 *   ⚠️ 영어화가 끝나 토글을 다시 켤 때는 이 테스트의 기대값도 함께 바꾼다.
 */
const HEADER = readFileSync(
  join(import.meta.dirname, "../app/(authenticated)/components/header.tsx"),
  "utf8"
);

describe("dashboard locale switcher visibility", () => {
  it("renders the switcher only behind the visibility flag", () => {
    expect(HEADER).toContain(
      "{APP_LOCALE_SWITCHER_VISIBLE && <LocaleSwitcher />}"
    );
  });

  it("keeps the switcher hidden until core screens are translated", () => {
    expect(APP_LOCALE_SWITCHER_VISIBLE).toBe(false);
  });
});
