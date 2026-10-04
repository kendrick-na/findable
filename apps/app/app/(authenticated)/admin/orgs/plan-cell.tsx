import { Badge } from "@repo/design-system/components/ui/badge";

/**
 * Admin plan display (2026-10-05): the effective plan first (what gates use —
 * Clerk payment + DB grant), the raw `Organization.plan` as a secondary
 * "DB grant" line, and an "unverified" marker when Clerk could not be read.
 * Presentational only, so the client table and the server page share it.
 */
export function PlanCell({
  dbPlan,
  plan,
  verified,
}: {
  dbPlan: string;
  plan: string;
  verified: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <div className="flex items-center gap-1">
        <Badge variant="outline">{plan}</Badge>
        {verified ? null : (
          <span
            className="text-[color:var(--signal-warn,#e0a458)] text-xs"
            data-testid="plan-unverified"
            title="결제 권한(Clerk) 조회 실패 — DB 부여분만으로 표시합니다."
          >
            미확인
          </span>
        )}
      </div>
      <span
        className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs"
        data-testid="plan-db-grant"
      >
        DB 부여 {dbPlan}
      </span>
    </div>
  );
}
