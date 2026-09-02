import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("SEO/GEO content platform contract", () => {
  it("persists ownership, revisions, review, quality and publication jobs", () => {
    const schema = read("packages/database/prisma/schema.prisma");
    for (const model of [
      "model Publisher",
      "model Content",
      "model ContentRevision",
      "model ContentReviewEvent",
      "model ContentQualityCheck",
      "model PublicationJob",
    ]) {
      expect(schema).toContain(model);
    }
    expect(schema).toContain("brandId String? @unique");
    expect(schema).toContain("@@unique([publisherId, locale, slug])");
  });

  it("keeps public content server-rendered, sanitized and discoverable", () => {
    const article = read(
      "apps/web/app/[locale]/p/[publisherSlug]/[postSlug]/page.tsx"
    );
    const markdown = read("apps/web/components/content/markdown-article.tsx");
    const sitemap = read("apps/web/app/sitemap.ts");
    // 🔴 **2026-09-02: 이 가드가 `force-dynamic` 을 요구하고 있었다.**
    //   원래 의도는 "크롤러가 JS 없이 완성된 HTML 을 받는다"였는데, 그걸 **매 요청 SSR**
    //   이라는 특정 구현으로 못박아 ISR 로 옮기는 것을 막고 있었다(ISR 도 서버 렌더다).
    //   📕 가드는 의도를 검사해야 한다 — 구현을 못박으면 개선이 회귀로 보인다.
    //     (reference_findable_traps · feedback_guard_defends_the_bug)
    expect(article).not.toContain('"use client"');
    expect(article).toContain("export const revalidate");
    // 🔴🔴 **발행 즉시 도달 가능해야 한다.** Next 공식: `dynamicParams = false` 는
    //   generateStaticParams 에 없는 경로에 **404** 를 준다 → 고객사가 대시보드에서
    //   새 글을 발행하면 재배포 전까지 404 였다(라이브 실측 구조, 2026-09-02).
    expect(
      article,
      "dynamicParams=false 는 새로 발행된 글을 404 로 만든다 — 다시 넣지 말 것"
    ).not.toMatch(/export const dynamicParams = false/);
    expect(article).toContain("<JsonLd");
    expect(markdown).toContain("rehypeSanitize");
    // 검수된 인사이트의 원출처 링크는 크롤러가 따라갈 수 있어야 인용 사슬이 보존된다.
    expect(markdown).toContain('rel="noreferrer"');
    expect(markdown).not.toContain("nofollow");
    expect(sitemap).toContain("listAllPublishedContentForDiscovery");
  });

  it("never publishes directly from generation", () => {
    const action = read("apps/app/app/actions/content/manage.ts");
    const generation = action.slice(
      action.indexOf("export async function generateDraftFromLatestAction"),
      action.indexOf("export async function createFindableDraft")
    );
    expect(generation).toContain('status: "publisher_review"');
    expect(generation).not.toContain('status: "published"');
  });

  it("does not expose an empty publisher profile to search engines", () => {
    const content = read("apps/web/lib/content.ts");
    expect(content).toMatch(/contents:\s*\{\s*some:/);
    expect(content).toContain('status: "published"');
    expect(content).toContain("noindex: false");
  });

  it("requires a full-content review before moderation approval", () => {
    const moderation = read(
      "apps/app/app/(authenticated)/admin/content/moderation-actions.tsx"
    );
    const queue = read("apps/app/app/(authenticated)/admin/content/page.tsx");
    expect(moderation).toContain("reviewConfirmed");
    expect(moderation).toContain("rejectionNote");
    expect(queue).toMatch(/\/insights\/\$\{content\.id\}/);
    const moderationAction = read("apps/app/app/actions/content/manage.ts");
    const moderationSection = moderationAction.slice(
      moderationAction.indexOf("export async function moderateContent")
    );
    expect(moderationSection).toContain("checkContentQuality");
    expect(moderationSection).toContain('quality.status === "failed"');
  });

  it("lets a customer start a normal post without a measurement action", () => {
    const action = read("apps/app/app/actions/content/manage.ts");
    const insights = read("apps/app/app/(authenticated)/insights/page.tsx");
    expect(action).toContain("export async function createPublisherDraft");
    expect(insights).toContain("onCreate={createPublisherDraft}");
  });
});
