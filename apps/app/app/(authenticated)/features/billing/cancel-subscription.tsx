"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { toast } from "@repo/design-system/components/ui/sonner";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { unsubscribe } from "@/app/actions/billing/subscription";
import type { AppDictionary } from "@/lib/i18n";

/**
 * 정기결제 해지 버튼 — 2026-08-11 세션N-18.
 *
 * ⚖️ **전자상거래법 제5조 제4항**: 가입(계약)을 웹에서 받았다면 해지도 **웹에서** 할 수 있어야 한다.
 *   전화·이메일로만 해지받는 구조는 위법이다. 그래서 이 버튼은 요금제 화면에 **상시 노출**한다.
 *
 * 🔒 다크패턴 금지(한국어 UX 라이팅 규칙):
 *   - 해지 버튼을 숨기거나 회색으로 가려 찾기 어렵게 만들지 않는다.
 *   - 확인 문구로 겁주지 않는다("정말요? 혜택이 사라져요!" 같은 만류 카피 금지).
 *   - 다만 **오클릭 방지**를 위한 1회 확인은 둔다(되돌릴 수 없는 동작이므로).
 */
export const CancelSubscription = ({
  t,
}: {
  /** 사전 `app.cancelSubscription`. */
  t: AppDictionary["cancelSubscription"];
}) => {
  const router = useRouter();
  const [isConfirming, setConfirming] = useState(false);
  const [isPending, setPending] = useState(false);

  const run = async () => {
    setPending(true);
    try {
      const result = await unsubscribe();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(t.done);
      setConfirming(false);
      router.refresh();
    } catch {
      toast.error(t.failed);
    } finally {
      setPending(false);
    }
  };

  if (!isConfirming) {
    return (
      <button
        className="self-start text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs underline underline-offset-4 hover:text-[color:var(--findable-ink,#f7f8f8)]"
        onClick={() => setConfirming(true)}
        type="button"
      >
        {t.open}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-[color:var(--findable-hairline,#23252a)] p-3">
      <p className="text-[color:var(--findable-ink-muted,#d0d6e0)] text-xs">
        {t.body}
      </p>
      <div className="flex gap-2">
        <Button
          disabled={isPending}
          onClick={run}
          size="sm"
          variant="destructive"
        >
          {isPending ? t.processing : t.confirm}
        </Button>
        <Button
          disabled={isPending}
          onClick={() => setConfirming(false)}
          size="sm"
          variant="ghost"
        >
          {t.keep}
        </Button>
      </div>
    </div>
  );
};
