import { PLAN_META, type Plan } from "@repo/auth/plan";
import { cn } from "@repo/design-system/lib/utils";
import { CheckCircle2, Crown, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

interface PlanBadgeProps {
  className?: string;
  plan: Plan;
  // 아이콘 표시 여부(사이드바 등 좁은 곳은 끔).
  showIcon?: boolean;
}

// tone → 브랜드 스타일. accent=오렌지, gradient=Pro, enterprise=차분한 프리미엄.
const TONE_CLASS: Record<string, string> = {
  neutral:
    "border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-2,#141516)] text-[color:var(--findable-ink-subtle,#8a8f98)]",
  accent:
    "border-[color:var(--findable-primary,#ff7a4d)]/30 bg-[color:var(--findable-primary,#ff7a4d)]/12 text-[color:var(--findable-primary,#ff7a4d)]",
  gradient:
    "border-transparent bg-gradient-to-r from-[color:var(--findable-primary,#ff7a4d)] to-[#ffb35c] text-black",
  enterprise:
    "border-[color:var(--findable-ink-muted,#d0d6e0)]/25 bg-[color:var(--findable-ink,#f7f8f8)]/8 text-[color:var(--findable-ink,#f7f8f8)]",
};

const TONE_ICON: Record<string, ReactNode> = {
  accent: <CheckCircle2 aria-hidden />,
  gradient: <Sparkles aria-hidden />,
  enterprise: <Crown aria-hidden />,
};

// 유저의 현재 plan 을 나타내는 배지. 라벨·톤은 PLAN_META 단일 출처.
export const PlanBadge = ({
  plan,
  className,
  showIcon = true,
}: PlanBadgeProps) => {
  const meta = PLAN_META[plan];
  const icon = showIcon ? TONE_ICON[meta.tone] : null;

  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-xs [&>svg]:size-3",
        TONE_CLASS[meta.tone],
        className
      )}
      data-plan={plan}
    >
      {icon}
      {meta.label}
    </span>
  );
};
