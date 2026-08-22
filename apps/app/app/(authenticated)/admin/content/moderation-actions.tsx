"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { toast } from "@repo/design-system/components/ui/sonner";
import { CheckIcon, Loader2Icon, RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ContentActionResult } from "@/app/actions/content/manage";

export function ModerationActions({
  approveLabel,
  approvalBlocked,
  confirmLabel,
  contentId,
  notePlaceholder,
  onModerate,
  rejectLabel,
}: {
  approveLabel: string;
  approvalBlocked: boolean;
  confirmLabel: string;
  contentId: string;
  notePlaceholder: string;
  onModerate: (input: {
    approve: boolean;
    contentId: string;
    note?: string;
    reviewConfirmed: boolean;
  }) => Promise<ContentActionResult>;
  rejectLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [rejectionNote, setRejectionNote] = useState("");
  const run = (approve: boolean) =>
    startTransition(async () => {
      const result = await onModerate({
        approve,
        contentId,
        note: rejectionNote.trim() || undefined,
        reviewConfirmed,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(approve ? approveLabel : rejectLabel);
      router.refresh();
    });
  return (
    <div className="grid min-w-64 gap-3">
      <textarea
        className="min-h-20 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-[color:var(--findable-primary,#ff7a4d)]"
        onChange={(event) => setRejectionNote(event.target.value)}
        placeholder={notePlaceholder}
        value={rejectionNote}
      />
      <label className="flex items-start gap-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs leading-5">
        <input
          checked={reviewConfirmed}
          className="mt-0.5 size-4 accent-[color:var(--findable-primary,#ff7a4d)]"
          onChange={(event) => setReviewConfirmed(event.target.checked)}
          type="checkbox"
        />
        {confirmLabel}
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          disabled={pending || rejectionNote.trim().length === 0}
          onClick={() => run(false)}
          variant="outline"
        >
          {pending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <RotateCcwIcon className="size-4" />
          )}
          {rejectLabel}
        </Button>
        <Button
          className="bg-emerald-500 text-black hover:bg-emerald-400"
          disabled={pending || !reviewConfirmed || approvalBlocked}
          onClick={() => run(true)}
        >
          {pending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <CheckIcon className="size-4" />
          )}
          {approveLabel}
        </Button>
      </div>
    </div>
  );
}
