import { JsonLd } from "@repo/seo/json-ld";
import { createMetadata } from "@repo/seo/metadata";
import { ArrowLeftIcon, ArrowRightIcon, Clock3Icon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownArticle } from "@/components/content/markdown-article";
import {
  getPublishedContent,
  listAllPublishedContentForDiscovery,
  listRelatedContent,
} from "@/lib/content";
import {
  articleCanonicalUrl,
  customDomainArticleUrl,
  hasLiveCustomDomain,
  siteArticleUrl,
  sitePublisherUrl,
} from "@/lib/public-url";

/**
 * 🔴🔴 **발행 즉시 살아나야 한다 — `dynamicParams` 를 끄지 않는다**(2026-09-02).
 *
 *   라이브는 `dynamicParams = false` 였다. Next.js 공식(16.3.4) 정의:
 *   *"`false`: generateStaticParams 에 없는 동적 세그먼트는 **404** 를 반환한다."*
 *   → **고객사가 대시보드에서 새 글을 발행하면 재배포 전까지 그 URL 이 404** 였다.
 *     사이트맵·RSS·뉴스 사이트맵에는 올라가는데 페이지가 없는 상태 = 색인 요청이
 *     404 를 먹는다(구글은 반복 404 를 기억한다). 고객사 블로그를 파는 제품에서
 *     이건 기능이 아니라 결함이다.
 *
 *   기본값(`true`)을 그대로 쓰면 **목록에 없던 글은 첫 요청에 생성**되고 이후 캐시된다.
 *   빌드 시점에 아는 글은 미리 만들어 두고(아래 `generateStaticParams`),
 *   그 뒤 발행된 글은 온디맨드로 만든다.
 *
 * ⚠️ 갱신(수정 후 재발행)은 `revalidate` 주기 안에서는 반영되지 않는다 →
 *   `apps/app` 의 발행 액션이 `app/api/revalidate` 를 호출해 즉시 무효화한다.
 *   (앱과 웹은 **다른 Vercel 배포**라 `revalidatePath` 가 서로에게 듣지 않는다.)
 */
export const revalidate = 3600;
export const dynamic = "force-static";

export async function generateStaticParams() {
  try {
    const posts = await listAllPublishedContentForDiscovery();
    return posts
      .filter((post) => post.locale === "ko" || post.locale === "en")
      .map((post) => ({
        locale: post.locale,
        postSlug: post.slug,
        publisherSlug: post.publisher.slug,
      }));
  } catch {
    // 🔴 빌드가 DB 에 의존하지 않게 한다. 목록이 비어도 `dynamicParams` 기본값 덕에
    //   모든 글이 온디맨드로 생성된다 — 빌드 실패보다 훨씬 낫다.
    return [];
  }
}

interface Props {
  params: Promise<{ locale: string; postSlug: string; publisherSlug: string }>;
}

