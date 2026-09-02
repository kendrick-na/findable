import { JsonLd } from "@repo/seo/json-ld";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NewsletterSubscribe } from "@/components/content/newsletter-subscribe";
import {
  getPublicPublisherByDomain,
  listPublishedContent,
} from "@/lib/content";
import { customDomainArticleUrl } from "@/lib/public-url";

/**
 * 고객 커스텀 도메인의 **블로그 홈**.
 *
 * 🔴 **2026-09-02 — 이 페이지에는 메타데이터가 하나도 없었다.**
 *   `generateMetadata` 가 없어서 `<title>`·description·canonical·og 가 전부 비었다.
 *   고객이 자기 도메인을 붙였을 때 **첫 화면이 제목 없는 페이지**로 색인된다는 뜻이다.
 *   `force-dynamic` 도 걷어내 ISR 로 캐시한다(발행 시 `/api/revalidate` 가 무효화).
 */
export const revalidate = 3600;

interface Props {
  params: Promise<{ customDomain: string; locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { customDomain, locale } = await params;
  const publisher = await getPublicPublisherByDomain(customDomain);
  if (!publisher) {
    return {};
  }
  const ko = locale.startsWith("ko");
  const prefix = ko ? "" : `/${locale}`;
  const home = `https://${customDomain}${prefix}/`;
  const description =
    publisher.description ??
    (ko
      ? `${publisher.name}이(가) 발행하는 인사이트입니다. 측정 근거와 발행일을 함께 확인할 수 있습니다.`
      : `Insights published by ${publisher.name}, with measurement basis and publication dates.`);
  return {
    title: publisher.name,
    description,
    metadataBase: new URL(`https://${customDomain}`),
    alternates: {
      canonical: home,
      types: {
        "application/rss+xml": `https://${customDomain}/rss.xml`,
      },
    },
    openGraph: {
      type: "website",
      title: publisher.name,
      description,
      url: home,
      siteName: publisher.name,
      locale: ko ? "ko_KR" : "en_US",
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
    },
  };
}

export default async function CustomPublisherPage({ params }: Props) {
  const { customDomain, locale } = await params;
  const publisher = await getPublicPublisherByDomain(customDomain);
  if (!publisher) {
    notFound();
  }
  const posts = await listPublishedContent(locale, publisher.slug);
  const ko = locale.startsWith("ko");
  const prefix = ko ? "" : `/${locale}`;
  const home = `https://${customDomain}${prefix}/`;
  return (
    <main className="min-h-screen bg-[#f5f1e8] text-[#1f211f]">
      <JsonLd
        code={{
          "@context": "https://schema.org",
          "@type": "Blog",
          name: publisher.name,
          description: publisher.description ?? undefined,
          url: home,
          inLanguage: ko ? "ko-KR" : "en-US",
          publisher: {
            "@type": "Organization",
            name: publisher.name,
            url: publisher.websiteUrl ?? home,
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
            url: customDomainArticleUrl({
              customDomain,
              locale: post.locale,
              postSlug: post.slug,
            }),
          })),
        }}
      />
      <header className="border-black/10 border-b px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <p className="text-[#e86f45] text-xs uppercase tracking-[.18em]">
            Publisher
          </p>
          <h1 className="mt-4 font-semibold font-serif text-5xl">
            {publisher.name}
          </h1>
          {publisher.description ? (
            <p className="mt-5 max-w-2xl text-black/55 leading-7">
              {publisher.description}
            </p>
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
      <section className="mx-auto max-w-4xl divide-y divide-black/10 px-6 py-8">
        {posts.map((post) => (
          <article className="py-8" key={post.id}>
            <Link href={`${prefix}/p/${post.slug}`}>
              <time className="text-black/40 text-xs">
                {post.publishedAt?.toLocaleDateString(locale)}
              </time>
              <h2 className="mt-3 font-semibold font-serif text-3xl">
                {post.title}
              </h2>
              <p className="mt-3 text-black/55 leading-6">{post.excerpt}</p>
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
