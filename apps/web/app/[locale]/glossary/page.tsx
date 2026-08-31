import { createMetadata } from "@repo/seo/metadata";
import type { Metadata } from "next";
import Link from "next/link";

const TERMS = [
  {
    slug: "seo",
    title: "SEO란 무엇인가",
    description:
      "검색엔진이 웹페이지를 발견하고 이해하도록 돕는 최적화의 기본 개념.",
  },
  {
    slug: "geo",
    title: "GEO란 무엇인가",
    description: "생성형 AI 답변에서 브랜드와 콘텐츠가 발견되고 인용되는 구조.",
  },
  {
    slug: "aeo",
    title: "AEO란 무엇인가",
    description:
      "검색엔진과 답변 엔진이 질문에 대한 콘텐츠를 선택하도록 돕는 방법.",
  },
  {
    slug: "ai-search-visibility",
    title: "AI 검색 가시성이란 무엇인가",
    description:
      "AI 답변에서 브랜드가 언급·설명·인용되는 정도를 측정하는 개념.",
  },
] as const;

const COMPARISON = [
  ["SEO", "검색 결과", "페이지 순위·클릭·오가닉 트래픽"],
  ["AEO", "질문 답변", "질문 의도에 맞는 직접 답변 채택"],
  ["GEO", "생성형 AI", "브랜드 언급·설명·출처 인용"],
  ["AI 검색 가시성", "AI 답변", "질문별 노출과 답변 품질의 관찰 지표"],
] as const;

const FAQS = [
  [
    "SEO와 GEO의 차이는 무엇인가요?",
    "SEO는 검색 결과의 순위와 클릭을, GEO는 생성형 AI 답변에서의 브랜드 언급과 출처 인용을 다룹니다. 같은 콘텐츠라도 두 채널에서 성과가 다를 수 있습니다.",
  ],
  [
    "GEO는 어떻게 측정하나요?",
    "고객이 실제로 묻는 질문을 정한 뒤 AI 서비스별 답변을 반복 수집하고, 브랜드 언급률·설명 정확도·출처 인용률을 비교합니다.",
  ],
  [
    "검색·AI 가이드가 검색 노출에 도움이 되나요?",
    "명확한 정의, 관련 용어 간 연결, 실제 질문에 답하는 문장을 제공하면 검색엔진과 답변 엔진이 주제를 이해하는 데 도움이 됩니다. 결과를 보장하는 방식은 아닙니다.",
  ],
] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const ko = locale.startsWith("ko");
  return createMetadata({
    title: ko
      ? "SEO·GEO·AEO 검색·AI 가이드 | Findable"
      : "Findable search and AI visibility guide",
    description: ko
      ? "SEO, GEO, AEO와 AI 검색 가시성의 핵심 개념을 쉽게 설명합니다."
      : "A practical glossary for SEO, GEO, AEO and AI search visibility.",
    locale,
    pathname: "/glossary",
  });
}

