import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = existsSync(join(process.cwd(), "apps/web"))
  ? process.cwd()
  : join(process.cwd(), "../..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("public landing navigation contract", () => {
  const hero = read("apps/web/app/[locale]/(home)/components/hero.tsx");
  const landingHeader = read(
    "apps/web/app/[locale]/components/public-landing-header.tsx"
  );
  const glossary = read("apps/web/app/[locale]/glossary/page.tsx");
  const glossaryTerm = read("apps/web/app/[locale]/glossary/[slug]/page.tsx");
  const insights = read("apps/web/app/[locale]/insights/page.tsx");
  const report = read(
    "apps/web/app/[locale]/report/k-beauty-geo-2026q2/page.tsx"
  );
  const research = read(
    "apps/web/app/[locale]/research/k-geo-bench-v0_1/page.tsx"
  );
  const caseStudy = read("apps/web/app/[locale]/case/a-brand/page.tsx");
  const publisher = read("apps/web/app/[locale]/p/[publisherSlug]/page.tsx");
  const post = read(
    "apps/web/app/[locale]/p/[publisherSlug]/[postSlug]/page.tsx"
  );
  const pricing = read("apps/web/app/[locale]/pricing/page.tsx");
  const contact = read("apps/web/app/[locale]/contact/page.tsx");
  const audit = read("apps/web/app/[locale]/audit/page.tsx");
  const layout = read("apps/web/app/[locale]/layout.tsx");

  it("keeps every landing knowledge link backed by a public route", () => {
    expect(hero).toContain("<PublicLandingHeader locale={locale} />");
    expect(landingHeader).toContain("href: `\${lp}/glossary`");
    expect(landingHeader).toContain("href: `\${lp}/insights`");
    expect(landingHeader).toContain("href={insightMenu.href}");
    expect(landingHeader).toContain(
      'faq: { label: "FAQ", href: `${lp}/#faq` }'
    );
    expect(
      existsSync(join(root, "apps/web/app/[locale]/glossary/page.tsx"))
    ).toBe(true);
    expect(
      existsSync(join(root, "apps/web/app/[locale]/insights/page.tsx"))
    ).toBe(true);
    expect(read("apps/web/app/[locale]/(home)/components/faq.tsx")).toContain(
      'id="faq"'
    );
    expect(layout).not.toContain('"scroll-smooth"');
  });

  it("uses the same public shell for every Findable-owned knowledge page", () => {
    for (const page of [
      glossary,
      glossaryTerm,
      insights,
      report,
      research,
      caseStudy,
      publisher,
      post,
      pricing,
      contact,
    ]) {
      expect(page).toContain("PublicLandingHeader");
      expect(page).toContain("<PublicLandingHeader locale={locale} />");
      expect(page).toContain("<FooterCTA locale={locale} />");
    }
    expect(landingHeader).toContain('aria-label={isKo ? "주요 메뉴"');
    expect(read("apps/web/app/[locale]/components/footer.tsx")).toContain(
      'id="site-footer"'
    );
    expect(layout).toContain("<Footer locale={locale} />");
    expect(audit).toContain("<PublicLandingHeader locale={locale} />");
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