const MARKDOWN_PUNCTUATION_RE = /[#*_>`[\]()|-]/g;
/** 외부 호스트 이미지 판별 — `remotePatterns` 미등록 URL 은 최적화를 태우면 400 이 된다. */
const REMOTE_IMAGE_RE = /^https?:\/\//;
const WHITESPACE_RE = /\s+/;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const input = await params;
  const post = await getPublishedContent(input);
  if (!post) {
    return {};
  }
  const locale = input.locale.startsWith("ko") ? "ko" : "en";
  const canonical = articleCanonicalUrl({
    locale,
    postSlug: post.slug,
    publisher: post.publisher,
  });

  // 🔴 **커스텀 도메인을 연결한 퍼블리셔의 글은 그 도메인이 정본이다**(→ `lib/public-url.ts`).
  //   그때는 canonical·hreflang 을 **고객 도메인 주소로 통째로** 바꿔야 한다.
  //   canonical 만 넘기고 hreflang 을 우리 호스트로 남기면 두 신호가 엇갈려
  //   구글이 언어 클러스터를 무시한다(1차 리서치 §1-7).
  const alternates = hasLiveCustomDomain(post.publisher)
    ? {
        canonical,
        languages: {
          ko: customDomainArticleUrl({
            customDomain: post.publisher.customDomain ?? "",
            locale: "ko",
            postSlug: post.slug,
          }),
          en: customDomainArticleUrl({
            customDomain: post.publisher.customDomain ?? "",
            locale: "en",
            postSlug: post.slug,
          }),
          "x-default": customDomainArticleUrl({
            customDomain: post.publisher.customDomain ?? "",
            locale: "en",
            postSlug: post.slug,
          }),
        },
      }
    : undefined;

  return createMetadata({
    title: post.seoTitle ?? post.title,
    description:
      post.seoDescription ?? post.excerpt ?? post.bodyMarkdown.slice(0, 160),
    image: post.coverImageUrl ?? undefined,
    locale,
    pathname: `/p/${post.publisher.slug}/${post.slug}`,
    ...(alternates ? { alternates } : {}),
    openGraph: {
      type: "article",
      url: canonical,
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      authors: [post.publisher.name],
      tags: post.tags,
    },
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: article metadata, evidence UI, and related content are intentionally rendered together on the server.
export default async function ArticlePage({ params }: Props) {
  const input = await params;
  const post = await getPublishedContent(input);
  if (!post) {
    notFound();
  }
  // 🔴 `en` 접두사를 붙인다(2026-09-02). 이전엔 빈 문자열이라 EN 글의 내부 링크·JSON-LD 가
  //   무접두사 경로를 가리켰다 — 그 경로는 **방문자 국가로 언어가 바뀐다.**
  const ko = input.locale.startsWith("ko");
  const locale = ko ? "ko" : "en";
  const prefix = `/${locale}`;
  const canonical = articleCanonicalUrl({
    locale,
    postSlug: post.slug,
    publisher: post.publisher,
  });
  const siteUrl = siteArticleUrl({
    locale,
    postSlug: post.slug,
    publisherSlug: post.publisher.slug,
  });
  const words = post.bodyMarkdown
    .replace(MARKDOWN_PUNCTUATION_RE, " ")
    .split(WHITESPACE_RE)
    .filter(Boolean).length;
  const readingMinutes = Math.max(1, Math.ceil(words / (ko ? 450 : 220)));
  const headings = [...post.bodyMarkdown.matchAll(/^##\s+(.+)$/gm)].map(
    (match) => ({
      id: match[1]
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .replace(/\s+/g, "-"),
      label: match[1].trim(),
    })
  );
  const related = await listRelatedContent({
    contentId: post.id,
    contentType: post.contentType,
    locale: input.locale,
    publisherId: post.publisherId,
  });
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
          // `mainEntityOfPage` 는 문자열이 아니라 **WebPage 노드**로 준다(정본 URL 고정).
          mainEntityOfPage: {
            "@type": "WebPage",
            "@id": canonical,
          },
          url: canonical,
          // 🔴 **발행 주체를 고객 퍼블리셔로 바로잡았다**(2026-09-02).
          //   이전엔 `publisher` 가 전 글 하드코딩 `Findable` 이었다 — 고객사가 자기 블로그에
          //   올린 글의 발행처를 우리로 신고하는 셈이었다(고객 발행이 시작되면 전부 오신고).
          //   Findable 공식 글은 퍼블리셔 자체가 Findable 이라 값이 그대로 유지된다.
          author: {
            "@type": "Organization",
            name: post.publisher.name,
            url:
              post.publisher.websiteUrl ??
              sitePublisherUrl(locale, post.publisher.slug),
          },
          publisher: {
            "@type": "Organization",
            name: post.publisher.name,
            ...(post.publisher.logoUrl
              ? {
                  logo: {
                    "@type": "ImageObject",
                    url: post.publisher.logoUrl,
                  },
                }
              : {}),
          },
          image: post.coverImageUrl ?? undefined,
          articleSection: post.contentType,
          keywords: post.tags.join(", "),
          inLanguage: ko ? "ko-KR" : "en-US",
          wordCount: words,
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
              name: ko ? "인사이트" : "Insights",
              item: `https://www.findable.co.kr${prefix}/insights`,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: post.publisher.name,
              item: sitePublisherUrl(locale, post.publisher.slug),
            },
            {
              // 빵부스러기는 **이 호스트에서의 경로**를 설명한다 → 정본이 고객 도메인이어도
              // 여기서는 우리 호스트 주소를 쓴다(경로와 URL 이 어긋나면 안 된다).
              "@type": "ListItem",
              position: 3,
              name: post.title,
              item: siteUrl,
            },
          ],
        }}
      />
      <article>
        <header className="border-black/10 border-b px-6 pt-12 pb-14 md:pt-16 md:pb-20">
          <div className="mx-auto max-w-5xl">
            <Link
              className="inline-flex items-center gap-1.5 font-medium text-black/45 text-xs hover:text-[#e86f45]"
              href={`${prefix}/insights`}
            >
              <ArrowLeftIcon className="size-3.5" />{" "}
              {ko ? "Findable 인사이트" : "Findable Insights"}
            </Link>
            <p className="mt-10 font-semibold text-[#d95f38] text-xs uppercase tracking-[0.17em]">
              {post.series || post.contentType.replace("_", " ")}
            </p>
            <h1 className="mt-4 max-w-4xl text-balance font-semibold font-serif text-4xl leading-[1.04] tracking-[-0.035em] md:text-7xl">
              {post.title}
            </h1>
            {post.excerpt ? (
              <p className="mt-6 max-w-2xl text-black/55 text-lg leading-8">
                {post.excerpt}
              </p>
            ) : null}
            <div className="mt-8 flex flex-wrap items-center gap-3 text-black/45 text-xs">
              <span>{post.publisher.name}</span>
              <span aria-hidden>·</span>
              <time>{post.publishedAt?.toLocaleDateString(input.locale)}</time>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Clock3Icon className="size-3.5" /> {readingMinutes}
                {ko ? "분 읽기" : " min read"}
              </span>
              {post.sourceMeasuredAt ? (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    {input.locale.startsWith("ko") ? "측정 기준" : "Measured"}{" "}
                    {post.sourceMeasuredAt.toLocaleDateString(input.locale)}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </header>
        {post.coverImageUrl ? (
          <div className="mx-auto max-w-6xl px-6 pt-10">
            <Image
              // 🔴 alt 폴백을 제목으로 바꿨다 — 빈 alt 는 "장식용 이미지" 선언이라
              //   대표 이미지에 쓰면 스크린리더·이미지 검색이 내용을 알 수 없다(3차 리서치 §A).
              alt={post.coverImageAlt ?? post.title}
              className="aspect-[16/8] w-full rounded-sm object-cover"
              height={630}
              priority
              sizes="(min-width: 1024px) 1152px, 100vw"
              src={post.coverImageUrl}
              // 같은 오리진 이미지는 최적화(WebP/AVIF·리사이즈)를 태운다.
              // 외부 URL 은 `remotePatterns` 미등록 시 400 이 되므로 원본으로 둔다.
              unoptimized={REMOTE_IMAGE_RE.test(post.coverImageUrl)}
              width={1200}
            />
          </div>
        ) : null}
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-12 md:py-16 lg:grid-cols-[210px_minmax(0,720px)] lg:justify-center">
          {headings.length > 1 ? (
            <aside className="hidden lg:block">
              <nav
                aria-label={ko ? "목차" : "Table of contents"}
                className="sticky top-8 border-black/10 border-l pl-5"
              >
                <p className="mb-4 font-semibold text-[11px] text-black/40 uppercase tracking-[0.14em]">
                  {ko ? "이 글의 구성" : "In this article"}
                </p>
                <ol className="space-y-3">
                  {headings.map((heading, index) => (
                    <li key={heading.id}>
                      <a
                        className="text-black/45 text-xs leading-5 hover:text-[#d95f38]"
                        href={`#${heading.id}`}
                      >
                        {String(index + 1).padStart(2, "0")} · {heading.label}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </aside>
          ) : (
            <div className="hidden lg:block" />
          )}
          <div>
            <MarkdownArticle markdown={post.bodyMarkdown} />
            <footer className="mt-16 border-black/10 border-t pt-8 text-black/50 text-sm leading-6">
              {ko
                ? "이 글은 Findable의 측정 근거와 퍼블리셔 검수를 거쳐 발행되었습니다. 발행 후 같은 질문을 재측정해 변화를 확인합니다."
                : "This article was published from Findable measurement evidence and publisher review. The same prompts are measured again after publication."}
            </footer>
          </div>
        </div>
      </article>
      {related.length > 0 ? (
        <section className="border-black/10 border-t bg-[#ece6da] px-6 py-14 text-[#1f211f]">
          <div className="mx-auto max-w-5xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold font-serif text-3xl">
                {ko ? "이어 읽기" : "Continue reading"}
              </h2>
              <Link
                className="inline-flex items-center gap-2 text-[#d95f38] text-sm"
                href={`${prefix}/insights`}
              >
                {ko ? "전체 인사이트" : "All insights"}
                <ArrowRightIcon className="size-4" />
              </Link>
            </div>
            <div className="mt-8 grid gap-8 md:grid-cols-3">
              {related.map((item) => (
                <Link
                  className="group border-black/10 border-t pt-5"
                  href={`${prefix}/p/${item.publisher.slug}/${item.slug}`}
                  key={item.id}
                >
                  <p className="text-[11px] text-black/40 uppercase tracking-[0.12em]">
                    {item.publisher.name}
                  </p>
                  <h3 className="mt-3 font-semibold text-lg leading-snug group-hover:text-[#d95f38]">
                    {item.title}
                  </h3>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
