"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { toast } from "@repo/design-system/components/ui/sonner";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { ContentActionResult } from "@/app/actions/content/manage";

export function CreateOfficialButton({
  label,
  locale,
  onCreate,
}: {
  label: string;
  locale: "ko" | "en";
  onCreate: (locale: "ko" | "en") => Promise<ContentActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      className="bg-[color:var(--findable-primary,#ff7a4d)] text-black hover:bg-[color:var(--findable-primary,#ff7a4d)]/90"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await onCreate(locale);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          if (result.contentId) {
            router.push(`/insights/${result.contentId}`);
          }
        })
      }
    >
      {pending ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : (
        <PlusIcon className="size-4" />
      )}
      {label}
    </Button>
  );
}
