"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { toast } from "@repo/design-system/components/ui/sonner";
import { Spinner } from "@repo/design-system/components/ui/spinner";
import { ArchiveRestoreIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ArchivePromptResult } from "@/app/actions/brand/archive-prompt";
import type { AppDictionary } from "@/lib/i18n";

/**
 * 보관한 질문 목록(2026-10-14) — 측정에서는 빠져 있고 기록은 남아 있다. [복원]으로 다시 측정 대상이 된다.
 * 서버액션은 주입받는다(`PromptList` 와 같은 Storybook 규칙).
 */
export const ArchivedPromptList = ({
  onRestore,
  prompts,
  t,
}: {
  onRestore: (input: { promptId: string }) => Promise<ArchivePromptResult>;
  prompts: Array<{ id: string; measuredCount: number; text: string }>;
  t: AppDictionary["promptList"];
}) => {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  if (prompts.length === 0) {
    return null;
  }

  const restore = async (promptId: string) => {
    setBusy(promptId);
    try {
      const result = await onRestore({ promptId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(t.restored);
      router.refresh();
    } catch {
      toast.error(t.archiveFailed);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="px-1 font-medium text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
        {t.archivedTitle}
      </h3>
      <p className="px-1 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
        {t.archivedHint}
      </p>
      <ul className="flex flex-col gap-1.5">
        {prompts.map((prompt) => (
          <li
            className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--findable-hairline,#23252a)] px-4 py-3 opacity-70"
            key={prompt.id}
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[color:var(--findable-ink,#f7f8f8)] text-sm">
                {prompt.text}
              </span>
              <span className="text-[10px] text-[color:var(--findable-ink-tertiary,#7e8289)] tabular-nums">
                {t.measuredCount.replace("{n}", String(prompt.measuredCount))}
              </span>
            </div>
            <Button
              aria-label={t.restoreLabel.replace("{text}", prompt.text)}
              disabled={busy === prompt.id}
              onClick={() => {
                restore(prompt.id).catch(() => {
                  // restore 가 자체적으로 토스트를 띄운다.
                });
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {busy === prompt.id ? (
                <Spinner className="size-3" />
              ) : (
                <ArchiveRestoreIcon aria-hidden="true" className="size-3.5" />
              )}
              <span className="ml-1 text-xs">{t.restore}</span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
};
