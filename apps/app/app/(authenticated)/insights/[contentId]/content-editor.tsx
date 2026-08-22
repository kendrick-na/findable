"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { toast } from "@repo/design-system/components/ui/sonner";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import {
  CheckCircle2Icon,
  EyeIcon,
  ImageIcon,
  Loader2Icon,
  SaveIcon,
  SearchIcon,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { ContentActionResult } from "@/app/actions/content/manage";

interface EditorLabels {
  approve: string;
  approving: string;
  bodyLabel: string;
  coverAltLabel: string;
  coverUrlLabel: string;
  excerptLabel: string;
  formatBold: string;
  formatHeading: string;
  formatImage: string;
  formatLink: string;
  formatQuote: string;
  formatToolbar: string;
  googlePreview: string;
  moderationSubmitted: string;
  moderationWaiting: string;
  readerPreview: string;
  save: string;
  saved: string;
  saving: string;
  searchSettings: string;
  seoDescriptionLabel: string;
  seoTitleLabel: string;
  seriesLabel: string;
  seriesPlaceholder: string;
  tagsLabel: string;
  tagsPlaceholder: string;
  titleLabel: string;
  typeAnalysis: string;
  typeCase: string;
  typeGuide: string;
  typeLabel: string;
  typeResearch: string;
  withdrawingReview: string;
  withdrawnReview: string;
  withdrawReview: string;
}

function ReviewWaitingBanner({
  contentId,
  labels,
  onWithdraw,
  status,
}: {
  contentId: string;
  labels: EditorLabels;
  onWithdraw: (contentId: string) => Promise<ContentActionResult>;
  status: string;
}) {
  const router = useRouter();
  const [withdrawing, startWithdrawing] = useTransition();
  if (status !== "moderation_review") {
    return null;
  }
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-violet-400/20 bg-violet-400/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-2xl text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm leading-6">
        {labels.moderationWaiting}
      </p>
      <Button
        disabled={withdrawing}
        onClick={() =>
          startWithdrawing(async () => {
            const result = await onWithdraw(contentId);
            if (result.error) {
              toast.error(result.error);
              return;
            }
            toast.success(labels.withdrawnReview);
            router.refresh();
          })
        }
        variant="outline"
      >
        {withdrawing ? <Loader2Icon className="size-4 animate-spin" /> : null}
        {withdrawing ? labels.withdrawingReview : labels.withdrawReview}
      </Button>
    </div>
  );
}

