import "server-only";

import { database } from "@repo/database";

const publicWhere = {
  status: "published" as const,
  noindex: false,
  publishedAt: { not: null },
  publisher: { suspendedAt: null },
};

/**
 * 🔴 검색엔진·AI 에 **발견용으로 알릴 발행처**(2026-10-15 원인조사).
 *   Findable 본인(`findable`) 이거나 운영자가 확인한 발행처(`verifiedAt`)만이다.
 *   [실측] 내부 테스트 발행처 `findable-oauth-verification-af8297f3`(이름 "Findable OAuth
 *   Verification", `verifiedAt` 없음)의 글·목록 4개 주소가 사이트맵에 실려 구글이 크롤링했고,
 *   ChatGPT·Claude 는 그 이름을 "구글 OAuth 인증 대행"으로 오해했다.
 *   ⚠️ 페이지 자체는 그대로 열린다(링크 공유 가능) — 사이트맵·RSS·llms.txt·뉴스맵 노출과
 *     색인만 막는다. 새 고객 발행처는 `verifiedAt` 이 찍혀야 발견용으로 노출된다.
 */
export const DISCOVERABLE_PUBLISHER_WHERE = {
  suspendedAt: null,
  OR: [{ slug: "findable" }, { verifiedAt: { not: null } }],
};

/**
 * 한국어·영어 글의 슬러그가 **서로 다른** 번역 쌍.
 *   [ko 슬러그, en 슬러그]. 그 외 글은 두 언어가 같은 슬러그를 쓴다.
 *
 * 🔴 2026-10-15: 이 쌍들의 hreflang 이 상대 언어의 **같은 슬러그**(없는 주소)를 가리켜
 *   하나는 404, 하나는 301 이었다(실측). 구글은 깨진 hreflang 쌍을 무시한다.
 *   ⚠️ 새 글의 ko·en 슬러그를 다르게 짓는다면 여기에 한 줄 추가한다. 같게 지으면 필요 없다.
 */
const TRANSLATION_SLUG_PAIRS: readonly (readonly [string, string])[] = [
  [
    "seo와-geo의-차이-검색-순위와-ai-답변-노출을-함께-높이는-방법-mtfct1xy",
    "seo-vs-geo-search-rankings-ai-visibility",
  ],
  [
    "ai-검색-최적화-우리-브랜드-정보를-정리하는-7단계-mti7yxab",
    "new-blog-post-draft-mtmpt3um",
  ],
  // 슬러그 끝이 `-ko`/`-en` 으로 다른 쌍 — 첫 푸시 뒤 라이브 검증(hreflang 대상 6개 404)에서 발견.
  ["google-discover-blog-visibility-ko", "google-discover-blog-visibility-en"],
  ["faq-schema-ai-search-visibility-ko", "faq-schema-ai-search-visibility-en"],
];

/** 이 글의 상대 언어 글 슬러그. 번역 쌍 표에 없으면 같은 슬러그다. */
export function counterpartSlug(locale: "ko" | "en", slug: string): string {
  for (const [koSlug, enSlug] of TRANSLATION_SLUG_PAIRS) {
    if (locale === "ko" && slug === koSlug) {
      return enSlug;
    }
    if (locale === "en" && slug === enSlug) {
      return koSlug;
    }
  }
  return slug;
}

export function isPublisherIndexable(publisher: {
  slug: string;
  verifiedAt: Date | null;
}): boolean {
  return publisher.slug === "findable" || publisher.verifiedAt !== null;
}

// Keep the first published article reachable while moving its Unicode slug to
// an ASCII canonical URL. Some search inspection crawlers still return 404 for
// the encoded Korean path even though normal browsers receive 200.
const LEGACY_SLUG_ALIASES: Record<string, string> = {
  "2026-k-뷰티-ai-검색-가시성-벤치마크-20개-브랜드-108개-응답-분석-mt45znpn":
    "k-beauty-ai-search-visibility-benchmark-2026",
};

