import { searchSamplingBlockedCopy } from "@repo/audit/search-sampling-version";
import { Badge } from "@repo/design-system/components/ui/badge";
import { ArrowRightIcon, BarChart3Icon, ExternalLinkIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { contentPerformance } from "@/lib/content/performance";
import { requireOrg, scopedContents } from "@/lib/db/scoped";
import { type AppDictionary, getAppDictionary, getAppLocale } from "@/lib/i18n";
import { Header } from "../components/header";

type PerformanceLabels = AppDictionary["contentPerformance"];

export const generateMetadata = async (): Promise<Metadata> => {
  const t = (await getAppDictionary()).contentPerformance;
  return { title: t.metaTitle, description: t.metaDescription };
};

function score(value: number | null, t: PerformanceLabels) {
  return value === null
    ? "—"
    : t.points.replace("{n}", String(Math.round(value)));
}

function geoChangeText(
  performance: Awaited<ReturnType<typeof contentPerformance>> | undefined,
  t: PerformanceLabels,
  isKo: boolean
) {
  if (performance?.scoreComparisonBlocked) {
    // W1 정책: 네이버 검색 표본 방식이 바뀐 두 회차의 GEO 점수는 비교하지 않는다.
    return searchSamplingBlockedCopy(isKo);
  }
  if (
    performance?.scoreDelta === null ||
    performance?.scoreDelta === undefined
  ) {
    return score(performance?.currentScore ?? null, t);
  }
  return `${performance.scoreDelta > 0 ? "+" : ""}${t.points.replace(
    "{n}",
    String(Math.round(performance.scoreDelta))
  )}`;
}

function percent(value: number) {
  return `${Math.round(value)}%`;
}

export default async function ContentPerformancePage() {
  const [orgId, contents, dict, locale] = await Promise.all([
    requireOrg(),
    scopedContents({ status: "published" }),
    getAppDictionary(),
    getAppLocale(),
  ]);
  const t = dict.contentPerformance;
  const isKo = locale === "ko";
  const rows = await Promise.all(
    contents.map((content) =>
      contentPerformance({ contentId: content.id, organizationId: orgId })
    )
  );
  const performanceById = new Map(
    rows.flatMap((row) => (row ? [[row.contentId, row] as const] : []))
  );
  const measurable = contents
    .map((content) => ({
      content,
      performance: performanceById.get(content.id),
    }))
    .filter((row) => row.performance);
  const citedCount = measurable.filter(
    (row) => row.performance?.citationDetected
  ).length;
  const indexableCount = measurable.filter(
    (row) => row.performance?.indexEligibility
  ).length;

  return (
    <>
      <Header page={t.title} pages={["Findable"]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        <section className="relative overflow-hidden rounded-2xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-6 md:p-8">
          <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(135deg,rgba(255,122,77,.18),transparent_42%),linear-gradient(to_right,rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.035)_1px,transparent_1px)] [background-size:auto,28px_28px,28px_28px]" />
          <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <p className="font-semibold text-[11px] text-[color:var(--findable-primary,#ff7a4d)] uppercase tracking-[0.2em]">
                CONTENT PERFORMANCE
              </p>
              <h1 className="mt-3 text-balance font-semibold text-3xl text-[color:var(--findable-ink,#f7f8f8)] tracking-tight md:text-5xl">
                {t.heroTitle}
              </h1>
              <p className="mt-4 max-w-xl text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-7">
                {t.heroBody}
              </p>
            </div>
            <Link
              className="inline-flex items-center gap-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm hover:text-white"
              href="/insights"
            >
              {t.manage} <ArrowRightIcon className="size-4" />
            </Link>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="findable-card p-5">
            <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
              {t.statPublic}
            </p>
            <p className="mt-2 font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tabular-nums">
              {contents.length}
            </p>
          </div>
          <div className="findable-card p-5">
            <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
              {t.statIndexable}
            </p>
            <p className="mt-2 font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tabular-nums">
              {indexableCount}/{measurable.length}
            </p>
          </div>
          <div className="findable-card p-5">
            <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
              {t.statCited}
            </p>
            <p className="mt-2 font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tabular-nums">
              {citedCount}/{measurable.length}
            </p>
          </div>
        </section>

        {contents.length === 0 ? (
          <section className="findable-card flex min-h-64 flex-col items-center justify-center p-8 text-center">
            <BarChart3Icon className="size-7 text-[color:var(--findable-primary,#ff7a4d)]" />
            <h2 className="mt-4 font-semibold text-lg">{t.emptyTitle}</h2>
            <p className="mt-2 max-w-md text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-6">
              {t.emptyBody}
            </p>
            <Link
              className="findable-btn-primary mt-5 rounded-md px-4 py-2 text-sm"
              href="/insights"
            >
              {t.create}
            </Link>
          </section>
        ) : (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)]">
                  {t.perPost}
                </h2>
                <p className="mt-1 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                  {t.citationNote}
                </p>
              </div>
              <Link
                className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm hover:text-white"
                href="/site-audit/integrations"
              >
                {t.connectData}{" "}
                <ExternalLinkIcon className="ml-1 inline size-3.5" />
              </Link>
            </div>
            {contents.map((content) => {
              const performance = performanceById.get(content.id);
              return (
                <article
                  className="findable-card grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                  key={content.id}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        className="border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                        variant="outline"
                      >
                        {t.published}
                      </Badge>
                      <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                        {content.publisher.name} ·{" "}
                        {content.locale.toUpperCase()}
                      </span>
                    </div>
                    <h3 className="mt-3 truncate font-medium text-[color:var(--findable-ink,#f7f8f8)]">
                      {content.title}
                    </h3>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <div>
                        <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                          {t.readiness}
                        </p>
                        <p className="mt-1 font-medium">
                          {performance
                            ? percent(performance.optimizationReadiness)
                            : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                          {t.geoChange}
                        </p>
                        <p className="mt-1 font-medium">
                          {geoChangeText(performance, t, isKo)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                          {t.index}
                        </p>
                        <p className="mt-1 font-medium">
                          {performance?.indexEligibility
                            ? t.indexOk
                            : t.indexCheck}
                        </p>
                      </div>
                      <div>
                        <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                          {t.aiCitation}
                        </p>
                        <p className="mt-1 font-medium">
                          {performance?.citationDetected
                            ? t.detected
                            : t.notDetected}
                        </p>
                      </div>
                    </div>
                  </div>
                  <Link
                    className="inline-flex items-center justify-center gap-2 text-[color:var(--findable-primary,#ff7a4d)] text-sm hover:underline"
                    href={`/insights/${content.id}`}
                  >
                    {t.detail} <ArrowRightIcon className="size-4" />
                  </Link>
                </article>
              );
            })}
          </section>
        )}

        <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs leading-5">
          {t.footnote}
        </p>
      </div>
    </>
  );
}
