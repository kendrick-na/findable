import { createMetadata } from "@repo/seo/metadata";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  BarChart3Icon,
  BookOpenIcon,
  SearchIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { listPublishedContent } from "@/lib/content";

export const dynamic = "force-dynamic";
const TYPES = ["all", "research", "guide", "case_study", "analysis"] as const;
const TYPE_LABEL: Record<string, { en: string; ko: string }> = {
  all: { ko: "전체", en: "All" },
  research: { ko: "리서치", en: "Research" },
  guide: { ko: "실전 가이드", en: "Guides" },
  case_study: { ko: "사례", en: "Case studies" },
  analysis: { ko: "분석", en: "Analysis" },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const ko = locale.startsWith("ko");
  return createMetadata({
    title: ko
      ? "Findable 인사이트 — SEO·GEO 리서치"
      : "Findable Insights — SEO & GEO Research",
    description: ko
      ? "AI 검색 가시성 실측 데이터, SEO·GEO 연구 방법론과 브랜드 실행 가이드를 공개합니다."
      : "Measured AI-search visibility data, SEO and GEO research methods, and practical brand guides.",
    locale,
    pathname: "/insights",
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one server-rendered editorial composition keeps locale, filters, and empty states colocated.
export default async function PublicInsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const ko = locale.startsWith("ko");
  const prefix = ko ? "/ko" : "";
  const selectedType = TYPES.includes(query.type as (typeof TYPES)[number])
    ? (query.type ?? "all")
    : "all";
  const search = query.q?.trim().slice(0, 80) ?? "";
  const posts = await listPublishedContent(locale, undefined, {
    contentType: selectedType === "all" ? undefined : selectedType,
    query: search || undefined,
  });
  const featured = posts[0];
  const rest = featured ? posts.slice(1) : [];
  let emptyMessage = ko
    ? "첫 공식 인사이트를 최종 검수하고 있습니다."
    : "The first official insight is in final review.";
  if (search) {
    emptyMessage = ko
      ? `“${search}”에 맞는 발행 글이 없습니다.`
      : `No published articles match “${search}”.`;
  }

  return (
    <main className="min-h-screen bg-[#0b0c0d] text-[#f4f1e8]">
      <header className="border-white/10 border-b px-5 py-5 md:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6">
          <Link
            className="font-semibold tracking-[-0.03em]"
            href={`${prefix}/insights`}
          >
            Findable <span className="font-normal text-white/45">Insights</span>
          </Link>
          <nav
            aria-label={ko ? "인사이트 메뉴" : "Insights navigation"}
            className="flex items-center gap-5 text-sm text-white/55"
          >
            <a
              className="hidden transition-colors hover:text-white sm:block"
              href="#library"
            >
              {ko ? "리서치 라이브러리" : "Research library"}
            </a>
            <Link
              className="rounded-full border border-white/15 px-4 py-2 transition-colors hover:border-[#ff7a4d] hover:text-white"
              href={`${prefix}/contact`}
            >
              {ko ? "측정 문의" : "Talk to us"}
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden border-white/10 border-b px-5 py-20 md:px-8 md:py-28">
        <div className="pointer-events-none absolute inset-0 [background:linear-gradient(115deg,transparent_48%,rgba(255,122,77,.07)_48%,rgba(255,122,77,.07)_49%,transparent_49%),radial-gradient(circle_at_75%_20%,rgba(255,122,77,.13),transparent_26%)]" />
        <div className="relative mx-auto max-w-7xl">
          <p className="font-semibold text-[#ff7a4d] text-xs uppercase tracking-[0.22em]">
            Research for discoverability
          </p>
          <h1 className="mt-6 max-w-5xl text-balance font-semibold text-5xl leading-[0.98] tracking-[-0.055em] md:text-8xl">
            {ko
              ? "검색되고, 인용되는 브랜드를 연구합니다."
              : "Researching brands that get found and cited."}
          </h1>
          <div className="mt-9 grid max-w-5xl gap-6 border-white/10 border-t pt-7 md:grid-cols-[1fr_.5fr]">
            <p className="max-w-2xl text-pretty text-lg text-white/58 leading-8">
              {ko
                ? "Findable의 실측 데이터와 고객사의 현장 지식을 출처·방법론·측정일과 함께 공개합니다. 검색엔진과 AI가 이해하기 쉽고, 사람이 판단하기 좋은 형태로요."
                : "Findable publishes measured data and field knowledge with sources, methodology, and measurement dates—structured for search engines, AI systems, and human decisions."}
            </p>
            <div className="flex items-start gap-3 text-sm text-white/45 leading-6 md:justify-self-end">
              <BarChart3Icon className="mt-1 size-4 shrink-0 text-[#ff7a4d]" />
              <span>
                {ko
                  ? "원자료 · 반복 측정 · 한계 공개"
                  : "Raw data · repeat measures · disclosed limits"}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="sticky top-0 z-20 border-white/10 border-b bg-[#0b0c0d]/95 px-5 py-4 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <nav
            aria-label={ko ? "콘텐츠 분류" : "Content categories"}
            className="flex gap-1 overflow-x-auto"
          >
            {TYPES.map((type) => (
              <Link
                aria-current={selectedType === type ? "page" : undefined}
                className={`shrink-0 rounded-full px-4 py-2 text-sm transition-colors ${selectedType === type ? "bg-[#f4f1e8] text-[#111]" : "text-white/55 hover:bg-white/5 hover:text-white"}`}
                href={`${prefix}/insights${type === "all" ? "" : `?type=${type}`}`}
                key={type}
              >
                {TYPE_LABEL[type][ko ? "ko" : "en"]}
              </Link>
            ))}
          </nav>
          <search className="w-full lg:w-80">
            <form className="relative">
              {selectedType !== "all" ? (
                <input name="type" type="hidden" value={selectedType} />
              ) : null}
              <SearchIcon
                aria-hidden
                className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-white/35"
              />
              <label className="sr-only" htmlFor="insights-search">
                {ko ? "인사이트 검색" : "Search insights"}
              </label>
              <input
                className="h-11 w-full rounded-full border border-white/12 bg-white/[0.035] pr-4 pl-11 text-sm outline-none transition placeholder:text-white/30 focus:border-[#ff7a4d] focus:ring-2 focus:ring-[#ff7a4d]/20"
                defaultValue={search}
                id="insights-search"
                name="q"
                placeholder={
                  ko
                    ? "주제, 브랜드, 데이터 검색"
                    : "Search topics, brands, data"
                }
                type="search"
              />
            </form>
          </search>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-14 md:px-8 md:py-20">
        {featured ? (
          <>
            <article className="group grid overflow-hidden border-white/10 border-b pb-14 md:grid-cols-[1.15fr_.85fr] md:gap-14">
              <Link
                className="block"
                href={`${prefix}/p/${featured.publisher.slug}/${featured.slug}`}
              >
                {featured.coverImageUrl ? (
                  <Image
                    alt={featured.coverImageAlt ?? ""}
                    className="aspect-[16/9] w-full rounded-sm bg-white/5 object-cover"
                    height={675}
                    priority
                    src={featured.coverImageUrl}
                    unoptimized
                    width={1200}
                  />
                ) : (
                  <div className="flex aspect-[16/9] items-end overflow-hidden rounded-sm bg-[#151719] p-7 [background-size:auto,32px_32px,32px_32px] [background:linear-gradient(135deg,rgba(255,122,77,.22),transparent_45%),linear-gradient(to_right,rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.04)_1px,transparent_1px)]">
                    <span className="font-mono text-[#ff7a4d] text-xs uppercase tracking-[0.18em]">
                      Findable / {featured.contentType}
                    </span>
                  </div>
                )}
              </Link>
              <div className="mt-7 flex flex-col justify-between md:mt-0">
                <div>
                  <p className="font-semibold text-[#ff7a4d] text-xs uppercase tracking-[0.16em]">
                    {featured.series ||
                      TYPE_LABEL[featured.contentType]?.[ko ? "ko" : "en"]}{" "}
                    · {featured.publisher.name}
                  </p>
                  <Link
                    href={`${prefix}/p/${featured.publisher.slug}/${featured.slug}`}
                  >
                    <h2 className="mt-4 text-balance font-semibold text-3xl leading-[1.08] tracking-[-0.035em] transition-colors group-hover:text-[#ff9a78] md:text-5xl">
                      {featured.title}
                    </h2>
                  </Link>
                  <p className="mt-6 max-w-xl text-white/52 leading-7">
                    {featured.excerpt}
                  </p>
                </div>
                <div className="mt-8 flex items-center justify-between border-white/10 border-t pt-5 text-white/38 text-xs">
                  <time>
                    {featured.publishedAt?.toLocaleDateString(
                      ko ? "ko-KR" : "en-US"
                    )}
                  </time>
                  <ArrowUpRightIcon className="size-4" />
                </div>
              </div>
            </article>
            {rest.length > 0 ? (
              <div className="mt-14 grid gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
                {rest.map((post) => (
                  <article className="group" key={post.id}>
                    <p className="text-[#ff7a4d] text-[11px] uppercase tracking-[0.16em]">
                      {TYPE_LABEL[post.contentType]?.[ko ? "ko" : "en"]} ·{" "}
                      {post.publisher.name}
                    </p>
                    <Link
                      href={`${prefix}/p/${post.publisher.slug}/${post.slug}`}
                    >
                      <h2 className="mt-3 text-balance font-semibold text-2xl leading-tight tracking-[-0.025em] transition-colors group-hover:text-[#ff9a78]">
                        {post.title}
                      </h2>
                    </Link>
                    <p className="mt-4 line-clamp-3 text-sm text-white/48 leading-6">
                      {post.excerpt}
                    </p>
                  </article>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="border-white/10 border-b py-16 text-center">
            <p className="text-white/48">{emptyMessage}</p>
            {search || selectedType !== "all" ? (
              <Link
                className="mt-5 inline-flex items-center gap-2 text-[#ff9a78] text-sm"
                href={`${prefix}/insights`}
              >
                {ko ? "전체 보기" : "View all"}
                <ArrowRightIcon className="size-4" />
              </Link>
            ) : null}
          </div>
        )}
      </section>

      <section
        className="border-white/10 border-t bg-[#f2eee3] px-5 py-16 text-[#1b1d1c] md:px-8 md:py-24"
        id="library"
      >
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-6 md:grid-cols-[1fr_.8fr] md:items-end">
            <div>
              <p className="font-semibold text-[#d95f38] text-xs uppercase tracking-[0.18em]">
                Open research library
              </p>
              <h2 className="mt-4 text-balance font-semibold font-serif text-4xl tracking-[-0.035em] md:text-6xl">
                {ko
                  ? "리포트와 벤치마크는 한 서재에."
                  : "Reports and benchmarks, in one library."}
              </h2>
            </div>
            <p className="max-w-xl text-black/55 leading-7 md:justify-self-end">
              {ko
                ? "기존 K-뷰티 산업 리포트와 공개 벤치마크 URL은 검색 자산으로 보존하고, 앞으로의 분석은 인사이트 시리즈로 이어집니다."
                : "Legacy K-beauty reports and open benchmark URLs remain durable search assets; future analysis continues as an Insights series."}
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <Link
              className="group flex min-h-56 flex-col justify-between border border-black/12 bg-white/45 p-7 transition hover:-translate-y-1 hover:border-[#d95f38]"
              href={`${prefix}/report/k-beauty-geo-2026q2`}
            >
              <BookOpenIcon className="size-5 text-[#d95f38]" />
              <div>
                <p className="text-black/45 text-xs">
                  INDUSTRY REPORT · 2026 Q2
                </p>
                <h3 className="mt-3 font-semibold text-2xl tracking-tight">
                  K-뷰티 GEO 산업 리포트
                </h3>
                <p className="mt-3 text-black/50 text-sm leading-6">
                  {ko
                    ? "시장 관점의 핵심 신호와 브랜드 실행 과제"
                    : "Market signals and practical brand priorities"}
                </p>
              </div>
            </Link>
            <Link
              className="group flex min-h-56 flex-col justify-between border border-black/12 bg-[#1a1c1c] p-7 text-white transition hover:-translate-y-1 hover:border-[#ff7a4d]"
              href={`${prefix}/research/k-geo-bench-v0_1`}
            >
              <BarChart3Icon className="size-5 text-[#ff7a4d]" />
              <div>
                <p className="text-white/38 text-xs">OPEN DATA · CC BY 4.0</p>
                <h3 className="mt-3 font-semibold text-2xl tracking-tight">
                  K-GEO Bench v0.1
                </h3>
                <p className="mt-3 text-sm text-white/48 leading-6">
                  {ko
                    ? "재사용 가능한 원자료와 측정 방법론"
                    : "Reusable source data and measurement methodology"}
                </p>
              </div>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
