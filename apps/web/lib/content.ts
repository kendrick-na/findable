import "server-only";

import { database } from "@repo/database";

const publicWhere = {
  status: "published" as const,
  noindex: false,
  publishedAt: { not: null },
  publisher: { suspendedAt: null },
};

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
    where: publicWhere,
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
      publisher: { select: { slug: true, name: true } },
    },
    take: 1000,
  });
}
