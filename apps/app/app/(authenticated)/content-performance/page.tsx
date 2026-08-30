import { Badge } from "@repo/design-system/components/ui/badge";
import { ArrowRightIcon, BarChart3Icon, ExternalLinkIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { contentPerformance } from "@/lib/content/performance";
import { requireOrg, scopedContents } from "@/lib/db/scoped";
import { Header } from "../components/header";

export const metadata: Metadata = {
  title: "콘텐츠 성과 · Findable",
  description: "발행한 콘텐츠의 SEO·GEO 준비도와 AI 인용 변화를 확인합니다.",
};

function score(value: number | null) {
  return value === null ? "—" : `${Math.round(value)}점`;
}

function percent(value: number) {
  return `${Math.round(value)}%`;
}

export default async function ContentPerformancePage() {
  const [orgId, contents] = await Promise.all([
    requireOrg(),
    scopedContents({ status: "published" }),
  ]);
  const rows = await Promise.all(
    contents.map((content) =>
      contentPerformance({ contentId: content.id, organizationId: orgId })
    )
  );
  const performanceById = new Map(
    rows.flatMap((row) => (row ? [[row.contentId, row] as const] : []))
  );
  const measurable = contents
    .map((content) => ({ content, performance: performanceById.get(content.id) }))
    .filter((row) => row.performance);
  const citedCount = measurable.filter((row) => row.performance?.citationDetected).length;
  const indexableCount = measurable.filter((row) => row.performance?.indexEligibility).length;

  return (
    <>
      <Header page="콘텐츠 성과" pages={["Findable"]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        <section className="relative overflow-hidden rounded-2xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-6 md:p-8">
          <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(135deg,rgba(255,122,77,.18),transparent_42%),linear-gradient(to_right,rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.035)_1px,transparent_1px)] [background-size:auto,28px_28px,28px_28px]" />
          <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <p className="font-semibold text-[11px] text-[color:var(--findable-primary,#ff7a4d)] uppercase tracking-[0.2em]">
                CONTENT PERFORMANCE
              </p>
              <h1 className="mt-3 text-balance font-semibold text-3xl text-[color:var(--findable-ink,#f7f8f8)] tracking-tight md:text-5xl">
                발행한 콘텐츠가 검색되고 인용되는지 확인하세요.
              </h1>
              <p className="mt-4 max-w-xl text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-7">
                글별 SEO·GEO 준비도, 색인 가능 여부, AI 답변에서의 인용 감지와
                발행 전후 측정 변화를 실제 데이터로 보여줍니다.
              </p>
            </div>
            <Link
              className="inline-flex items-center gap-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm hover:text-white"
              href="/insights"
            >
              콘텐츠 관리 <ArrowRightIcon className="size-4" />
            </Link>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="findable-card p-5">
            <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">공개 콘텐츠</p>
            <p className="mt-2 font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tabular-nums">
              {contents.length}
            </p>
          </div>
          <div className="findable-card p-5">
            <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">색인 가능</p>
            <p className="mt-2 font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tabular-nums">
              {indexableCount}/{measurable.length}
            </p>
          </div>
          <div className="findable-card p-5">
            <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">AI 인용 감지</p>
            <p className="mt-2 font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tabular-nums">
              {citedCount}/{measurable.length}
            </p>
          </div>
        </section>

        {contents.length === 0 ? (
          <section className="findable-card flex min-h-64 flex-col items-center justify-center p-8 text-center">
            <BarChart3Icon className="size-7 text-[color:var(--findable-primary,#ff7a4d)]" />
            <h2 className="mt-4 font-semibold text-lg">아직 공개된 콘텐츠가 없습니다.</h2>
            <p className="mt-2 max-w-md text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-6">
              콘텐츠를 발행하면 이곳에서 SEO·GEO 성과를 확인할 수 있습니다.
            </p>
            <Link className="findable-btn-primary mt-5 rounded-md px-4 py-2 text-sm" href="/insights">
              콘텐츠 만들기
            </Link>
          </section>
        ) : (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)]">글별 성과</h2>
                <p className="mt-1 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                  AI 인용은 발행 후 새로 수행된 추적 응답에서 해당 글 URL이 출처로 감지된 경우입니다.
                </p>
              </div>
              <Link className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm hover:text-white" href="/site-audit/integrations">
                검색 데이터 연결 <ExternalLinkIcon className="ml-1 inline size-3.5" />
              </Link>
            </div>
            {contents.map((content) => {
              const performance = performanceById.get(content.id);
              return (
                <article className="findable-card grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center" key={content.id}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="border-emerald-400/20 bg-emerald-400/10 text-emerald-300" variant="outline">공개됨</Badge>
                      <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">{content.publisher.name} · {content.locale.toUpperCase()}</span>
                    </div>
                    <h3 className="mt-3 truncate font-medium text-[color:var(--findable-ink,#f7f8f8)]">{content.title}</h3>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <div><p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">SEO·GEO 준비도</p><p className="mt-1 font-medium">{performance ? percent(performance.optimizationReadiness) : "—"}</p></div>
                      <div><p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">브랜드 GEO 변화</p><p className="mt-1 font-medium">{performance?.scoreDelta === null || performance?.scoreDelta === undefined ? score(performance?.currentScore ?? null) : `${performance.scoreDelta > 0 ? "+" : ""}${Math.round(performance.scoreDelta)}점`}</p></div>
                      <div><p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">색인</p><p className="mt-1 font-medium">{performance?.indexEligibility ? "가능" : "확인 필요"}</p></div>
                      <div><p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">AI 인용</p><p className="mt-1 font-medium">{performance?.citationDetected ? "감지" : "미감지"}</p></div>
                    </div>
                  </div>
                  <Link className="inline-flex items-center justify-center gap-2 text-[color:var(--findable-primary,#ff7a4d)] text-sm hover:underline" href={`/insights/${content.id}`}>
                    상세 보기 <ArrowRightIcon className="size-4" />
                  </Link>
                </article>
              );
            })}
          </section>
        )}

        <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs leading-5">
          현재 화면은 콘텐츠 품질·색인·AI 인용 신호를 제공합니다. 브랜드 GEO 변화는 발행 전후 브랜드 측정값의 차이로, 글 하나의 인과 효과를 뜻하지 않습니다. Google Search Console·GA4·네이버의 검색 유입 수치는 별도 연결 후 사이트 단위로 확인합니다.
        </p>
      </div>
    </>
  );
}
