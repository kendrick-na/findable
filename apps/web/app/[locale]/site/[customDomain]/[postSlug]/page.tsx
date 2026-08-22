import { JsonLd } from "@repo/seo/json-ld";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownArticle } from "@/components/content/markdown-article";
import { getPublishedContentByDomain } from "@/lib/content";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ customDomain: string; locale: string; postSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const input = await params;
  const post = await getPublishedContentByDomain(input);
  if (!post) {
    return {};
  }
  const prefix = input.locale === "ko" ? "" : `/${input.locale}`;
  return {
    title: post.seoTitle ?? post.title,
    description: post.seoDescription ?? post.excerpt,
    alternates: {
      canonical: `https://${input.customDomain}${prefix}/p/${post.slug}`,
    },
    robots: { index: true, follow: true },
  };
}

export default async function CustomArticlePage({ params }: Props) {
  const input = await params;
  const post = await getPublishedContentByDomain(input);
  if (!post) {
    notFound();
  }
  const prefix = input.locale === "ko" ? "" : `/${input.locale}`;
  const canonical = `https://${input.customDomain}${prefix}/p/${post.slug}`;
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
          author: { "@type": "Organization", name: post.publisher.name },
          publisher: { "@type": "Organization", name: post.publisher.name },
          inLanguage: input.locale,
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
        <div className="mt-12">
          <MarkdownArticle markdown={post.bodyMarkdown} />
        </div>
      </article>
    </main>
  );
}
