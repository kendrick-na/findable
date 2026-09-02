import { getPublicPublisher, listPublishedContent } from "@/lib/content";
import { articleCanonicalUrl, publisherCanonicalUrl } from "@/lib/public-url";
import { buildRssXml, RSS_HEADERS } from "@/lib/rss";

/**
 * `/{locale}/p/{퍼블리셔}/rss.xml` — **퍼블리셔 단위 피드**(2026-09-02 신설).
 *
 * 왜: 네이버 서치어드바이저의 색인 경로 중 하나가 **RSS 제출**인데(1차 리서치 §1-8),
 *   피드가 허브 하나뿐이라 고객사가 제출할 자기 피드가 없었다. 커스텀 도메인을 붙이지
 *   않은 퍼블리셔도 이 주소로 제출할 수 있다.
 *
 * ⚠️ 정적 세그먼트 `rss.xml` 이 형제 동적 세그먼트 `[postSlug]` 보다 우선하므로
 *   글 페이지와 충돌하지 않는다.
 * ⚠️ 항목 링크는 **정본 URL**(`articleCanonicalUrl`)을 쓴다 — 커스텀 도메인을 연결한
 *   퍼블리셔라면 그 도메인 주소가 나간다. 피드 구독자·색인 요청이 정본 한 곳을 향한다.
 */

export const revalidate = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; publisherSlug: string }> }
): Promise<Response> {
  const { locale, publisherSlug } = await params;
  const normalizedLocale = locale.startsWith("ko") ? "ko" : "en";
  const publisher = await getPublicPublisher(publisherSlug);
  if (!publisher) {
    return new Response("Not found", { status: 404 });
  }

  const posts = await listPublishedContent(normalizedLocale, publisher.slug);
  const xml = buildRssXml({
    description:
      publisher.description ??
      (normalizedLocale === "ko"
        ? `${publisher.name}이(가) Findable에 발행하는 검증된 콘텐츠입니다.`
        : `Verified content published by ${publisher.name} on Findable.`),
    items: posts.slice(0, 50).map((post) => ({
      description: post.excerpt ?? "",
      link: articleCanonicalUrl({
        locale: post.locale,
        postSlug: post.slug,
        publisher,
      }),
      publishedAt: post.publishedAt,
      title: post.title,
    })),
    language: normalizedLocale,
    link: publisherCanonicalUrl(normalizedLocale, publisher),
    selfUrl: `${publisherCanonicalUrl(normalizedLocale, publisher)}/rss.xml`,
    title: publisher.name,
  });

  return new Response(xml, { headers: RSS_HEADERS });
}
