import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = existsSync(join(process.cwd(), "apps/web"))
  ? process.cwd()
  : join(process.cwd(), "../..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("public search identity contract", () => {
  it("lets unauthenticated readers reach the public AI fact sheet", () => {
    const proxy = read("apps/web/proxy.ts");
    expect(proxy).toContain('new Set(["/ai-instructions"])');
    expect(proxy).toContain("LOCALE_NEUTRAL_PATHS.has(pathname);");
  });

  it("uses the approved home description and links verified public profiles", () => {
    const home = read("apps/web/app/[locale]/(home)/page.tsx");
    const dictionary = JSON.parse(
      read("packages/internationalization/dictionaries/ko.json")
    );
    expect(dictionary.web.home.meta.description).toContain(
      "브랜드별 AI 검색 전략 컨설팅까지 제공합니다"
    );
    expect(home).toContain("description: dictionary.web.home.meta.description");
    expect(home).toContain("https://www.linkedin.com/company/findableglobal/");
    expect(home).toContain("https://medium.com/@findableglobal");
    expect(home).toContain('logo: `${siteOrigin}/apple-icon.png`');
  });

  it("advertises only a sitemap with actual URLs when no news was published", () => {
    const robots = read("apps/web/app/robots.ts");
    expect(robots).toContain('sitemap: `${publicOrigin}/sitemap.xml`');
    expect(robots).not.toContain('`${publicOrigin}/news-sitemap.xml`');
  });

  it("keeps test and customer publishers out of Findable's official hub", () => {
    expect(read("apps/web/app/[locale]/insights/page.tsx")).toContain(
      'listPublishedContent(locale, "findable", {'
    );
    expect(read("apps/web/app/rss.xml/route.ts")).toContain(
      'post.publisher.slug === "findable"'
    );
    const llms = read("apps/web/app/llms.txt/route.ts");
    expect(llms).toContain('post.publisher.slug === "findable"');
    expect(llms).toContain("${origin}/ai-instructions");
    expect(read("apps/web/app/sitemap.ts")).not.toContain(
      'path: "/ai-instructions"'
    );
  });
});
