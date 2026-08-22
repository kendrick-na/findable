"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { toast } from "@repo/design-system/components/ui/sonner";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import type { RedeemResult } from "@/app/actions/invite/redeem";

/**
 * 초대 코드 입력 폼 — 프로그램 참가 기업이 권한을 여는 자리.
 *
 * 🔴 **서버액션을 import 하지 않고 주입받는다**(`onRedeem` prop).
 *   직접 import 하면 `node:*` 가 브라우저 번들로 끌려와 **Storybook 21장이 통째로 죽는다**
 *   (N-41 실측 · N-37 과 같은 함정). 타입만 `import type` 으로 가져온다.
 */

interface FormState {
  error?: string;
  status: "idle" | "ok";
}

const initialState: FormState = { status: "idle" };

export const RedeemForm = ({
  onRedeem,
}: {
  onRedeem?: (input: { code: string }) => Promise<RedeemResult>;
}) => {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      if (!onRedeem) {
        return { status: "idle" };
      }
      const result = await onRedeem({
        code: String(formData.get("code") ?? ""),
      });
      if ("error" in result) {
        return { status: "idle", error: result.error };
      }
      // 만료일을 **날짜로** 알린다 — "30일"이라고만 하면 언제까지인지 세어야 한다.
      toast.success(
        `적용됐어요. ${result.expiresAt.toLocaleDateString("ko-KR")}까지 쓸 수 있어요.`
      );
      return { status: "ok" };
    },
    initialState
  );

  useEffect(() => {
    if (state.status === "ok") {
      router.refresh();
    }
  }, [state.status, router]);

  return (
    <form action={formAction} className="findable-card flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-base">
          초대 코드
        </h2>
        <p
          className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm"
          style={{ wordBreak: "keep-all" }}
        >
          프로그램에서 받은 코드가 있다면 입력해 주세요. 바로 적용돼요.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-code">코드</Label>
        <Input
          autoComplete="off"
          // 대문자로 보이게 한다 — 서버도 대문자로 정규화하므로 화면과 저장이 일치한다.
          className="uppercase"
          id="invite-code"
          name="code"
          placeholder="예: OVEREDGE2026"
          required
        />
      </div>
      {state.error ? (
        <p
          className="text-[color:var(--signal-bad,#f87171)] text-sm"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button
          className="findable-btn-primary"
          disabled={isPending || !onRedeem}
          type="submit"
        >
          {isPending ? "적용하는 중…" : "적용하기"}
        </Button>
      </div>
    </form>
  );
};
