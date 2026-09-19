import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
    expect(ROUTE).toContain('!next.startsWith("//")');
  });

  it("keeps the current dashboard path when switching language", () => {
    expect(SWITCHER).toContain("usePathname");
    expect(SWITCHER).toContain("locale=ko");
    expect(SWITCHER).toContain("locale=en");
  });
});
