import { cn } from "@repo/design-system/lib/utils";
import { Handshake } from "lucide-react";

/**
 * 파트너 배지 — plan 배지와 **별개 축**.
 *
 * 진실 = DB PartnerApplication.status === "approved" (plan 이 아님).
 * 승인된 파트너는 plan="growth" 를 받으므로 PlanBadge 로는 일반 Growth 결제자와
 * 구분되지 않는다. 이 배지가 "승인 파트너"를 시각적으로 분리한다.
 * (plan.ts §파트너: "파트너 배지 표시는 plan 과 별개".)
 *
 * 노출 판정은 호출부에서(승인 파트너일 때만 렌더). 이 컴포넌트는 표기만.
 */
export const PartnerBadge = ({ className }: { className?: string }) => (
  <span
    className={cn(
      "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-xs [&>svg]:size-3",
      "border-[color:var(--findable-primary,#ff7a4d)]/30 bg-[color:var(--findable-primary,#ff7a4d)]/10 text-[color:var(--findable-primary,#ff7a4d)]",
      className
    )}
    data-partner="approved"
  >
    <Handshake aria-hidden />
    파트너
  </span>
);
