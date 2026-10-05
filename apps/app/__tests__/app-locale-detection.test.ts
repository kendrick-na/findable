import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickLocaleFromAcceptLanguage } from "@/lib/accept-language";

/**
 * 로케일 결정 순서(`docs/_적용/영어화면_범위_20261006.md` 3장):
 *   쿠키 → (영어 공개 시) 브라우저 언어 → ko. IP 국가는 쓰지 않는다.
 */

const cookieJar = vi.hoisted(() => new Map<string, string>());
const acceptLanguage = vi.hoisted(() => ({ current: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  })),
  headers: vi.fn(
    async () =>
      new Headers(
        acceptLanguage.current === null
          ? {}
          : { "accept-language": acceptLanguage.current }
      )
  ),
}));

describe("pickLocaleFromAcceptLanguage", () => {
  it.each([
    ["en-US,en;q=0.9,ko;q=0.8", "en"],
    ["ko-KR,ko;q=0.9,en-US;q=0.8", "ko"],
    ["ko;q=0.5,en;q=0.9", "en"],
    ["ja,zh-CN;q=0.9", null],
    ["fr,en;q=0", null],
    ["", null],
  ])("%s → %s", (header, expected) => {
    expect(pickLocaleFromAcceptLanguage(header)).toBe(expected);
  });

  it("returns null when the header is missing", () => {
    expect(pickLocaleFromAcceptLanguage(null)).toBeNull();
  });
});

describe("getAppLocale", () => {
  beforeEach(() => {
    cookieJar.clear();
    acceptLanguage.current = null;
  });

  it("uses the toggle cookie first", async () => {
    const { getAppLocale } = await import("@/lib/i18n");
    cookieJar.set("NEXT_LOCALE", "en");
    acceptLanguage.current = "ko-KR";
    expect(await getAppLocale()).toBe("en");
  });

  it("stays Korean for an English browser while English is not yet open", async () => {
    const { APP_ENGLISH_ENABLED, getAppLocale } = await import("@/lib/i18n");
    expect(APP_ENGLISH_ENABLED).toBe(false);
    acceptLanguage.current = "en-US,en;q=0.9";
    expect(await getAppLocale()).toBe("ko");
  });

  it("ignores the marketing site's Next-Locale cookie (IP-based)", async () => {
    const { getAppLocale } = await import("@/lib/i18n");
    cookieJar.set("Next-Locale", "en");
    expect(await getAppLocale()).toBe("ko");
  });
});