export function ContentEditor({
  content,
  labels,
  onApprove,
  onCancelSchedule,
  onSave,
  onWithdraw,
}: {
  content: {
    bodyMarkdown: string;
    contentType: "research" | "guide" | "case_study" | "analysis";
    coverImageAlt: string;
    coverImageUrl: string;
    excerpt: string;
    id: string;
    seoDescription: string;
    seoTitle: string;
    scheduledAt: string;
    sendNewsletter: boolean;
    series: string;
    status: string;
    tags: string[];
    title: string;
  };
  labels: EditorLabels;
  onApprove: (contentId: string) => Promise<ContentActionResult>;
  onCancelSchedule: (contentId: string) => Promise<ContentActionResult>;
  onSave: (input: {
    bodyMarkdown: string;
    contentId: string;
    contentType: "research" | "guide" | "case_study" | "analysis";
    coverImageAlt: string;
    coverImageUrl: string;
    excerpt: string;
    seoDescription: string;
    seoTitle: string;
    scheduledAt: string;
    sendNewsletter: boolean;
    series: string;
    tags: string[];
    title: string;
  }) => Promise<ContentActionResult>;
  onWithdraw: (contentId: string) => Promise<ContentActionResult>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(content.title);
  const [excerpt, setExcerpt] = useState(content.excerpt);
  const [bodyMarkdown, setBodyMarkdown] = useState(content.bodyMarkdown);
  const [contentType, setContentType] = useState(content.contentType);
  const [series, setSeries] = useState(content.series);
  const [tagsText, setTagsText] = useState(content.tags.join(", "));
  const [coverImageUrl, setCoverImageUrl] = useState(content.coverImageUrl);
  const [coverImageAlt, setCoverImageAlt] = useState(content.coverImageAlt);
  const [seoTitle, setSeoTitle] = useState(content.seoTitle);
  const [seoDescription, setSeoDescription] = useState(content.seoDescription);
  const [scheduledAt, setScheduledAt] = useState(() => {
    if (!content.scheduledAt) {
      return "";
    }
    const date = new Date(content.scheduledAt);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
  });
  const [sendNewsletter, setSendNewsletter] = useState(content.sendNewsletter);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [saving, startSaving] = useTransition();
  const [approving, startApproving] = useTransition();
  const editable =
    content.status === "publisher_review" || content.status === "draft";
  const tags = tagsText
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const insertMarkdown = (
    before: string,
    after: string,
    placeholder: string
  ) => {
    const field = bodyRef.current;
    if (!field) {
      return;
    }
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const selected = bodyMarkdown.slice(start, end) || placeholder;
    const inserted = `${before}${selected}${after}`;
    setBodyMarkdown(
      `${bodyMarkdown.slice(0, start)}${inserted}${bodyMarkdown.slice(end)}`
    );
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(
        start + before.length,
        start + before.length + selected.length
      );
    });
  };

  const draftInput = () => ({
    contentId: content.id,
    title,
    excerpt,
    bodyMarkdown,
    contentType,
    series,
    tags,
    coverImageUrl,
    coverImageAlt,
    seoTitle,
    seoDescription,
    scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : "",
    sendNewsletter,
  });

  const save = () =>
    new Promise<boolean>((resolve) => {
      startSaving(async () => {
        const result = await onSave(draftInput());
        if (result.error) {
          toast.error(result.error);
          resolve(false);
          return;
        }
        toast.success(labels.saved);
        router.refresh();
        resolve(true);
      });
    });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
      <section className="findable-card flex flex-col gap-5 p-5 md:p-6">
        {content.status === "scheduled" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm">
            <span>
              예약 발행 대기 중입니다. 철회하면 다시 편집할 수 있습니다.
            </span>
            <Button
              onClick={() =>
                startSaving(async () => {
                  const result = await onCancelSchedule(content.id);
                  if (result.error) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success("예약을 철회했습니다.");
                  router.refresh();
                })
              }
              variant="outline"
            >
              예약 철회
            </Button>
          </div>
        ) : null}
        <ReviewWaitingBanner
          contentId={content.id}
          labels={labels}
          onWithdraw={onWithdraw}
          status={content.status}
        />
        <div className="grid gap-4 border-white/5 border-b pb-5 md:grid-cols-2">
          <label
            className="grid gap-2 text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm"
            htmlFor="content-type"
          >
            {labels.typeLabel}
            <select
              className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-sm outline-none focus:border-[color:var(--findable-primary,#ff7a4d)]"
              disabled={!editable}
              id="content-type"
              onChange={(event) =>
                setContentType(event.target.value as typeof contentType)
              }
              value={contentType}
            >
              <option value="research">{labels.typeResearch}</option>
              <option value="guide">{labels.typeGuide}</option>
              <option value="case_study">{labels.typeCase}</option>
              <option value="analysis">{labels.typeAnalysis}</option>
            </select>
          </label>
          <label
            className="grid gap-2 text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm"
            htmlFor="content-series"
          >
            {labels.seriesLabel}
            <Input
              disabled={!editable}
              id="content-series"
              maxLength={80}
              onChange={(event) => setSeries(event.target.value)}
              placeholder={labels.seriesPlaceholder}
              value={series}
            />
          </label>
          <label
            className="grid gap-2 text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm md:col-span-2"
            htmlFor="content-tags"
          >
            {labels.tagsLabel}
            <Input
              disabled={!editable}
              id="content-tags"
              onChange={(event) => setTagsText(event.target.value)}
              placeholder={labels.tagsPlaceholder}
              value={tagsText}
            />
          </label>
        </div>
        <label
          className="grid gap-2 text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm"
          htmlFor="content-title"
        >
          {labels.titleLabel}
          <Input
            disabled={!editable}
            id="content-title"
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </label>
        <section className="grid gap-4 rounded-lg border border-white/10 bg-black/10 p-4 md:grid-cols-2">
          <label
            className="grid gap-2 text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm"
            htmlFor="content-scheduled-at"
          >
            예약 발행 시각
            <Input
              disabled={!editable}
              id="content-scheduled-at"
              min={new Date().toISOString().slice(0, 16)}
              onChange={(event) => setScheduledAt(event.target.value)}
              type="datetime-local"
              value={scheduledAt}
            />
            <span className="text-[11px] text-[color:var(--findable-ink-tertiary,#7e8289)]">
              비워 두면 승인 직후 발행합니다. 입력 시 현재 브라우저 시간대를
              사용하며, Hobby 운영 환경에서는 매일 03:00(KST)에 예약분을
              처리합니다.
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-md border border-white/5 p-3 text-sm">
            <input
              checked={sendNewsletter}
              className="mt-1 size-4 accent-[color:var(--findable-primary,#ff7a4d)]"
              disabled={!editable}
              onChange={(event) => setSendNewsletter(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong className="block text-[color:var(--findable-ink,#f7f8f8)]">
                발행 후 구독자에게 이메일 보내기
              </strong>
              <span className="mt-1 block text-[color:var(--findable-ink-subtle,#8a8f98)] leading-5">
                발행이 완료된 글만 뉴스레터 대기열에 들어갑니다.
              </span>
            </span>
          </label>
        </section>
        <details
          className="rounded-lg border border-white/10 bg-black/10 p-4"
          open
        >
          <summary className="cursor-pointer list-none font-medium text-sm">
            <span className="inline-flex items-center gap-2">
              <SearchIcon className="size-4 text-[color:var(--findable-primary,#ff7a4d)]" />
              {labels.searchSettings}
            </span>
          </summary>
          <div className="mt-5 grid gap-4">
            <label
              className="grid gap-2 text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm"
              htmlFor="content-seo-title"
            >
              {labels.seoTitleLabel}
              <Input
                disabled={!editable}
                id="content-seo-title"
                maxLength={70}
                onChange={(event) => setSeoTitle(event.target.value)}
                value={seoTitle}
              />
              <span className="text-[11px] text-[color:var(--findable-ink-tertiary,#7e8289)]">
                {seoTitle.length}/70
              </span>
            </label>
            <label
              className="grid gap-2 text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm"
              htmlFor="content-seo-description"
            >
              {labels.seoDescriptionLabel}
              <Textarea
                disabled={!editable}
                id="content-seo-description"
                maxLength={180}
                onChange={(event) => setSeoDescription(event.target.value)}
                rows={3}
                value={seoDescription}
              />
              <span className="text-[11px] text-[color:var(--findable-ink-tertiary,#7e8289)]">
                {seoDescription.length}/180
              </span>
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label
                className="grid gap-2 text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm"
                htmlFor="content-cover-url"
              >
                <span className="inline-flex items-center gap-2">
                  <ImageIcon className="size-4" /> {labels.coverUrlLabel}
                </span>
                <Input
                  disabled={!editable}
                  id="content-cover-url"
                  onChange={(event) => setCoverImageUrl(event.target.value)}
                  placeholder="https://..."
                  type="url"
                  value={coverImageUrl}
                />
              </label>
              <label
                className="grid gap-2 text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm"
                htmlFor="content-cover-alt"
              >
                {labels.coverAltLabel}
                <Input
                  disabled={!editable}
                  id="content-cover-alt"
                  maxLength={160}
                  onChange={(event) => setCoverImageAlt(event.target.value)}
                  value={coverImageAlt}
                />
              </label>
            </div>
          </div>
        </details>
        <label
          className="grid gap-2 text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm"
          htmlFor="content-excerpt"
        >
          {labels.excerptLabel}
          <Textarea
            disabled={!editable}
            id="content-excerpt"
            maxLength={300}
            onChange={(event) => setExcerpt(event.target.value)}
            rows={3}
            value={excerpt}
          />
        </label>
        <label
          className="grid gap-2 text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm"
          htmlFor="content-body"
        >
          {labels.bodyLabel}
          <div
            aria-label={labels.formatToolbar}
            className="flex flex-wrap gap-1 rounded-md border border-white/10 bg-black/10 p-1.5"
            role="toolbar"
          >
            {[
              [labels.formatBold, "**", "**", labels.formatBold],
              [labels.formatHeading, "## ", "", labels.formatHeading],
              [labels.formatLink, "[", "](https://)", labels.formatLink],
              [labels.formatImage, "![", "](https://)", labels.formatImage],
              [labels.formatQuote, "> ", "", labels.formatQuote],
            ].map(([label, before, after, placeholder]) => (
              <Button
                className="h-8 px-2.5 text-xs"
                disabled={!editable}
                key={label}
                onClick={() => insertMarkdown(before, after, placeholder)}
                size="sm"
                title={label}
                type="button"
                variant="ghost"
              >
                {label}
              </Button>
            ))}
          </div>
          <Textarea
            className="min-h-[560px] resize-y font-mono text-[13px] leading-6"
            disabled={!editable}
            id="content-body"
            onChange={(event) => setBodyMarkdown(event.target.value)}
            ref={bodyRef}
            value={bodyMarkdown}
          />
        </label>
        {editable ? (
          <div className="flex flex-wrap justify-end gap-2 border-white/5 border-t pt-5">
            <Button
              disabled={saving || approving}
              onClick={save}
              variant="outline"
            >
              {saving ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SaveIcon className="size-4" />
              )}
              {saving ? labels.saving : labels.save}
            </Button>
            <Button
              className="bg-[color:var(--findable-primary,#ff7a4d)] text-black hover:bg-[color:var(--findable-primary,#ff7a4d)]/90"
              disabled={saving || approving}
              onClick={() =>
                startApproving(async () => {
                  const saved = await onSave(draftInput());
                  if (saved.error) {
                    toast.error(saved.error);
                    return;
                  }
                  const result = await onApprove(content.id);
                  if (result.error) {
                    toast.error(result.error);
                    router.refresh();
                    return;
                  }
                  const message =
                    result.status === "moderation_review"
                      ? labels.moderationSubmitted
                      : labels.approve;
                  toast.success(message);
                  router.refresh();
                })
              }
            >
              {approving ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <CheckCircle2Icon className="size-4" />
              )}
              {approving ? labels.approving : labels.approve}
            </Button>
          </div>
        ) : null}
      </section>

      <aside className="xl:sticky xl:top-6 xl:self-start">
        <div className="overflow-hidden rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[#f5f1e8] text-[#1f211f] shadow-2xl shadow-black/20">
          <div className="flex items-center gap-2 border-black/10 border-b px-5 py-3 font-semibold text-[11px] text-black/45 uppercase tracking-[0.16em]">
            <EyeIcon className="size-3.5" /> {labels.readerPreview}
          </div>
          {coverImageUrl ? (
            <Image
              alt={coverImageAlt || ""}
              className="aspect-[16/9] w-full object-cover"
              height={675}
              src={coverImageUrl}
              unoptimized
              width={1200}
            />
          ) : null}
          <article className="px-6 py-8 md:px-8">
            <p className="mb-4 font-semibold text-[#e86f45] text-[10px] uppercase tracking-[0.16em]">
              {series || contentType.replace("_", " ")}
            </p>
            <h2 className="text-balance font-semibold font-serif text-3xl leading-tight">
              {title}
            </h2>
            <p className="mt-4 border-[#e86f45] border-l-2 pl-4 text-black/60 text-sm leading-6">
              {excerpt}
            </p>
            <div className="mt-8 whitespace-pre-wrap text-[15px] text-black/75 leading-7">
              {bodyMarkdown.slice(0, 900)}
              {bodyMarkdown.length > 900 ? "…" : ""}
            </div>
          </article>
        </div>
        <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-4">
          <p className="text-[11px] text-[color:var(--findable-ink-tertiary,#7e8289)] uppercase tracking-[0.14em]">
            {labels.googlePreview}
          </p>
          <p className="mt-3 line-clamp-1 text-[#8ab4f8] text-base">
            {seoTitle || title}
          </p>
          <p className="mt-1 text-[#bdc1c6] text-xs">
            www.findable.co.kr › insights
          </p>
          <p className="mt-1 line-clamp-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-5">
            {seoDescription || excerpt}
          </p>
        </div>
      </aside>
    </div>
  );
}
