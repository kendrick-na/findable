import { describe, expect, it } from "vitest";
import { contentSlug, contentSlugAfterDraftEdit } from "@/lib/content/slug";

describe("content slug", () => {
  it("replaces the Korean Findable template slug on the first editorial save", () => {
    expect(
      contentSlugAfterDraftEdit({
        currentSlug: "새-findable-리서치-초안-mt45znpn",
        publisherKind: "findable",
        title:
          "2026 K-뷰티 AI 검색 가시성 벤치마크: 20개 브랜드·108개 응답 분석",
      })
    ).toBe(
      `${contentSlug("2026 K-뷰티 AI 검색 가시성 벤치마크: 20개 브랜드·108개 응답 분석")}-mt45znpn`
    );
  });

  it("replaces the English Findable template slug", () => {
    expect(
      contentSlugAfterDraftEdit({
        currentSlug: "new-findable-research-draft-abc123",
        publisherKind: "findable",
        title: "K-beauty AI visibility benchmark 2026",
      })
    ).toBe("k-beauty-ai-visibility-benchmark-2026-abc123");
  });

  it("keeps established and customer publisher slugs stable", () => {
    expect(
      contentSlugAfterDraftEdit({
        currentSlug: "already-public-shaped-slug-abc123",
        publisherKind: "findable",
        title: "A later title edit must not move the URL",
      })
    ).toBe("already-public-shaped-slug-abc123");
    expect(
      contentSlugAfterDraftEdit({
        currentSlug: "customer-action-guide-abc123",
        publisherKind: "brand",
        title: "Customer title edit",
      })
    ).toBe("customer-action-guide-abc123");
  });
});
