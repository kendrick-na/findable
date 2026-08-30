import { cn } from "@repo/design-system/lib/utils";
import type { PageSpeedMeasurement } from "@/lib/site-readiness/types";
import type { SiteReadinessLabels } from "./site-readiness-form";

const ratingTone = {
  good: "border-emerald-500/25 bg-emerald-500/10",
  "needs-improvement": "border-amber-500/25 bg-amber-500/10",
  poor: "border-red-500/25 bg-red-500/10",
  unavailable: "border-white/10 bg-white/5",
};

function scoreRating(score: number | null) {
  if (score === null) {
    return "unavailable" as const;
  }
  if (score >= 90) {
    return "good" as const;
  }
  if (score >= 50) {
    return "needs-improvement" as const;
  }
  return "poor" as const;
}

export function PageSpeedPanel({
  labels,
  pageSpeed,
}: {
  labels: SiteReadinessLabels;
  pageSpeed: PageSpeedMeasurement;
}) {
  const sourceLabel = (source: "field" | "lab" | null) =>
    source === "field" ? labels.fieldDataLabel : labels.labDataLabel;
  const metrics = [
    {
      label: labels.pageSpeedPerformanceLabel,
      rating: scoreRating(pageSpeed.performanceScore),
      source: labels.labDataLabel,
      unit: "/100",
      value: pageSpeed.performanceScore,
    },
    {
      label: labels.pageSpeedSeoLabel,
      rating: scoreRating(pageSpeed.seoScore),
      source: labels.labDataLabel,
      unit: "/100",
      value: pageSpeed.seoScore,
    },
    {
      label: labels.pageSpeedLcpLabel,
      rating: pageSpeed.lcpMs.rating,
      source: sourceLabel(pageSpeed.lcpMs.source),
      unit: "s",
      value:
        pageSpeed.lcpMs.value === null
          ? null
          : (pageSpeed.lcpMs.value / 1000).toFixed(1),
    },
    {
      label: labels.pageSpeedInpLabel,
      rating: pageSpeed.inpMs.rating,
      source: sourceLabel(pageSpeed.inpMs.source),
      unit: "ms",
      value:
        pageSpeed.inpMs.value === null
          ? null
          : Math.round(pageSpeed.inpMs.value),
    },
    {
      label: labels.pageSpeedClsLabel,
      rating: pageSpeed.cls.rating,
      source: sourceLabel(pageSpeed.cls.source),
      unit: "",
      value:
        pageSpeed.cls.value === null ? null : pageSpeed.cls.value.toFixed(3),
    },
  ];

  return (
    <section className="findable-card overflow-hidden">
      <div className="flex flex-col justify-between gap-2 border-[color:var(--findable-hairline,#23252a)] border-b px-5 py-4 sm:flex-row sm:items-end">
        <div>
          <h3 className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
            {labels.pageSpeedTitle}
          </h3>
          <p className="mt-1 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
            {labels.mobileLabel} · Google PageSpeed Insights
            {pageSpeed.fieldDataProvider === "crux" ? " + CrUX" : ""}
          </p>
        </div>
        {pageSpeed.measuredAt ? (
          <time className="font-mono text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
            {new Date(pageSpeed.measuredAt).toLocaleString(labels.locale)}
          </time>
        ) : null}
      </div>
      {pageSpeed.errorCode ? (
        <div className="px-5 py-5 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
          {labels.pageSpeedUnavailable}
          <span className="ml-2 font-mono text-white/30 text-xs">
            {pageSpeed.errorCode}
          </span>
        </div>
      ) : (
        <>
          <div className="grid gap-px bg-[color:var(--findable-hairline,#23252a)] sm:grid-cols-2 lg:grid-cols-5">
            {metrics.map((metric) => (
              <div
                className="bg-[color:var(--findable-surface-1,#0f1011)] p-5"
                key={metric.label}
              >
                <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                  {metric.label}
                </p>
                <div className="mt-3 flex items-end justify-between gap-2">
                  <p className="font-mono font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
                    {metric.value ?? "—"}
                    <span className="ml-0.5 font-normal text-sm text-white/45">
                      {metric.unit}
                    </span>
                  </p>
                  <span
                    className={cn(
                      "size-2.5 rounded-full border",
                      ratingTone[metric.rating]
                    )}
                    title={metric.rating}
                  />
                </div>
                <p className="mt-2 text-[10px] text-white/30 uppercase tracking-wide">
                  {metric.value === null ? "—" : metric.source}
                </p>
              </div>
            ))}
          </div>
          {pageSpeed.opportunities.length > 0 ? (
            <div className="border-[color:var(--findable-hairline,#23252a)] border-t px-5 py-4">
              <p className="mb-3 font-medium text-sm">
                {labels.pageSpeedOpportunityTitle}
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {pageSpeed.opportunities.map((opportunity) => (
                  <li
                    className="rounded-lg border border-white/8 bg-black/10 px-3 py-2 text-xs"
                    key={opportunity.id}
                  >
                    <span className="text-[color:var(--findable-ink-muted,#d0d6e0)]">
                      {opportunity.title}
                    </span>
                    {opportunity.displayValue ? (
                      <span className="ml-2 font-mono text-[color:var(--findable-primary,#ff7a4d)]">
                        {opportunity.displayValue}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {pageSpeed.fieldDataPeriod ? (
            <p className="border-[color:var(--findable-hairline,#23252a)] border-t px-5 py-3 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
              CrUX 실제 사용자 데이터 기간:{" "}
              {pageSpeed.fieldDataPeriod.firstDate}–
              {pageSpeed.fieldDataPeriod.lastDate} · 모바일 p75
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