function decodeRouteSegment(value: string) {
  let decoded = value;
  // Crawlers and edge proxies can percent-encode an already encoded Unicode
  // slug more than once. Normalize a few layers so the public article URL
  // resolves consistently for browsers, Google Inspection Tool, and sitemap
  // fetchers without changing the stored slug.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

export function listPublishedContent(
  locale: string,
  publisherSlug?: string,
  filters?: { contentType?: string; query?: string }
) {
  return database.content.findMany({
    where: {
      ...publicWhere,
      locale,
      ...(filters?.contentType ? { contentType: filters.contentType } : {}),
      ...(filters?.query
        ? {
            OR: [
              {
                title: {
                  contains: filters.query,
                  mode: "insensitive" as const,
                },
              },
              {
                excerpt: {
                  contains: filters.query,
                  mode: "insensitive" as const,
                },
              },
              {
                bodyMarkdown: {
                  contains: filters.query,
                  mode: "insensitive" as const,
                },
              },
              { tags: { has: filters.query } },
            ],
          }
        : {}),
      ...(publisherSlug
        ? { publisher: { slug: publisherSlug, suspendedAt: null } }
        : {}),
    },
    orderBy: { publishedAt: "desc" },
    include: { publisher: true },
    take: 60,
  });
}

export function listRelatedContent(input: {
  contentId: string;
  contentType: string;
  locale: string;
  publisherId: string;
}) {
  return database.content.findMany({
    where: {
      ...publicWhere,
      // 🔴 2026-10-15: 확인되지 않은 발행처(내부 테스트 등)의 글을 "이어 읽기"로 추천하지 않는다.
      //   [실측] 공식 글 4개 하단에 "Findable OAuth Verification" 글이 추천으로 노출되고 있었다.
      publisher: DISCOVERABLE_PUBLISHER_WHERE,
      id: { not: input.contentId },
      locale: input.locale,
      OR: [
        { publisherId: input.publisherId },
        { contentType: input.contentType },
      ],
    },
    include: { publisher: true },
    orderBy: [{ featuredAt: "desc" }, { publishedAt: "desc" }],
    take: 3,
  });
}

export function getPublishedContent(input: {
  locale: string;
  postSlug: string;
  publisherSlug: string;
}) {
  const postSlug = decodeRouteSegment(input.postSlug);
  const publisherSlug = decodeRouteSegment(input.publisherSlug);
  const lookupSlug = LEGACY_SLUG_ALIASES[postSlug] ?? postSlug;

  return database.content.findFirst({
    where: {
      ...publicWhere,
      locale: input.locale,
      slug: lookupSlug,
      publisher: { slug: publisherSlug, suspendedAt: null },
    },
    include: { publisher: true },
  });
}

export function getPublicPublisher(slug: string) {
  return database.publisher.findFirst({
    where: {
      slug: decodeRouteSegment(slug),
      suspendedAt: null,
      contents: {
        some: {
          status: "published",
          noindex: false,
          publishedAt: { not: null },
        },
      },
    },
  });
}

export function getPublicPublisherByDomain(customDomain: string) {
  return database.publisher.findFirst({
    where: {
      customDomain: decodeRouteSegment(customDomain).toLowerCase(),
      customDomainStatus: "active",
      suspendedAt: null,
    },
  });
}

export function getPublishedContentByDomain(input: {
  customDomain: string;
  locale: string;
  postSlug: string;
}) {
  return database.content.findFirst({
    where: {
      ...publicWhere,
      locale: input.locale,
      slug: decodeRouteSegment(input.postSlug),
      publisher: {
        customDomain: decodeRouteSegment(input.customDomain).toLowerCase(),
        customDomainStatus: "active",
        suspendedAt: null,
      },
    },
    include: { publisher: true },
  });
}

export function listAllPublishedContentForDiscovery() {
  return database.content.findMany({
    where: { ...publicWhere, publisher: DISCOVERABLE_PUBLISHER_WHERE },
    orderBy: { publishedAt: "desc" },
    select: {
      locale: true,
      slug: true,
      title: true,
      excerpt: true,
      contentType: true,
      series: true,
      tags: true,
      publishedAt: true,
      updatedAt: true,
      // 🔴 `customDomain`·`customDomainStatus` 를 함께 읽는다(2026-09-02).
      //   사이트맵·뉴스 사이트맵·RSS 가 **정본 호스트**를 판정해야 하는데
      //   (→ `lib/public-url.ts`), 이 두 값이 없어서 전부 우리 도메인 URL 로만
      //   조립되고 있었다. 커스텀 도메인을 연결한 퍼블리셔의 글이 두 호스트에
      //   중복 등재되는 원인이었다.
      publisher: {
        select: {
          slug: true,
          name: true,
          customDomain: true,
          customDomainStatus: true,
        },
      },
    },
    take: 1000,
  });
}
