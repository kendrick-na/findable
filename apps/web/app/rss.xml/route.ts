import { headers } from "next/headers";
import {
  getPublicPublisherByDomain,
  listAllPublishedContentForDiscovery,
  listPublishedContent,
} from "@/lib/content";
import {
  customDomainArticleUrl,
  isCanonicalOnSite,
  SITE_ORIGIN,
  siteArticleUrl,
} from "@/lib/public-url";
import { buildRssXml, RSS_HEADERS } from "@/lib/rss";

/**
 * `/rss.xml` — 인사이트 허브 피드. `/feed.xml` 이 같은 핸들러를 재수출한다.
 *
 * 🔴 **2026-09-02 호스트 분기를 넣었다.** 이전에는 어떤 호스트로 들어와도
 *   `Findable Insights` 피드를 돌려줬다 → **고객 커스텀 도메인에서 우리 피드가 서비스**됐다
 *   (`app/sitemap.ts` 는 이미 호스트 분기가 있는데 이 파일만 없었다).
 *   고객 도메인으로 들어오면 그 퍼블리셔의 글만 담은 피드를 준다.
 *
 * 🔴 우리 도메인 피드에서는 **정본을 커스텀 도메인으로 넘긴 글을 제외**한다.
 *   그 글의 정본 주소는 고객 도메인이고, 고객 도메인 피드가 담당한다.
 */

export const revalidate = 300;

const FINDABLE_HOSTS = new Set([
  "findable.co.kr",
  "www.findable.co.kr",
  "localhost",
  "127.0.0.1",
]);

async function requestHost(): Promise<string> {
  const requestHeaders = await headers();
  return (
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    ""
  )
    .split(":")[0]
    .toLowerCase();
}

async function customDomainFeed(host: string): Promise<Response | null> {
  const publisher = await getPublicPublisherByDomain(host);
  if (!publisher) {
    return null;
  }
  const posts = await listPublishedContent("ko", publisher.slug);
  const xml = buildRssXml({
    description:
      publisher.description ??
      `${publisher.name}이(가) 발행하는 검증된 콘텐츠입니다.`,
    items: posts.slice(0, 50).map((post) => ({
      description: post.excerpt ?? "",
      link: customDomainArticleUrl({
        customDomain: host,
        locale: post.locale,
        postSlug: post.slug,
      }),
      publishedAt: post.publishedAt,
      title: post.title,
    })),
    language: "ko",
    link: `https://${host}/`,
    selfUrl: `https://${host}/rss.xml`,
    title: publisher.name,
  });
  return new Response(xml, { headers: RSS_HEADERS });
}

export async function GET(): Promise<Response> {
  const host = await requestHost();
  if (host && !FINDABLE_HOSTS.has(host) && !host.endsWith(".vercel.app")) {
    const feed = await customDomainFeed(host);
    // 등록되지 않은 호스트로 들어온 요청에 우리 피드를 주지 않는다.
    return feed ?? new Response("Not found", { status: 404 });
  }

  const posts = (await listAllPublishedContentForDiscovery()).filter(
    (post) =>
      post.locale === "ko" &&
      post.publishedAt &&
      isCanonicalOnSite(post.publisher)
  );
  const xml = buildRssXml({
    description: "SEO·GEO·AI 검색 가시성 리서치",
    items: posts.slice(0, 50).map((post) => ({
      description: post.excerpt ?? "",
      link: siteArticleUrl({
        locale: post.locale,
        postSlug: post.slug,
        publisherSlug: post.publisher.slug,
      }),
      publishedAt: post.publishedAt,
      title: post.title,
    })),
    language: "ko",
    link: `${SITE_ORIGIN}/ko/insights`,
    selfUrl: `${SITE_ORIGIN}/rss.xml`,
    title: "Findable Insights",
  });
  return new Response(xml, { headers: RSS_HEADERS });
}
