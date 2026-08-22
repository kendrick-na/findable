import { createMetadata } from "@repo/seo/metadata";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NewsletterSubscribe } from "@/components/content/newsletter-subscribe";
import { getPublicPublisher, listPublishedContent } from "@/lib/content";

export const dynamic = "force-dynamic";

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
  return createMetadata({
    title: publisher.name,
    description:
      publisher.description ??
      `${publisher.name} publisher profile on Findable`,
    locale,
    pathname: `/p/${publisherSlug}`,
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
  const prefix = locale.startsWith("ko") ? "/ko" : "";
  return (
    <main className="min-h-screen bg-[var(--findable-canvas)] text-[var(--findable-ink)]">
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
