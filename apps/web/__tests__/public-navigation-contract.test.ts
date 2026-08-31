import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("public landing navigation contract", () => {
  const hero = read("apps/web/app/[locale]/(home)/components/hero.tsx");
  const insights = read("apps/web/app/[locale]/insights/page.tsx");

  it("keeps every landing knowledge link backed by a public route", () => {
    expect(hero).toContain('href: `${lp}/glossary`');
    expect(hero).toContain('href: `${lp}/insights`');
    expect(
      existsSync(join(root, "apps/web/app/[locale]/glossary/page.tsx"))
    ).toBe(true);
    expect(
      existsSync(join(root, "apps/web/app/[locale]/insights/page.tsx"))
    ).toBe(true);
  });

  it("ships a visual cover for every insight card", () => {
    expect(insights).toContain("FALLBACK_COVERS");
    for (const asset of [
      "ai-search-citation-diagnostic.webp",
      "geo-seo-vs-geo-map.webp",
      "naver-ai-briefing-ecosystem.webp",
      "ai-search-citation-conditions.webp",
    ]) {
      expect(
        existsSync(join(root, "apps/web/public/images/insights", asset))
      ).toBe(true);
    }
  });
});
