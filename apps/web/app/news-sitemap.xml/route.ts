import { listAllPublishedContentForDiscovery } from "@/lib/content";
import { isCanonicalOnSite, siteArticleUrl } from "@/lib/public-url";

/**
 * `/news-sitemap.xml` — 구글 뉴스 사이트맵.
 *
 * 📐 규격(2차 리서치 §C-2, 구글 공식): `news:publication`(name·language) +
 *   `news:publication_date` + `news:title`. **최근 2일 이내 기사만** 담는다.
 *
 * 🔴 **2026-09-02 두 곳을 고쳤다.**
 *   ① `news:name` 이 전 글 하드코딩 `Findable` 이었다 → **발행 퍼블리셔 이름**으로.
 *      뉴스 사이트맵의 publication name 은 "발행 매체명"이라, 고객사가 자기 블로그에
 *      올린 글을 우리 매체 발행물로 신고하는 셈이었다(고객사 발행이 시작되면 전부 오신고).
 *   ② 커스텀 도메인으로 **정본을 넘긴 글은 제외**한다. 남의 호스트 URL 을 우리
 *      사이트맵에 담으면 교차제출이라 양쪽 도메인 소유확인이 없으면 무시된다.
 *      그 글은 해당 도메인의 사이트맵이 담당한다(→ `lib/public-url.ts`).
 */

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const XML_UNSAFE_RE = /[&<>"']/g;
const XML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(value: string) {
  return value.replace(XML_UNSAFE_RE, (char) => XML_ENTITIES[char] ?? char);
}

export const revalidate = 300;

export async function GET() {
  const cutoff = Date.now() - TWO_DAYS_MS;
  const posts = (await listAllPublishedContentForDiscovery()).filter(
    (post) =>
      (post.locale === "ko" || post.locale === "en") &&
      post.publishedAt &&
      post.publishedAt.getTime() >= cutoff &&
      isCanonicalOnSite(post.publisher)
  );

  const entries = posts
    .map((post) => {
      const url = siteArticleUrl({
        locale: post.locale,
        postSlug: post.slug,
        publisherSlug: post.publisher.slug,
      });
      return [
        "  <url>",
        `    <loc>${escapeXml(url)}</loc>`,
        "    <news:news>",
        "      <news:publication>",
        `        <news:name>${escapeXml(post.publisher.name)}</news:name>`,
        `        <news:language>${post.locale}</news:language>`,
        "      </news:publication>",
        `      <news:publication_date>${post.publishedAt?.toISOString()}</news:publication_date>`,
        `      <news:title>${escapeXml(post.title)}</news:title>`,
        "    </news:news>",
        "  </url>",
      ].join("\n");
    })
    .join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">',
    entries,
    "</urlset>",
  ].join("\n");

  return new Response(xml, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
