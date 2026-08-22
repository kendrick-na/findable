import Link from "next/link";
import { notFound } from "next/navigation";
import { NewsletterSubscribe } from "@/components/content/newsletter-subscribe";
import {
  getPublicPublisherByDomain,
  listPublishedContent,
} from "@/lib/content";

export const dynamic = "force-dynamic";

export default async function CustomPublisherPage({
  params,
}: {
  params: Promise<{ customDomain: string; locale: string }>;
}) {
  const { customDomain, locale } = await params;
  const publisher = await getPublicPublisherByDomain(customDomain);
  if (!publisher) {
    notFound();
  }
  const posts = await listPublishedContent(locale, publisher.slug);
  const prefix = locale === "ko" ? "" : `/${locale}`;
  return (
    <main className="min-h-screen bg-[#f5f1e8] text-[#1f211f]">
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
