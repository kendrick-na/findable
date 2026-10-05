import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "../app/locale/route";

const ROOT = join(import.meta.dirname, "../../..");
const ROUTE = readFileSync(join(ROOT, "apps/app/app/locale/route.ts"), "utf8");
const SWITCHER = readFileSync(
  join(ROOT, "apps/app/app/(authenticated)/components/locale-switcher.tsx"),
  "utf8"
);

describe("dashboard locale switching", () => {
  it("persists only supported locales in a host-local cookie", () => {
    expect(ROUTE).toContain('new Set(["ko", "en"])');
    expect(ROUTE).toContain('response.cookies.set("NEXT_LOCALE", locale');
    expect(ROUTE).toContain('next.startsWith("//")');
    expect(ROUTE).toContain("target.origin === origin");
  });

  it("keeps the current dashboard path and brand query when switching language", () => {
    expect(SWITCHER).toContain("usePathname");
    expect(SWITCHER).toContain("useSearchParams");
    expect(SWITCHER).toContain("searchParams.toString()");
    expect(SWITCHER).toContain("`${pathname}?${query}`");
    expect(SWITCHER).toContain("locale=ko");
    expect(SWITCHER).toContain("locale=en");
  });
});

const ORIGIN = "https://app.findable.co.kr";

// rawNext 는 공격자가 주소창에 그대로 붙이는 쿼리 값이다(이미 인코딩된 형태).
function redirectFor(rawNext: string, locale = "en"): string | null {
  const url = `${ORIGIN}/locale?locale=${locale}&next=${rawNext}`;
  return GET(new Request(url)).headers.get("location");
}

describe("locale switch redirect stays on our own origin", () => {
  it.each([
    "/\\evil.example",
    "/\\\\evil.example",
    "/%5Cevil.example",
    "/%5cevil.example",
    "/%5C%5Cevil.example",
    "https://evil.example",
    "https%3A%2F%2Fevil.example",
    "//evil.example",
    "%2F%2Fevil.example",
    "/%09/evil.example",
    "/%0A/evil.example",
    "/%00evil.example",
    "javascript:alert(1)",
    "",
  ])("falls back to / for %j", (rawNext) => {
    expect(redirectFor(rawNext)).toBe(`${ORIGIN}/`);
  });

  it("falls back to / when next is missing", () => {
    const location = GET(new Request(`${ORIGIN}/locale?locale=ko`)).headers.get(
      "location"
    );
    expect(location).toBe(`${ORIGIN}/`);
  });

  it("keeps a normal dashboard path and query", () => {
    expect(redirectFor(encodeURIComponent("/dashboard?brand=abc"))).toBe(
      `${ORIGIN}/dashboard?brand=abc`
    );
  });

  it("still redirects safely for an unsupported locale", () => {
    expect(redirectFor("/%5Cevil.example", "xx")).toBe(`${ORIGIN}/`);
  });
});
