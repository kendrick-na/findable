import { JsonLd } from "@repo/seo/json-ld";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownArticle } from "@/components/content/markdown-article";
import { getPublishedContentByDomain } from "@/lib/content";
import { customDomainArticleUrl } from "@/lib/public-url";

/**
 * 고객 커스텀 도메인의 글 페이지. 프록시(`customDomainRewrite`)가
 * `{고객도메인}/p/{글}` → 이 라우트로 rewrite 한다.
 *
 * 🔴 **2026-09-02 — `force-dynamic` 을 걷어냈다.** 공개 글이 매 요청 SSR 이라
 *   크롤러가 올 때마다 DB 를 때렸다(우리 도메인 쪽은 이미 ISR 이었다).
 *   ISR 로 캐시하고, 발행·수정 시 `app/api/revalidate` 가 무효화한다.
 *
 * ⚠️ 이 라우트는 **호스트에 따라 내용이 달라진다** → `generateStaticParams` 로
 *   미리 만들 수 없다. 첫 요청에 생성되고 이후 캐시된다.
 */
export const revalidate = 3600;

interface Props {
  params: Promise<{ customDomain: string; locale: string; postSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const input = await params;
  const post = await getPublishedContentByDomain(input);
  if (!post) {
    return {};
  }
  const locale = input.locale.startsWith("ko") ? "ko" : "en";
const canonical = customDomainArticleUrl({
    customDomain: input.customDomain,
    locale,
    postSlug: post.slug,
  });
  const description =
    post.seoDescription ?? post.excerpt ?? post.bodyMarkdown.slice(0, 160);

  // 🔴 **여기는 `createMetadata` 를 쓰지 않는다.** 그 함수는 `www.findable.co.kr` 기준으로
  //   canonical·hreflang·OG URL 을 조립하고 제목에 `| Findable` 을 붙인다 —
  //   고객 도메인에서는 **전부 틀린 값**이 된다(남의 브랜드 페이지에 우리 접미사).
  //   대신 같은 신호를 이 호스트 기준으로 직접 구성한다.
  //   [실측 2026-09-02] 이전에는 og:*·hreflang 이 **한 개도 없었다.**
  return {
    title: post.seoTitle ?? post.title,
    description,
    metadataBase: new URL(`https://${input.customDomain}`),
    alternates: {
      canonical,
      languages: {
        ko: customDomainArticleUrl({
          customDomain: input.customDomain,
          locale: "ko",
          postSlug: post.slug,
        }),
        en: customDomainArticleUrl({
          customDomain: input.customDomain,
          locale: "en",
          postSlug: post.slug,
        }),
        "x-default": customDomainArticleUrl({
          customDomain: input.customDomain,
          locale: "en",
          postSlug: post.slug,
        }),
      },
    },
    openGraph: {
      type: "article",
      title: post.seoTitle ?? post.title,
      description,
      url: canonical,
      siteName: post.publisher.name,
      locale: locale === "ko" ? "ko_KR" : "en_US",
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      authors: [post.publisher.name],
      tags: post.tags,
      ...(post.coverImageUrl
        ? {
            images: [
              {
                url: post.coverImageUrl,
                alt: post.coverImageAlt ?? post.title,
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: post.coverImageUrl ? "summary_large_image" : "summary",
      ...(post.coverImageUrl ? { images: [post.coverImageUrl] } : {}),
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
    },
  };
}

export default async function CustomArticlePage({ params }: Props) {
  const input = await params;
  const post = await getPublishedContentByDomain(input);
  if (!post) {
    notFound();
  }
  const locale = input.locale.startsWith("ko") ? "ko" : "en";
  const ko = locale === "ko";
  const prefix = ko ? "" : `/${locale}`;
  const canonical = customDomainArticleUrl({
    customDomain: input.customDomain,
    locale,
    postSlug: post.slug,
  });
  const home = `https://${input.customDomain}${prefix}/`;
  return (
    <main className="min-h-screen bg-[#f5f1e8] text-[#1f211f]">
      <JsonLd
        code={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: post.title,
          description: post.excerpt ?? undefined,
          datePublished: post.publishedAt?.toISOString(),
          dateModified: post.updatedAt.toISOString(),
          mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
          url: canonical,
          author: {
            "@type": "Organization",
            name: post.publisher.name,
            url: post.publisher.websiteUrl ?? home,
          },
          publisher: {
            "@type": "Organization",
            name: post.publisher.name,
            ...(post.publisher.logoUrl
              ? {
                  logo: { "@type": "ImageObject", url: post.publisher.logoUrl },
                }
              : {}),
          },
          image: post.coverImageUrl ?? undefined,
          articleSection: post.contentType,
          keywords: post.tags.join(", "),
          inLanguage: ko ? "ko-KR" : "en-US",
          isAccessibleForFree: true,
        }}
      />
      <JsonLd
        code={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: post.publisher.name,
              item: home,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: post.title,
              item: canonical,
            },
          ],
        }}
      />
      <article className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <Link className="text-[#e86f45] text-sm" href={`${prefix}/`}>
          ← {post.publisher.name}
        </Link>
        <p className="mt-14 text-[#e86f45] text-xs uppercase tracking-[.18em]">
          {post.series ?? post.contentType}
        </p>
        <h1 className="mt-4 text-balance font-semibold font-serif text-4xl leading-tight md:text-6xl">
          {post.title}
        </h1>
        {post.excerpt ? (
          <p className="mt-6 border-[#e86f45] border-l-2 pl-5 text-black/60 text-lg leading-8">
            {post.excerpt}
          </p>
        ) : null}
        {/* 저자·발행일 표시(byline) — 1차 리서치 §3-1 의 아티클 템플릿 7번.
            이전에는 발행일이 화면에 없어 사람도 신선도를 판단할 수 없었다. */}
        <div className="mt-8 flex flex-wrap items-center gap-4 border-black/10 border-t pt-4 text-black/45 text-xs">
          <div className="flex items-center gap-2.5 text-[#292a28]">
            {post.publisher.logoUrl ? (
              <Image
                alt={post.publisher.name}
                className="size-9 object-contain"
                height={36}
                src={post.publisher.logoUrl}
                unoptimized
                width={36}
              />
            ) : (
              <span className="grid size-9 place-items-center rounded-full bg-[#ff744d] font-semibold text-sm text-white">
                {post.publisher.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span>
              <span className="block font-semibold text-[13px]">{post.publisher.name}</span>
              {post.publishedAt ? (
                <time className="mt-0.5 block text-[11px] text-black/40" dateTime={post.publishedAt.toISOString()}>
                  {post.publishedAt.toLocaleDateString(locale)}
                </time>
              ) : null}
            </span>
          </div>
          <span aria-hidden>·</span>
          <span>
            {ko ? "업데이트 " : "Updated "}
            <time dateTime={post.updatedAt.toISOString()}>
              {post.updatedAt.toLocaleDateString(locale)}
            </time>
          </span>
        </div>
        <div className="mt-12">
          <MarkdownArticle markdown={post.bodyMarkdown} />
        </div>
      </article>
    </main>
  );
}
