import { checkContentQuality } from "@repo/audit/content-quality";
import { requireAdmin } from "@repo/auth/admin";
import { database } from "@repo/database";
import type { Metadata } from "next";
import Link from "next/link";
import {
  createFindableDraft,
  moderateContent,
} from "@/app/actions/content/manage";
import { getAppDictionary, getAppLocale } from "@/lib/i18n";
import { Header } from "../../components/header";
import { CreateOfficialButton } from "./create-official-button";
import { ModerationActions } from "./moderation-actions";

export const metadata: Metadata = { title: "콘텐츠 검수 · Findable" };

export default async function AdminContentPage() {
  await requireAdmin();
  const [t, locale, contents, officialDrafts] = await Promise.all([
    getAppDictionary(),
    getAppLocale(),
    database.content.findMany({
      where: { status: "moderation_review" },
      orderBy: { updatedAt: "asc" },
      include: {
        publisher: true,
        qualityChecks: { orderBy: { createdAt: "desc" }, take: 1 },
        revisions: { orderBy: { version: "desc" }, take: 1 },
      },
    }),
    database.content.findMany({
      where: {
        publisher: { kind: "findable" },
        status: { notIn: ["published", "archived"] },
      },
      orderBy: { updatedAt: "desc" },
      include: { publisher: true },
    }),
  ]);
  const c = t.content;
  return (
    <>
      <Header page={c.moderationTitle} pages={["Findable", "Admin"]} />
      <main className="flex flex-1 flex-col gap-6 p-6 pt-2">
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
              {c.moderationTitle}
            </h1>
            <p className="mt-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              {c.moderationDescription}
            </p>
          </div>
          <CreateOfficialButton
            label={c.createOfficial}
            locale={locale}
            onCreate={createFindableDraft}
          />
        </section>
        {officialDrafts.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="font-semibold text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm">
              {c.officialDrafts}
            </h2>
            {officialDrafts.map((content) => (
              <Link
                className="findable-card p-5 transition hover:border-[color:var(--findable-primary,#ff7a4d)]/40"
                href={`/insights/${content.id}`}
                key={content.id}
              >
                <p className="text-[color:var(--findable-primary,#ff7a4d)] text-xs uppercase tracking-widest">
                  Findable · {content.locale}
                </p>
                <h3 className="mt-2 font-medium text-[color:var(--findable-ink,#f7f8f8)]">
                  {content.title}
                </h3>
              </Link>
            ))}
          </section>
        ) : null}
        {contents.length === 0 ? (
          <div className="rounded-xl border border-white/10 border-dashed p-12 text-center text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            {c.moderationEmpty}
          </div>
        ) : (
          contents.map((content) => {
            const currentQuality = checkContentQuality({
              title: content.title,
              bodyMarkdown: content.bodyMarkdown,
              sourceEvidence: content.revisions[0]?.sourceEvidence,
            });
            return (
              <article
                className="findable-card grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-center"
                key={content.id}
              >
                <div className="min-w-0">
                  <p className="font-semibold text-[color:var(--findable-primary,#ff7a4d)] text-xs uppercase tracking-widest">
                    {content.publisher.name} · {content.locale}
                  </p>
                  <h2 className="mt-2 font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
                    {content.title}
                  </h2>
                  <Link
                    className="mt-3 inline-flex text-[color:var(--findable-primary,#ff7a4d)] text-sm hover:underline"
                    href={`/insights/${content.id}`}
                  >
                    {c.moderationReviewOriginal}
                  </Link>
                  <p className="mt-2 line-clamp-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-6">
                    {content.excerpt}
                  </p>
                  <p
                    className={`mt-3 text-xs ${
                      currentQuality.status === "failed"
                        ? "text-red-300"
                        : "text-amber-300"
                    }`}
                  >
                    {currentQuality.summary}
                  </p>
                </div>
                <ModerationActions
                  approvalBlocked={currentQuality.status === "failed"}
                  approveLabel={c.moderationApprove}
                  confirmLabel={c.moderationConfirm}
                  contentId={content.id}
                  notePlaceholder={c.moderationNotePlaceholder}
                  onModerate={moderateContent}
                  rejectLabel={c.moderationReject}
                />
              </article>
            );
          })
        )}
      </main>
    </>
  );
}
