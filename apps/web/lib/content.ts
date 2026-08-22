import "server-only";

import { database } from "@repo/database";

const publicWhere = {
  status: "published" as const,
  noindex: false,
  publishedAt: { not: null },
  publisher: { suspendedAt: null },
};

function decodeRouteSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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

  return database.content.findFirst({
    where: {
      ...publicWhere,
      locale: input.locale,
      slug: postSlug,
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