export default async function GlossaryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ko = locale.startsWith("ko");
  const prefix = ko ? "/ko" : "";

  return (
    <main className="min-h-screen bg-[#0b0c0d] px-5 py-16 text-[#f4f1e8] md:px-8 md:py-24">
      <div className="mx-auto max-w-4xl">
        <Link
          className="text-sm text-white/55 hover:text-white"
          href={prefix || "/"}
        >
          ← {ko ? "홈" : "Home"}
        </Link>
        <p className="mt-16 font-semibold text-[#ff7a4d] text-xs uppercase tracking-[0.22em]">
          Findable knowledge hub
        </p>
        <h1 className="mt-5 font-semibold text-5xl tracking-[-0.05em] md:text-7xl">
          {ko
            ? "검색·AI 가이드"
            : "A guide to search and AI visibility"}
        </h1>
        <p className="mt-7 max-w-2xl text-lg text-white/58 leading-8">
          {ko
            ? "SEO, GEO, AEO와 AI 검색 가시성을 사람들이 실제로 묻는 질문, 비교표, 측정 방법, 실행 순서로 정리합니다."
            : "SEO, GEO, AEO and AI search visibility explained through real questions, comparisons, measurement, and action steps."}
        </p>
        <div className="mt-14 grid gap-4 sm:grid-cols-2">
          {TERMS.map((term) => (
            <Link
              className="rounded-sm border border-white/10 p-6 transition-colors hover:border-[#ff7a4d]"
              href={`${prefix}/glossary/${term.slug}`}
              key={term.slug}
            >
              <h2 className="font-semibold text-xl">{term.title}</h2>
              <p className="mt-3 text-sm text-white/55 leading-6">
                {term.description}
              </p>
            </Link>
          ))}
        </div>
        <section className="mt-20">
          <h2 className="font-semibold text-2xl">
            {ko ? "먼저 찾는 질문" : "Questions people ask first"}
          </h2>
          <p className="mt-3 max-w-2xl text-sm text-white/55 leading-6">
            {ko
              ? "검색 순위와 AI 답변 노출을 개선할 때 가장 먼저 확인하는 질문을 주제별 가이드로 연결합니다."
              : "Start with practical questions about search rankings and AI answer visibility."}
          </p>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {[
              ["SEO와 GEO의 차이는 무엇인가요?", "geo"],
              ["AI 검색에 브랜드가 인용되지 않는 이유는?", "ai-search-visibility"],
              ["AEO는 어떻게 시작하나요?", "aeo"],
              ["검색 노출과 AI 노출을 어떻게 함께 측정하나요?", "seo"],
            ].map(([question, slug]) => (
              <Link
                className="border border-white/10 p-5 text-sm text-white/75 transition-colors hover:border-[#ff7a4d] hover:text-white"
                href={`${prefix}/glossary/${slug}`}
                key={question}
              >
                {question} <span className="ml-2 text-[#ff7a4d]">→</span>
              </Link>
            ))}
          </div>
        </section>
        <section className="mt-20">
          <h2 className="font-semibold text-2xl">SEO·AEO·GEO 한눈에 비교</h2>
          <p className="mt-3 max-w-2xl text-sm text-white/55 leading-6">
            최적화 대상과 측정 지표가 다르므로, 하나의 순위로 모든 검색 노출을
            판단하면 안 됩니다.
          </p>
          <div className="mt-6 overflow-x-auto border border-white/10">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-white/[0.04] text-white/60">
                <tr>
                  <th className="px-4 py-3">개념</th>
                  <th className="px-4 py-3">주요 표면</th>
                  <th className="px-4 py-3">핵심 관찰 지표</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(([term, surface, metric]) => (
                  <tr className="border-t border-white/10" key={term}>
                    <th className="px-4 py-4 font-medium">{term}</th>
                    <td className="px-4 py-4 text-white/65">{surface}</td>
                    <td className="px-4 py-4 text-white/65">{metric}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="mt-20">
          <h2 className="font-semibold text-2xl">자주 묻는 질문</h2>
          <div className="mt-6 space-y-3">
            {FAQS.map(([question, answer]) => (
              <details className="border border-white/10 p-5" key={question}>
                <summary className="cursor-pointer font-medium">
                  {question}
                </summary>
                <p className="mt-3 text-sm text-white/60 leading-6">{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="mt-20 border-t border-white/10 pt-8">
          <p className="text-sm text-white/45">더 자세히 읽기</p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <Link
              className="text-[#ff7a4d] hover:underline"
              href={`${prefix}/insights`}
            >
              Findable 인사이트
            </Link>
          </div>
        </section>
        <script
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: FAQS.map(([question, answer]) => ({
                "@type": "Question",
                name: question,
                acceptedAnswer: { "@type": "Answer", text: answer },
              })),
            }),
          }}
        />
      </div>
    </main>
  );
}
