import { JsonLd } from "@repo/seo/json-ld";
import { createMetadata } from "@repo/seo/metadata";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  GLOSSARY_EN as EN_TERMS,
  GLOSSARY_RELATED,
  GLOSSARY_SLUGS,
  type GlossarySlug,
  GLOSSARY_KO as TERMS,
} from "@/lib/glossary";
import { FooterCTA } from "../../(home)/components/footer-cta";
import { PublicLandingHeader } from "../../components/public-landing-header";

/**
 * 용어 데이터는 `lib/glossary.ts` 한 곳에 있다(2026-10-15).
 * 용어마다 고유한 설명·FAQ·관련 용어를 가진다 — 예전엔 모든 용어 페이지가 같은 FAQ 2개를
 * 반복했고 본문이 짧아 구글이 "크롤링됨-색인 안 함"으로 보류했다.
 */
const isTermSlug = (slug: string): slug is GlossarySlug =>
  (GLOSSARY_SLUGS as readonly string[]).includes(slug);

export function generateStaticParams() {
  return ["ko", "en"].flatMap((locale) =>
    GLOSSARY_SLUGS.map((slug) => ({ locale, slug }))
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isTermSlug(slug)) {
    return {};
  }
  const term = (locale.startsWith("ko") ? TERMS : EN_TERMS)[slug];
  return createMetadata({
    title: `${term.title} | Findable`,
    description: term.lead,
    locale,
    pathname: `/glossary/${slug}`,
  });
}

export default async function GlossaryTermPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const ko = locale.startsWith("ko");
  if (!isTermSlug(slug)) {
    notFound();
  }
  const terms = ko ? TERMS : EN_TERMS;
  const term = terms[slug];
  const prefix = ko ? "/ko" : "/en";
  const related = GLOSSARY_RELATED[slug];

  return (
    <main className="min-h-screen bg-[#0b0c0d] text-[#f4f1e8]">
      <PublicLandingHeader locale={locale} />
      <article className="mx-auto max-w-3xl px-5 py-16 md:px-8 md:py-24">
        <JsonLd
          code={{
            "@context": "https://schema.org",
            "@type": "DefinedTerm",
            name: term.title,
            description: term.lead,
            inDefinedTermSet: {
              "@type": "DefinedTermSet",
              name: ko
                ? "Findable 검색·AI 가이드"
                : "Findable search and AI guide",
              url: `https://www.findable.co.kr${prefix}/glossary`,
            },
          }}
        />
        <JsonLd
          code={{
            "@context": "https://schema.org",
            "@type": "FAQPage",
            inLanguage: ko ? "ko" : "en",
            mainEntity: term.faqs.map(([question, answer]) => ({
              "@type": "Question",
              name: question,
              acceptedAnswer: { "@type": "Answer", text: answer },
            })),
          }}
        />
        <Link
          className="text-sm text-white/55 hover:text-white"
          href={`${prefix}/glossary`}
        >
          ← {ko ? "검색·AI 가이드" : "Search and AI guide"}
        </Link>
        <p className="mt-16 font-semibold text-[#ff7a4d] text-xs uppercase tracking-[0.22em]">
          Findable glossary
        </p>
        <h1 className="mt-5 font-semibold text-5xl tracking-[-0.05em] md:text-7xl">
          {term.title}
        </h1>
        <p className="mt-8 border-white/10 border-b pb-10 text-white/70 text-xl leading-9">
          {term.lead}
        </p>
        <div className="mt-10 space-y-10">
          {term.sections.map(([heading, body]) => (
            <section key={heading}>
              <h2 className="font-semibold text-2xl">{heading}</h2>
              <p className="mt-3 text-white/60 leading-8">{body}</p>
            </section>
          ))}
        </div>
        <section className="mt-16 border-white/10 border-t pt-10">
          <h2 className="font-semibold text-2xl">
            {ko ? "자주 묻는 질문" : "Frequently asked questions"}
          </h2>
          <div className="mt-5 divide-y divide-white/10 border-white/10 border-y">
            {term.faqs.map(([question, answer]) => (
              <details className="py-4" key={question}>
                <summary className="cursor-pointer font-medium">
                  {question}
                </summary>
                <p className="mt-3 text-white/60 leading-7">{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="mt-16 border-white/10 border-t pt-10">
          <h2 className="font-semibold text-2xl">
            {ko ? "관련 용어" : "Related terms"}
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {related.map((relatedSlug) => (
              <Link
                className="border border-white/10 p-4 text-sm text-white/75 transition-colors hover:border-[#ff7a4d] hover:text-white"
                href={`${prefix}/glossary/${relatedSlug}`}
                key={relatedSlug}
              >
                {terms[relatedSlug].title}
                <span className="ml-2 text-[#ff7a4d]">→</span>
              </Link>
            ))}
          </div>
        </section>
        <p className="mt-16 border-white/10 border-t pt-6 text-sm text-white/45">
          {ko
            ? "더 많은 측정 방법과 사례는 "
            : "For more measurement methods and case studies, visit "}
          <Link className="text-[#ff7a4d]" href={`${prefix}/insights`}>
            {ko ? "Findable 인사이트" : "Findable insights"}
          </Link>
          {ko ? "에서 확인할 수 있다." : "."}
        </p>
      </article>
      <FooterCTA locale={locale} />
    </main>
  );
}
