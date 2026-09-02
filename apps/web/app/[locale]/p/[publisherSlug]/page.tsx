import { JsonLd } from "@repo/seo/json-ld";
import { createMetadata } from "@repo/seo/metadata";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NewsletterSubscribe } from "@/components/content/newsletter-subscribe";
import { getPublicPublisher, listPublishedContent } from "@/lib/content";
import {
  articleCanonicalUrl,
  publisherCanonicalUrl,
  sitePublisherUrl,
} from "@/lib/public-url";

// 🔴 매 요청 SSR(`force-dynamic`)이었다 — 크롤러가 가장 자주 오는 목록 페이지다(2026-09-02).
//   ISR 로 캐시하고, 발행·수정 시 `app/api/revalidate` 가 즉시 무효화한다.
export const revalidate = 3600;

interface Props {
  params: Promise<{ locale: string; publisherSlug: string }>;
}

const PROTOCOL_RE = /^https?:\/\//;

function publisherBadge(locale: string, verified: boolean) {
  if (locale.startsWith("ko")) {
    return verified ? "인증된 발행자" : "발행자";
  }
  return verified ? "Verified publisher" : "Publisher";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, publisherSlug } = await params;
  const publisher = await getPublicPublisher(publisherSlug);
  if (!publisher) {
    return {};
  }
  const normalizedLocale = locale.startsWith("ko") ? "ko" : "en";
  return createMetadata({
    title: publisher.name,
    description:
      publisher.description ??
      (normalizedLocale === "ko"
        ? `${publisher.name}이(가) Findable에 발행하는 인사이트 목록입니다. 측정 근거와 발행일을 함께 확인할 수 있습니다.`
        : `Insights published by ${publisher.name} on Findable, with measurement basis and publication dates.`),
    locale: normalizedLocale,
    pathname: `/p/${publisher.slug}`,
    // 📡 피드 자동발견(feed discovery) — 브라우저·리더·네이버 서치어드바이저가
    //   페이지에서 바로 RSS 주소를 찾을 수 있게 한다(퍼블리셔 단위 피드는 2026-09-02 신설).
    alternates: {
      types: {
        "application/rss+xml": `${sitePublisherUrl(normalizedLocale, publisher.slug)}/rss.xml`,
      },
    },
  });
}

export default async function PublisherPage({ params }: Props) {
  const { locale, publisherSlug } = await params;
  const [publisher, posts] = await Promise.all([
    getPublicPublisher(publisherSlug),
    listPublishedContent(locale, publisherSlug),
  ]);
  if (!publisher) {
    notFound();
  }
  const publisherLabel = publisherBadge(locale, Boolean(publisher.verifiedAt));
  // 🔴 `en` 도 접두사를 붙인다 — 빈 접두사는 방문자 국가로 언어가 바뀌는 경로다.
  const normalizedLocale = locale.startsWith("ko") ? "ko" : "en";
  const prefix = `/${normalizedLocale}`;
  return (
    <main className="min-h-screen bg-[var(--findable-canvas)] text-[var(--findable-ink)]">
      {/* 🔴 이 페이지는 JSON-LD 가 **0개**였다(실측 2026-09-02) — 인사이트 허브인데
          엔티티를 선언하지 않아 검색·AI 엔진이 "누가 무엇을 발행하는 곳"인지 알 수 없었다.
          `Blog` + 발행 주체 `Organization` + 글 목록(`blogPost`)을 함께 낸다. */}
      <JsonLd
        code={{
          "@context": "https://schema.org",
          "@type": "Blog",
          name: publisher.name,
          description: publisher.description ?? undefined,
          url: publisherCanonicalUrl(normalizedLocale, publisher),
          inLanguage: normalizedLocale === "ko" ? "ko-KR" : "en-US",
          publisher: {
            "@type": "Organization",
            name: publisher.name,
            url: publisher.websiteUrl ?? undefined,
            ...(publisher.logoUrl
              ? { logo: { "@type": "ImageObject", url: publisher.logoUrl } }
              : {}),
          },
          blogPost: posts.slice(0, 20).map((post) => ({
            "@type": "BlogPosting",
            headline: post.title,
            description: post.excerpt ?? undefined,
            datePublished: post.publishedAt?.toISOString(),
            dateModified: post.updatedAt.toISOString(),
            url: articleCanonicalUrl({
              locale: normalizedLocale,
              postSlug: post.slug,
              publisher,
            }),
          })),
        }}
      />
      <header className="border-[var(--findable-hairline)] border-b px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <p className="text-[var(--findable-primary)] text-xs uppercase tracking-[0.18em]">
            {publisherLabel}
          </p>
          <h1 className="mt-4 font-semibold text-4xl tracking-tight md:text-6xl">
            {publisher.name}
          </h1>
          {publisher.description ? (
            <p className="mt-5 max-w-2xl text-[var(--findable-ink-subtle)] text-base leading-7">
              {publisher.description}
            </p>
          ) : null}
          {publisher.websiteUrl ? (
            <a
              className="mt-5 inline-block text-[var(--findable-primary)] text-sm"
              href={publisher.websiteUrl}
              rel="noreferrer"
              target="_blank"
            >
              {publisher.websiteUrl.replace(PROTOCOL_RE, "")}
            </a>
          ) : null}
          {publisher.newsletterEnabled ? (
            <NewsletterSubscribe
              locale={locale}
              publisherName={publisher.name}
              publisherSlug={publisher.slug}
            />
          ) : null}
        </div>
      </header>
      <section className="mx-auto max-w-4xl divide-y divide-[var(--findable-hairline)] px-6 py-10">
        {posts.map((post) => (
          <article className="py-9" key={post.id}>
            <Link
              className="group"
              href={`${prefix}/p/${publisher.slug}/${post.slug}`}
            >
              <time className="text-[var(--findable-ink-tertiary)] text-xs">
                {post.publishedAt?.toLocaleDateString(locale)}
              </time>
              <h2 className="mt-3 text-balance font-semibold text-2xl tracking-tight group-hover:text-[var(--findable-primary)]">
                {post.title}
              </h2>
              <p className="mt-3 line-clamp-2 text-[var(--findable-ink-subtle)] text-sm leading-6">
                {post.excerpt}
              </p>
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
