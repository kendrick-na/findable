import { auth } from "@repo/auth/server";
import { Badge } from "@repo/design-system/components/ui/badge";
import { ArrowRightIcon, FileTextIcon, Settings2Icon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  createPublisherDraft,
  generateDraftFromLatestAction,
} from "@/app/actions/content/manage";
import { contentPerformance } from "@/lib/content/performance";
import { scopedBrands, scopedContents } from "@/lib/db/scoped";
import { getAppDictionary, getAppLocale } from "@/lib/i18n";
import { Header } from "../components/header";
import { GenerateDraftButton } from "./generate-draft-button";

export const metadata: Metadata = {
  title: "콘텐츠 인사이트 · Findable",
  description: "측정 액션을 SEO/GEO 콘텐츠로 만들고 검수해 발행합니다.",
};

const STATUS_TONE: Record<string, string> = {
  publisher_review: "border-amber-400/20 bg-amber-400/10 text-amber-300",
  quality_check: "border-sky-400/20 bg-sky-400/10 text-sky-300",
  moderation_review: "border-violet-400/20 bg-violet-400/10 text-violet-300",
  scheduled: "border-cyan-400/20 bg-cyan-400/10 text-cyan-300",
  published: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
  draft: "border-white/10 bg-white/5 text-white/60",
  archived: "border-white/10 bg-white/5 text-white/40",
};

const CONTENT_STATUSES = [
  "draft",
  "publisher_review",
  "quality_check",
  "moderation_review",
  "scheduled",
  "published",
  "archived",
] as const;

function PerformanceSignals({
  performance,
}: {
  performance?: NonNullable<Awaited<ReturnType<typeof contentPerformance>>>;
}) {
  if (!performance) {
    return null;
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/45">
      <span>최적화 준비도 {performance.optimizationReadiness}%</span>
      <span>· 색인 가능 {performance.indexEligibility ? "예" : "아니오"}</span>
      <span>· AI 인용 {performance.citationDetected ? "감지" : "미감지"}</span>
      {performance.scoreDelta !== null ? (
        <span>
          · 재측정 변화 {performance.scoreDelta > 0 ? "+" : ""}
          {performance.scoreDelta}점
        </span>
      ) : (
        <span>· 발행 후 재측정 필요</span>
      )}
    </div>
  );
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 100) ?? "";
  const status = CONTENT_STATUSES.find((value) => value === params.status);
  const [t, locale, brands, contents] = await Promise.all([
    getAppDictionary(),
    getAppLocale(),
    scopedBrands(),
    scopedContents({ query: query || undefined, status }),
  ]);
  const { orgId } = await auth();
  const performanceRows = orgId
    ? await Promise.all(
        contents.map((content) =>
          contentPerformance({ contentId: content.id, organizationId: orgId })
        )
      )
    : [];
  const performanceById = new Map(
    performanceRows.flatMap((row) =>
      row ? ([[row.contentId, row]] as const) : []
    )
  );
  const c = t.content;
  return (
    <>
      <Header page={c.navLabel} pages={["Findable"]} />
      <main className="flex flex-1 flex-col gap-8 p-6 pt-2">
        <section className="relative overflow-hidden rounded-2xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-6 md:p-8">
          <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.035)_1px,transparent_1px)] [background-size:28px_28px]" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="mb-3 font-semibold text-[11px] text-[color:var(--findable-primary,#ff7a4d)] uppercase tracking-[0.2em]">
                {c.eyebrow}
              </p>
              <h1 className="text-balance font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] leading-tight md:text-4xl">
                {c.title}
              </h1>
              <p className="mt-3 max-w-xl text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-6">
                {c.description}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                className="inline-flex items-center gap-2 rounded-md border border-white/10 px-4 py-2 text-sm"
                href="/insights/settings"
              >
                <Settings2Icon className="size-4" /> 채널 설정
              </Link>
              {brands[0] ? (
                <GenerateDraftButton
                  brandLabel={c.brandLabel}
                  brands={brands.map((brand) => ({
                    id: brand.id,
                    name: brand.name,
                    domain: brand.domain,
                  }))}
                  createLabel={c.createBlank}
                  label={c.generate}
                  locale={locale}
                  onCreate={createPublisherDraft}
                  onGenerate={generateDraftFromLatestAction}
                />
              ) : (
                <Link
                  className="findable-btn-primary rounded-md px-4 py-2 text-sm"
                  href="/brand"
                >
                  {c.addBrand}
                </Link>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          {[
            [c.statAll, contents.length],
            [
              c.statReview,
              contents.filter((item) => item.status.includes("review")).length,
            ],
            [
              c.statPublished,
              contents.filter((item) => item.status === "published").length,
            ],
          ].map(([label, value]) => (
            <div className="findable-card p-5" key={String(label)}>
              <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                {label}
              </p>
              <p className="mt-2 font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tabular-nums">
                {value}
              </p>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)]">
              {c.listTitle}
            </h2>
            <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
              {c.listHint}
            </span>
          </div>
          <form
            className="grid gap-2 rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]"
            method="get"
          >
            <input
              className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-sm outline-none placeholder:text-white/30 focus:border-[color:var(--findable-primary,#ff7a4d)]"
              defaultValue={query}
              name="q"
              placeholder={c.searchContent}
              type="search"
            />
            <select
              aria-label={c.filterStatus}
              className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-sm outline-none focus:border-[color:var(--findable-primary,#ff7a4d)]"
              defaultValue={status ?? ""}
              name="status"
            >
              <option value="">{c.allStatuses}</option>
              {CONTENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {c.status[value]}
                </option>
              ))}
            </select>
            <button
              className="findable-btn-primary h-10 rounded-md px-4 text-sm"
              type="submit"
            >
              {c.filterButton}
            </button>
          </form>
          {contents.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-[color:var(--findable-hairline,#23252a)] border-dashed px-6 text-center">
              <FileTextIcon className="mb-4 size-6 text-[color:var(--findable-primary,#ff7a4d)]" />
              <h3 className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
                {c.emptyTitle}
              </h3>
              <p className="mt-2 max-w-md text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-6">
                {c.emptyDescription}
              </p>
            </div>
          ) : (
            contents.map((content) => (
              <Link
                className="group grid gap-4 rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-5 transition hover:-translate-y-0.5 hover:border-[color:var(--findable-primary,#ff7a4d)]/40 md:grid-cols-[1fr_auto] md:items-center"
                href={`/insights/${content.id}`}
                key={content.id}
              >
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge
                      className={STATUS_TONE[content.status]}
                      variant="outline"
                    >
                      {c.status[content.status as keyof typeof c.status]}
                    </Badge>
                    <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                      {content.publisher.name} · {content.locale.toUpperCase()}
                    </span>
                  </div>
                  <h3 className="truncate font-medium text-[color:var(--findable-ink,#f7f8f8)]">
                    {content.title}
                  </h3>
                  <p className="mt-1 line-clamp-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
                    {content.excerpt}
                  </p>
                  {content.status === "published" ? (
                    <PerformanceSignals
                      performance={performanceById.get(content.id)}
                    />
                  ) : null}
                </div>
                <ArrowRightIcon className="size-4 text-[color:var(--findable-ink-tertiary,#7e8289)] transition-transform group-hover:translate-x-1 group-hover:text-[color:var(--findable-primary,#ff7a4d)]" />
              </Link>
            ))
          )}
        </section>
      </main>
    </>
  );
}
