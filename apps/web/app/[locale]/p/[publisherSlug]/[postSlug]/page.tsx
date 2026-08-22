import { JsonLd } from "@repo/seo/json-ld";
import { createMetadata } from "@repo/seo/metadata";
import { ArrowLeftIcon, ArrowRightIcon, Clock3Icon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownArticle } from "@/components/content/markdown-article";
import { getPublishedContent, listRelatedContent } from "@/lib/content";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ locale: string; postSlug: string; publisherSlug: string }>;
}

const MARKDOWN_PUNCTUATION_RE = /[#*_>`[\]()|-]/g;
const WHITESPACE_RE = /\s+/;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const input = await params;
  const post = await getPublishedContent(input);
  if (!post) {
    return {};
  }
  return createMetadata({
    title: post.seoTitle ?? post.title,
    description:
      post.seoDescription ?? post.excerpt ?? post.bodyMarkdown.slice(0, 160),
    image: post.coverImageUrl ?? undefined,
    locale: input.locale,
    pathname: `/p/${input.publisherSlug}/${input.postSlug}`,
    robots: post.noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      type: "article",
      publishedTime: post.publishedAt?.toISOString(),
      authors: [post.publisher.name],
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
  const prefix = input.locale.startsWith("ko") ? "/ko" : "";
  const ko = input.locale.startsWith("ko");
  const canonical = `https://www.findable.co.kr${prefix}/p/${post.publisher.slug}/${post.slug}`;
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
          mainEntityOfPage: canonical,
          author: {
            "@type": "Organization",
            name: post.publisher.name,
            url: `https://www.findable.co.kr${prefix}/p/${post.publisher.slug}`,
          },
          publisher: { "@type": "Organization", name: "Findable" },
          image: post.coverImageUrl ?? undefined,
          articleSection: post.contentType,
          keywords: post.tags.join(", "),
          inLanguage: input.locale,
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
              item: `https://www.findable.co.kr${prefix}/p/${post.publisher.slug}`,
            },
            {
              "@type": "ListItem",
              position: 3,
              name: post.title,
              item: canonical,
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
              alt={post.coverImageAlt ?? ""}
              className="aspect-[16/8] w-full rounded-sm object-cover"
              height={630}
              priority
              src={post.coverImageUrl}
              unoptimized
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
