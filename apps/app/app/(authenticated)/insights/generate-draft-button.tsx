"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { toast } from "@repo/design-system/components/ui/sonner";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ContentActionResult } from "@/app/actions/content/manage";

export function GenerateDraftButton({
  brands,
  brandLabel,
  createLabel,
  label,
  locale,
  onCreate,
  onGenerate,
}: {
  brands: { id: string; name: string; domain: string }[];
  brandLabel: string;
  createLabel: string;
  label: string;
  locale: "ko" | "en";
  onGenerate: (input: {
    brandId: string;
    locale: "ko" | "en";
  }) => Promise<ContentActionResult>;
  onCreate: (input: {
    brandId: string;
    locale: "ko" | "en";
  }) => Promise<ContentActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const run = (action: typeof onGenerate) =>
    startTransition(async () => {
      const result = await action({ brandId, locale });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(locale === "ko" ? "초안을 만들었어요" : "Draft created");
      if (result.contentId) {
        router.push(`/insights/${result.contentId}`);
      }
    });
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_auto] sm:items-end">
      <label className="grid gap-1.5 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
        {brandLabel}
        <select
          className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-[color:var(--findable-ink,#f7f8f8)] text-sm outline-none focus:border-[color:var(--findable-primary,#ff7a4d)]"
          disabled={pending}
          onChange={(event) => setBrandId(event.target.value)}
          value={brandId}
        >
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name || brand.domain}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending || !brandId}
          onClick={() => run(onCreate)}
          variant="outline"
        >
          {createLabel}
        </Button>
        <Button
          className="gap-2 bg-[color:var(--findable-primary,#ff7a4d)] text-black hover:bg-[color:var(--findable-primary,#ff7a4d)]/90"
          disabled={pending || !brandId}
          onClick={() => run(onGenerate)}
        >
          {pending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <SparklesIcon className="size-4" />
          )}
          {label}
        </Button>
      </div>
    </div>
  );
}
