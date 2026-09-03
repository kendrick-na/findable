import { JsonLd } from "@repo/seo/json-ld";
import { createMetadata } from "@repo/seo/metadata";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer } from "../../components/footer";
import { PublicLandingHeader } from "../../components/public-landing-header";
import { FooterCTA } from "../../(home)/components/footer-cta";

const TERMS = {
  seo: {
    title: "SEO란 무엇인가",
    lead: "SEO(Search Engine Optimization)는 검색엔진이 웹페이지를 발견하고 이해하도록 돕고, 검색 결과에서 적절한 사용자에게 노출되도록 개선하는 방법이다.",
    sections: [
      [
        "무엇을 해결하는가",
        "사용자가 검색하는 질문과 페이지의 내용이 정확히 연결되도록 웹사이트의 정보와 기술 구조를 개선한다.",
      ],
      [
        "무엇을 최적화하는가",
        "페이지의 내용과 제목, 구조, 링크, 이미지, 기술적 접근성을 개선한다.",
      ],
      [
        "어떻게 측정하는가",
        "검색 노출, 클릭, 유입 검색어, 색인 상태와 전환을 함께 확인한다.",
      ],
      [
        "간단한 예시",
        "‘AI 검색 최적화 방법’이라는 질문을 다룬다면 페이지 제목, 본문 구조, 관련 용어와 출처를 해당 질문에 맞게 구성한다.",
      ],
    ],
  },
  geo: {
    title: "GEO란 무엇인가",
    lead: "GEO(Generative Engine Optimization)는 생성형 AI 서비스가 브랜드나 주제에 답변할 때 특정 콘텐츠를 발견하고 설명·인용하도록 정보를 구성하는 방법이다.",
    sections: [
      [
        "SEO와의 차이",
        "SEO가 검색 결과의 노출과 클릭을 주로 다룬다면, GEO는 AI 답변의 언급·설명·출처를 함께 살핀다.",
      ],
      [
        "무엇을 최적화하는가",
        "AI가 읽고 요약하기 쉬운 사실 정보, 설명 구조, 출처 연결, 작성 주체와 최신성을 명확하게 만든다.",
      ],
      [
        "어떻게 측정하는가",
        "동일한 질문을 반복 제시해 브랜드 언급 여부, 답변 내용, 인용 출처와 변화 추이를 기록한다.",
      ],
      [
        "간단한 예시",
        "같은 브랜드 질문을 여러 AI 서비스에 제시하고, 브랜드가 언급됐는지와 어떤 페이지가 출처로 인용됐는지를 비교한다.",
      ],
    ],
  },
  aeo: {
    title: "AEO란 무엇인가",
    lead: "AEO(Answer Engine Optimization)는 검색엔진과 답변 엔진이 사용자의 질문에 대한 답변으로 콘텐츠를 선택하고 제시하도록 최적화하는 방법이다.",
    sections: [
      [
        "핵심 원칙",
        "질문 의도에 맞는 직접적인 답변을 제공하고, 제목·소제목·FAQ로 정보 구조를 명확하게 만든다.",
      ],
      [
        "SEO와의 차이",
        "SEO는 검색 결과 전반의 발견과 순위를 다루고, AEO는 질문에 대한 답변으로 선택될 수 있는 정보 표현에 집중한다.",
      ],
      [
        "GEO와의 관계",
        "AEO는 답변 선택 전반을 다루며, GEO는 생성형 AI 답변에서의 발견과 인용에 특히 초점을 둔다.",
      ],
      [
        "간단한 예시",
        "‘GEO와 SEO의 차이는?’라는 질문에 한 문단 안에서 핵심 답변을 먼저 제시하고, 이어서 근거와 관련 링크를 제공한다.",
      ],
    ],
  },
  "ai-search-visibility": {
    title: "AI 검색 가시성이란 무엇인가",
    lead: "AI 검색 가시성은 생성형 AI 답변에서 브랜드나 콘텐츠가 얼마나 자주 언급되고, 어떤 맥락과 출처로 제시되는지를 나타내는 개념이다.",
    sections: [
      [
        "주요 지표",
        "브랜드 언급률, 답변 내 위치, 설명의 정확성, 인용 출처와 질문별 편차를 활용할 수 있다.",
      ],
      [
        "측정 단위",
        "브랜드·제품·주제별 질문 세트를 만들고, AI 서비스·모델·시점별 결과를 같은 조건에서 비교한다.",
      ],
      [
        "주의할 점",
        "한 번의 답변만으로 판단하지 않고 질문·모델·시점별로 반복 측정해야 한다.",
      ],
      [
        "SEO와의 관계",
        "검색 순위가 높아도 AI 답변에 반드시 언급되는 것은 아니므로 검색 노출과 AI 답변 노출을 별도 지표로 관리한다.",
      ],
    ],
  },
} as const;

type TermSlug = keyof typeof TERMS;

export function generateStaticParams() {
  return ["ko", "en"].flatMap((locale) =>
    Object.keys(TERMS).map((slug) => ({ locale, slug }))
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const term = TERMS[slug as TermSlug];
  if (!term) {
    return {};
  }
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
  const term = TERMS[slug as TermSlug];
  if (!term) {
    notFound();
  }
  const prefix = locale.startsWith("ko") ? "/ko" : "";

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
              name: "Findable 검색·AI 가이드",
              url: `https://www.findable.co.kr${prefix}/glossary`,
            },
          }}
        />
        <Link
          className="text-sm text-white/55 hover:text-white"
          href={`${prefix}/glossary`}
        >
          ← 검색·AI 가이드
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
          <h2 className="font-semibold text-2xl">자주 묻는 질문</h2>
          <div className="mt-5 divide-y divide-white/10 border-white/10 border-y">
            <details className="py-4">
              <summary className="cursor-pointer font-medium">
                이 용어는 SEO와 같은 의미인가?
              </summary>
              <p className="mt-3 text-white/60 leading-7">
                서로 연결되어 있지만 동일하지 않다. SEO는 검색엔진 결과를, GEO와
                AEO는 AI·답변형 검색에서 정보가 선택되고 제시되는 과정을 더
                직접적으로 다룬다.
              </p>
            </details>
            <details className="py-4">
              <summary className="cursor-pointer font-medium">
                한 번의 검색 결과로 노출 여부를 판단해도 되는가?
              </summary>
              <p className="mt-3 text-white/60 leading-7">
                어렵다. 질문 표현, AI 서비스, 모델, 시점에 따라 답변이 달라질 수
                있으므로 동일한 질문 세트를 반복 측정해야 한다.
              </p>
            </details>
          </div>
        </section>
        <p className="mt-16 border-white/10 border-t pt-6 text-sm text-white/45">
          더 많은 측정 방법과 사례는{" "}
          <Link className="text-[#ff7a4d]" href={`${prefix}/insights`}>
            Findable 인사이트
          </Link>
          에서 확인할 수 있다.
        </p>
      </article>
      <FooterCTA locale={locale} />
      <Footer locale={locale} />
    </main>
  );
}
