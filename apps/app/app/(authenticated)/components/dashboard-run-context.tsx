import { CalendarClock, FileText } from "lucide-react";
import Link from "next/link";

export function DashboardRunContext({
  brandName,
  jobId,
  measuredAt,
}: {
  brandName: string | null;
  jobId: string | null;
  measuredAt: Date | null;
}) {
  if (!measuredAt) return null;

  const label = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(measuredAt);

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--findable-hairline,#2d3035)] bg-[color:var(--findable-surface-1,#111214)] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <CalendarClock
          aria-hidden="true"
          className="size-4 shrink-0 text-[color:var(--findable-primary,#ff7a4d)]"
        />
        <p className="truncate text-[color:var(--findable-ink-subtle,#8a8f98)]">
          <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
            {brandName ?? "이 브랜드"}
          </span>
          {` · ${label} 측정 결과`}
        </p>
      </div>
      {jobId ? (
        <Link
          className="inline-flex shrink-0 items-center gap-1.5 text-sm text-[color:var(--findable-primary,#ff7a4d)] hover:underline"
          href={`/history/${jobId}`}
        >
          <FileText aria-hidden="true" className="size-4" />
          이 회차 리포트 보기
        </Link>
      ) : (
        <span className="text-xs text-[color:var(--findable-ink-subtle,#8a8f98)]">
          이 회차의 상세 결과는 측정 이력에서 확인할 수 있어요
        </span>
      )}
    </section>
  );
}
