import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "app/[locale]");
const pages = [
  "glossary/page.tsx",
  "glossary/[slug]/page.tsx",
  "case/a-brand/page.tsx",
  "report/k-beauty-geo-2026q2/page.tsx",
  "research/k-geo-bench-v0_1/page.tsx",
];

describe("English editorial page localization", () => {
  it.each(pages)("%s has locale-specific English copy", (page) => {
    const source = readFileSync(join(ROOT, page), "utf8");
    expect(source).toContain('locale.startsWith("ko")');
    expect(source).toMatch(/EN_(?:TERMS|FINDINGS|INSIGHTS|BRAND_SUMMARY)/);
    expect(source).not.toMatch(/href="\/ko\//);
  });

  it.each([
    "report/k-beauty-geo-2026q2/page.tsx",
    "research/k-geo-bench-v0_1/page.tsx",
  ])("%s marks structured data with the actual page language", (page) => {
    const source = readFileSync(join(ROOT, page), "utf8");
    expect(source).toContain('inLanguage: ko ? "ko" : "en"');
  });
});
