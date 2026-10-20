import { ArrowRight } from "lucide-react";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { listPublishedContent } from "@/lib/content";

interface HomeInsightsProps {
  locale?: string;
}

// 공개 홈에서는 게시글 목록이 매 방문마다 DB 응답을 기다릴 이유가 없다.
// 콘텐츠 발행은 ISR 재검증으로 반영하고, 첫 화면은 CDN에서 즉시 제공한다.
const getHomeInsights = unstable_cache(
  async (locale: string) =>
    (await listPublishedContent(locale, "findable")).slice(0, 3),
  ["landing-insights"],
  { revalidate: 1800 }
);

/**
 * 랜딩의 "사례"를 임의의 고객 로고로 채우지 않는다.
 * 공개한 측정·방법론·벤치마크를 실제 글로 연결해 검색엔진, AI, 방문자가 같은
 * 근거를 확인하도록 만든 콘텐츠 허브다.
 */
export const HomeInsights = async ({ locale = "ko" }: HomeInsightsProps) => {
  const isKo = locale.startsWith("ko");
  const prefix = isKo ? "/ko" : "/en";
  const posts = await getHomeInsights(locale);

  return (
    <section
      className="border-[var(--findable-hairline)] border-y bg-[var(--findable-surface-1)] py-16 md:py-20"
      id="insights"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col justify-between gap-7 border-[var(--findable-hairline)] border-b pb-8 md:flex-row md:items-end">
          <div>
            <p
              className="text-[11px] text-[var(--findable-primary)] uppercase tracking-[0.18em]"
              style={{ fontFamily: "var(--findable-font-mono)" }}
            >
              Findable Insights
            </p>
            <h2
              className="mt-3 text-balance text-[30px] text-[var(--findable-ink)] leading-[1.15] md:text-[42px]"
              style={{
                fontFamily: isKo
                  ? "var(--findable-font-display-kr)"
                  : "var(--findable-font-display)",
                fontWeight: 500,
              }}
            >
              {isKo
                ? "주장 대신, 공개한 측정과 글로 증명합니다."
                : "Proof lives in the research we publish."}
            </h2>
          </div>
          <Link
            className="inline-flex items-center gap-2 text-[14px] text-[var(--findable-ink-muted)] transition hover:text-[var(--findable-primary)]"
            href={`${prefix}/insights`}
          >
            {isKo ? "인사이트 전체 보기" : "Browse all insights"}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {posts.length > 0 ? (
          <div className="grid divide-y divide-[var(--findable-hairline)] md:grid-cols-3 md:divide-x md:divide-y-0">
            {posts.map((post) => (
              <article
                className="group py-7 md:px-7 md:last:pr-0 md:first:pl-0"
                key={post.id}
              >
                <p
                  className="text-[11px] text-[var(--findable-primary)] uppercase tracking-[0.14em]"
                  style={{ fontFamily: "var(--findable-font-mono)" }}
                >
                  {post.series ?? post.contentType.replaceAll("_", " ")}
                </p>
                <h3
                  className="mt-3 text-[19px] text-[var(--findable-ink)] leading-[1.35] transition group-hover:text-[var(--findable-primary)]"
                  style={{
                    fontFamily: "var(--findable-font-sans)",
                    fontWeight: 600,
                  }}
                >
                  <Link
                    href={`${prefix}/p/${post.publisher.slug}/${post.slug}`}
                  >
                    {post.title}
                  </Link>
                </h3>
                <p className="mt-3 line-clamp-3 text-[14px] text-[var(--findable-ink-muted)] leading-6">
                  {post.excerpt}
                </p>
                <Link
                  className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-[var(--findable-ink-subtle)] transition group-hover:text-[var(--findable-ink)]"
                  href={`${prefix}/p/${post.publisher.slug}/${post.slug}`}
                >
                  {isKo ? "원문과 방법론 보기" : "Read the source and method"}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="py-8 text-[14px] text-[var(--findable-ink-muted)]">
            {isKo
              ? "첫 공개 리서치를 준비 중입니다. K-GEO-Bench 데이터셋과 방법론을 먼저 확인해 보세요."
              : "Our first public research is in progress. Start with the K-GEO-Bench dataset and methodology."}
          </div>
        )}
      </div>
    </section>
  );
};
