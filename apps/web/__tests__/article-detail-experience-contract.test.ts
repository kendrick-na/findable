import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(WEB_ROOT, path), "utf8");
const articlePage = read("app/[locale]/p/[publisherSlug]/[postSlug]/page.tsx");
const shareActions = read(
  "app/[locale]/p/[publisherSlug]/[postSlug]/share-actions.tsx"
);

describe("public insight article experience", () => {
  it("keeps a visible publisher profile and share controls in the article header", () => {
    expect(articlePage).toContain('src="/icon.svg"');
    expect(articlePage).toContain("post.publisher.logoUrl");
    expect(articlePage).toContain("<ShareActions ko={ko} url={shareUrl} />");
    expect(shareActions).toContain("Facebook에 공유");
    expect(shareActions).toContain("LinkedIn에 공유");
    expect(shareActions).toContain("링크 복사");
  });

  it("keeps cover-image cards in the related-content section", () => {
    expect(articlePage).toContain("related.map((item)");
    expect(articlePage).toContain("item.coverImageUrl ? (");
    expect(articlePage).toContain("grayscale-[0.15]");
  });
});
