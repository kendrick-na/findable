const NON_SLUG_RE = /[^a-z0-9가-힣]+/g;
const FINDABLE_DRAFT_PLACEHOLDERS = [
  "새-findable-리서치-초안",
  "new-findable-research-draft",
];

export function contentSlug(value: string): string {
  const slug = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(NON_SLUG_RE, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || "article";
}

/**
 * Findable 공식 초안은 실제 제목을 받기 전에 편집 템플릿으로 먼저 생성된다.
 * 최초 저장 때만 템플릿 슬러그를 제목 기반으로 바꾸고, 그 뒤 제목을 수정해도 URL은
 * 안정적으로 유지한다. 고객사 초안은 생성 시점부터 실제 제목이 있으므로 건드리지 않는다.
 */
export function contentSlugAfterDraftEdit(input: {
  currentSlug: string;
  publisherKind: string;
  title: string;
}): string {
  if (input.publisherKind !== "findable") {
    return input.currentSlug;
  }
  for (const placeholder of FINDABLE_DRAFT_PLACEHOLDERS) {
    const prefix = `${placeholder}-`;
    if (input.currentSlug.startsWith(prefix)) {
      const uniqueSuffix = input.currentSlug.slice(prefix.length);
      return `${contentSlug(input.title)}-${uniqueSuffix}`;
    }
  }
  return input.currentSlug;
}
