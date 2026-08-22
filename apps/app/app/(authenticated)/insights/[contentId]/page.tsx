import { Badge } from "@repo/design-system/components/ui/badge";
import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  approveContent,
  cancelScheduledContent,
  saveContentDraft,
  withdrawContentReview,
} from "@/app/actions/content/manage";
import { scopedContentById } from "@/lib/db/scoped";
import { getAppDictionary } from "@/lib/i18n";
import { Header } from "../../components/header";
import { ContentEditor } from "./content-editor";

export const metadata: Metadata = { title: "콘텐츠 편집 · Findable" };

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ contentId: string }>;
}) {
  const { contentId } = await params;
  const [content, t] = await Promise.all([
    scopedContentById(contentId),
    getAppDictionary(),
  ]);
  if (!content) {
    notFound();
  }
  const c = t.content;
  const latestQuality = content.qualityChecks[0];
  const latestRevision = content.revisions[0];
  const evidence = latestRevision?.sourceEvidence as {
    evidence?: string;
    source?: string;
  } | null;
  const latestRejection = content.reviewEvents.find(
    (event) => event.type === "moderation_rejected" && event.note
  );

  return (
    <>
      <Header page={c.editorTitle} pages={["Findable", c.navLabel]} />
      <main className="flex flex-1 flex-col gap-5 p-6 pt-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              className="mb-3 inline-flex items-center gap-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs hover:text-[color:var(--findable-primary,#ff7a4d)]"
              href="/insights"
            >
              <ArrowLeftIcon className="size-3.5" /> {c.back}
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-xl">
                {content.publisher.name}
              </h1>
              <Badge variant="outline">
                {c.status[content.status as keyof typeof c.status]}
              </Badge>
            </div>
            <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              {c.editorDescription}
            </p>
          </div>
          {content.status === "published" ? (
            <a
              className="findable-btn-primary rounded-md px-4 py-2 text-sm"
              href={`${process.env.NEXT_PUBLIC_WEB_URL ?? ""}/${content.locale}/p/${content.publisher.slug}/${content.slug}`}
              rel="noreferrer"
              target="_blank"
            >
              {c.openPublished}
            </a>
          ) : null}
        </div>

        {(evidence?.evidence || latestQuality) && (
          <section className="grid gap-3 md:grid-cols-2">
            {evidence?.evidence ? (
              <div className="rounded-lg border border-[color:var(--findable-primary,#ff7a4d)]/20 bg-[color:var(--findable-primary,#ff7a4d)]/5 p-4">
                <p className="font-semibold text-[color:var(--findable-primary,#ff7a4d)] text-xs">
                  {c.evidenceLabel}
                </p>
                <p className="mt-2 text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm leading-6">
                  {evidence.evidence}
                </p>
              </div>
            ) : null}
            {latestQuality ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                <p className="font-semibold text-[color:var(--findable-ink-muted,#d0d6e0)] text-xs">
                  {c.qualityLabel}
                </p>
                <p className="mt-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-6">
                  {latestQuality.summary}
                </p>
              </div>
            ) : null}
          </section>
        )}

        {latestRejection?.note ? (
          <section className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-4">
            <p className="font-semibold text-amber-300 text-xs">
              {c.revisionReason}
            </p>
            <p className="mt-2 text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm leading-6">
              {latestRejection.note}
            </p>
          </section>
        ) : null}

        <ContentEditor
          content={{
            id: content.id,
            title: content.title,
            excerpt: content.excerpt ?? "",
            bodyMarkdown: content.bodyMarkdown,
            contentType: content.contentType as
              | "research"
              | "guide"
              | "case_study"
              | "analysis",
            series: content.series ?? "",
            tags: content.tags,
            coverImageUrl: content.coverImageUrl ?? "",
            coverImageAlt: content.coverImageAlt ?? "",
            seoTitle: content.seoTitle ?? "",
            seoDescription: content.seoDescription ?? "",
            scheduledAt: content.scheduledAt?.toISOString() ?? "",
            sendNewsletter: content.sendNewsletter,
            status: content.status,
          }}
          labels={{
            approve: c.approve,
            approving: c.approving,
            bodyLabel: c.bodyLabel,
            excerptLabel: c.excerptLabel,
            formatBold: c.formatBold,
            formatHeading: c.formatHeading,
            formatImage: c.formatImage,
            formatLink: c.formatLink,
            formatQuote: c.formatQuote,
            formatToolbar: c.formatToolbar,
            moderationSubmitted: c.moderationSubmitted,
            moderationWaiting: c.moderationWaiting,
            save: c.save,
            saved: c.saved,
            saving: c.saving,
            titleLabel: c.titleLabel,
            typeLabel: c.typeLabel,
            typeResearch: c.typeResearch,
            typeGuide: c.typeGuide,
            typeCase: c.typeCase,
            typeAnalysis: c.typeAnalysis,
            seriesLabel: c.seriesLabel,
            seriesPlaceholder: c.seriesPlaceholder,
            tagsLabel: c.tagsLabel,
            tagsPlaceholder: c.tagsPlaceholder,
            searchSettings: c.searchSettings,
            seoTitleLabel: c.seoTitleLabel,
            seoDescriptionLabel: c.seoDescriptionLabel,
            coverUrlLabel: c.coverUrlLabel,
            coverAltLabel: c.coverAltLabel,
            readerPreview: c.readerPreview,
            withdrawReview: c.withdrawReview,
            withdrawingReview: c.withdrawingReview,
            withdrawnReview: c.withdrawnReview,
            googlePreview: c.googlePreview,
          }}
          onApprove={approveContent}
          onCancelSchedule={cancelScheduledContent}
          onSave={saveContentDraft}
          onWithdraw={withdrawContentReview}
        />
      </main>
    </>
  );
}
