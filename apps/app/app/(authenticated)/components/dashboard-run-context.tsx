import { CalendarClock, ExternalLink, FileText } from "lucide-react";
import type { AppDictionary } from "@/lib/i18n";

export function DashboardRunContext({
  brandName,
  dateLocale,
  jobId,
  measuredAt,
  reportUrl,
  t,
}: {
  brandName: string | null;
  /** 측정 시각 표기 로케일(`dateLocaleFor`). */
  dateLocale: string;
  jobId: string | null;
  measuredAt: Date | null;
  /** 완료 회차의 정식 결과 화면은 공개 리포트다. */
  reportUrl: string | null;
  t: AppDictionary["runContext"];
}) {
  if (!measuredAt) {
    return null;
  }

  const label = new Intl.DateTimeFormat(dateLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
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
            {brandName ?? t.thisBrand}
          </span>
          {t.measuredAt.replace("{date}", label)}
        </p>
      </div>
      {jobId && reportUrl ? (
        <a
          className="inline-flex shrink-0 items-center gap-1.5 text-[color:var(--findable-primary,#ff7a4d)] text-sm hover:underline"
          href={reportUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <FileText aria-hidden="true" className="size-4" />
          {t.viewReport}
          <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="sr-only">{t.newTab}</span>
        </a>
      ) : (
        <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
          {t.seeHistory}
        </span>
      )}
    </section>
  );
}
