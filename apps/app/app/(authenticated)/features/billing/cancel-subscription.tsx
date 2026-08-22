"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { toast } from "@repo/design-system/components/ui/sonner";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { unsubscribe } from "@/app/actions/billing/subscription";

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
export const CancelSubscription = () => {
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
      toast.success("정기결제가 해지되었어요. 다음 결제부터 청구되지 않아요.");
      setConfirming(false);
      router.refresh();
    } catch {
      toast.error(
        "해지 처리 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요."
      );
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
        정기결제 해지
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-[color:var(--findable-hairline,#23252a)] p-3">
      <p className="text-[color:var(--findable-ink-muted,#d0d6e0)] text-xs">
        해지하면 다음 결제일부터 자동결제가 중단돼요. 이미 결제한 이용 기간은
        그대로 사용할 수 있어요.
      </p>
      <div className="flex gap-2">
        <Button
          disabled={isPending}
          onClick={run}
          size="sm"
          variant="destructive"
        >
          {isPending ? "처리 중…" : "해지하기"}
        </Button>
        <Button
          disabled={isPending}
          onClick={() => setConfirming(false)}
          size="sm"
          variant="ghost"
        >
          유지하기
        </Button>
      </div>
    </div>
  );
};
