"use client";

// 액션 목록 (2026-07-31 세션K-2) — 우선순위·근거·완료 체크.
// 클라이언트 컴포넌트인 이유: 완료 토글(서버액션 호출 + 낙관적 표시)이 필요하다.

import { Button } from "@repo/design-system/components/ui/button";
import { toast } from "@repo/design-system/components/ui/sonner";
import { cn } from "@repo/design-system/lib/utils";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import {
  toggleActionCompletion,
  toggleActionCompletionByDomain,
} from "@/app/actions/brand/complete-action";

/**
 * 이 액션이 어디에 붙는가 — 두 경로를 하나의 UI 로 다룬다 (2026-08-10 세션N-13).
 *
 * · `tracked`  = 이미 추적 중인 브랜드(brandId 있음). 기존 경로.
 * · `audit`    = **무료 진단만 받은 사용자**(brandId 없음). 완료를 누르는 순간
 *                서버가 domain 으로 Brand 를 도출/생성해 연결한다.
 *
 * 🔴 왜 유니온인가: `brandId?: string` 로 두면 "둘 다 없는" 상태가 타입상 허용돼
 *   런타임에야 터진다. 유니온이면 **컴파일러가 둘 중 하나를 강제**한다.
 */
export type ActionTarget =
  | { kind: "tracked"; brandId: string }
  | { kind: "audit"; domain: string; brandName?: string };

export interface ActionItem {
  completed: boolean;
  /** 완료 시점 SoV — 지금 값과 비교해 변화를 보여준다(루프 닫기). */
  completedSov: number | null;
  evidence: string;
  how: string;
  kind: string;
  priority: number;
  source?: string;
  target: string;
  title: string;
}

const PRIORITY_META: Record<number, { label: string; tone: string }> = {
  3: {
    label: "지금 하세요",
    tone: "bg-[color:var(--findable-primary,#ff7a4d)]/15 text-[color:var(--findable-primary,#ff7a4d)]",
  },
  2: { label: "다음 단계", tone: "bg-sky-500/12 text-sky-300" },
  1: {
    label: "참고",
    tone: "bg-white/8 text-[color:var(--findable-ink-subtle,#8a8f98)]",
  },
};

export const ActionList = ({
  actions,
  currentSov,
  target,
}: {
  actions: ActionItem[];
  currentSov: number | null;
  target: ActionTarget;
}) => (
  <div className="flex flex-col gap-3">
    {actions.map((action) => (
      <ActionCard
        action={action}
        currentSov={currentSov}
        key={`${action.kind}:${action.target}`}
        target={target}
      />
    ))}
  </div>
);

const ActionCard = ({
  action,
  currentSov,
  target,
}: {
  action: ActionItem;
  currentSov: number | null;
  target: ActionTarget;
}) => {
  const [done, setDone] = useState(action.completed);
  const [pending, startTransition] = useTransition();
  const meta = PRIORITY_META[action.priority] ?? PRIORITY_META[1];

  // 루프 닫기: 완료 시점 대비 현재 SoV 변화.
  const delta =
    done && action.completedSov !== null && currentSov !== null
      ? Math.round(currentSov - action.completedSov)
      : null;

  const onToggle = () => {
    startTransition(async () => {
      const next = !done;
      setDone(next); // 낙관적 반영
      // 추적 중이면 brandId 로, 무료 진단 경로면 domain 으로 — 서버가 Brand 를 도출한다.
      const result =
        target.kind === "tracked"
          ? await toggleActionCompletion({
              brandId: target.brandId,
              kind: action.kind,
              target: action.target,
              sov: currentSov ?? undefined,
            })
          : await toggleActionCompletionByDomain({
              domain: target.domain,
              brandName: target.brandName,
              kind: action.kind,
              target: action.target,
              sov: currentSov ?? undefined,
            });
      if (result.error) {
        setDone(!next); // 롤백
        toast.error(result.error);
        return;
      }
      toast.success(next ? "완료로 표시했어요" : "완료를 취소했어요");
    });
  };

  return (
    <div
      className={cn(
        "findable-card flex flex-col gap-3 p-5 transition-opacity",
        done && "opacity-60"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-medium text-xs",
            meta?.tone
          )}
        >
          {meta?.label}
        </span>
        {delta !== null && delta !== 0 && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-medium text-xs tabular-nums",
              delta > 0
                ? "bg-emerald-500/12 text-emerald-300"
                : "bg-red-500/12 text-red-300"
            )}
          >
            완료 후 {delta > 0 ? "+" : ""}
            {delta}%p
          </span>
        )}
      </div>

      <h3
        className={cn(
          "font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-base leading-snug",
          done && "line-through"
        )}
      >
        {action.title}
      </h3>

      <p className="text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm leading-relaxed">
        {action.evidence}
      </p>

      <div className="rounded border border-white/6 bg-white/[0.02] p-3">
        <p className="whitespace-pre-line text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
          {action.how}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {action.source && (
          <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
            근거: {action.source}
          </p>
        )}
        <Button
          className="ml-auto"
          disabled={pending}
          onClick={onToggle}
          size="sm"
          variant={done ? "secondary" : "outline"}
        >
          {pending ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <CheckIcon className="size-3.5" />
          )}
          {done ? "완료됨" : "완료로 표시"}
        </Button>
      </div>
    </div>
  );
};
