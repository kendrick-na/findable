"use client";

import { cn } from "@repo/design-system/lib/utils";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleXIcon,
  InfoIcon,
  LoaderCircleIcon,
  ScanSearchIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { runSiteReadiness } from "@/app/actions/site-readiness/run";
import { buildSiteReadinessTasks } from "@/lib/site-readiness/execution-playbook";
import type {
  ReadinessCategory,
  ReadinessCheckId,
  ReadinessSeverity,
  ReadinessStatus,
  SiteFindingCode,
  SiteReadinessActionState,
  SiteReadinessReport,
  StoredSiteReadinessRun,
} from "@/lib/site-readiness/types";
import { ExecutionPlaybook } from "./execution-playbook";
import { PageSpeedPanel } from "./pagespeed-panel";

export interface SiteReadinessLabels {
  adviceLabel: string;
  auditedLabel: string;
  autoCompleted: string;
  autoFailed: string;
  autoProcessing: string;
  autoQueued: string;
  autoTitle: string;
  canonicalColumn: string;
  categories: Record<ReadinessCategory, string>;
  checkedAt: string;
  checkItems: Record<ReadinessCheckId, { advice: string; title: string }>;
  crawlDescription: string;
  crawlTitle: string;
  cta: string;
  description: string;
  discoveredLabel: string;
  errors: Record<string, string>;
  evidenceLabel: string;
  eyebrow: string;
  fieldDataLabel: string;
  findingItems: Record<SiteFindingCode, { advice: string; title: string }>;
  findingsDescription: string;
  findingsTitle: string;
  formHint: string;
  indexableLabel: string;
  indexingColumn: string;
  inputLabel: string;
  inputPlaceholder: string;
  issueCountLabel: string;
  labDataLabel: string;
  locale: string;
  measuringCta: string;
  mobileLabel: string;
  noLabel: string;
  noScoreBody: string;
  noScoreTitle: string;
  pageColumn: string;
  pageSpeedClsLabel: string;
  pageSpeedInpLabel: string;
  pageSpeedLcpLabel: string;
  pageSpeedOpportunityTitle: string;
  pageSpeedPerformanceLabel: string;
  pageSpeedSeoLabel: string;
  pageSpeedTitle: string;
  pageSpeedUnavailable: string;
  performanceTitle: string;
  previousComparison: string;
  passedChecksLabel: string;
  playbookLinkLabel: string;
  prioritySummaryLabel: string;
  technicalLinkLabel: string;
  recheckCta: string;
  responseColumn: string;
  responseSizeLabel: string;
  resultCta: string;
  resultDescription: string;
  resultTitle: string;
  schemaColumn: string;
  severity: Record<ReadinessSeverity, string>;
  status: Record<ReadinessStatus, string>;
  title: string;
  totalResponseLabel: string;
  ttfbLabel: string;
  yesLabel: string;
}

const initialState: SiteReadinessActionState = { status: "idle" };
const statusOrder: Record<ReadinessStatus, number> = {
  fail: 0,
  warning: 1,
  pass: 2,
  info: 3,
};

const statusTone: Record<ReadinessStatus, string> = {
  fail: "border-red-500/20 bg-red-500/8 text-red-600 dark:text-red-400",
  warning:
    "border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-400",
  pass: "border-emerald-500/20 bg-emerald-500/8 text-emerald-700 dark:text-emerald-400",
  info: "border-sky-500/20 bg-sky-500/8 text-sky-700 dark:text-sky-400",
};

const statusIconTone: Record<ReadinessStatus, string> = {
  fail: "text-red-600 dark:text-red-400",
  warning: "text-amber-700 dark:text-amber-400",
  pass: "text-emerald-700 dark:text-emerald-400",
  info: "text-sky-700 dark:text-sky-400",
};

const statusIcon = {
  fail: CircleXIcon,
  warning: CircleAlertIcon,
  pass: CheckCircle2Icon,
  info: InfoIcon,
};

function submitLabel(
  busy: boolean,
  hasReport: boolean,
  labels: SiteReadinessLabels
) {
  if (busy) {
    return labels.measuringCta;
  }
  return hasReport ? labels.recheckCta : labels.cta;
}

function AutomaticRunStatus({
  labels,
  run,
}: {
  labels: SiteReadinessLabels;
  run: StoredSiteReadinessRun;
}) {
  let message = labels.autoCompleted;
  let icon = (
    <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
  );
  if (run.status === "queued") {
    message = labels.autoQueued;
    icon = (
      <LoaderCircleIcon className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" />
    );
  } else if (run.status === "processing") {
    message = labels.autoProcessing;
    icon = (
      <LoaderCircleIcon className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" />
    );
  } else if (run.status === "failed") {
    const error =
      labels.errors[run.errorCode ?? "UNKNOWN"] ?? labels.errors.UNKNOWN;
    message = `${labels.autoFailed} ${error}`;
    icon = <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />;
  }

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        run.status === "failed"
          ? "border-red-500/20 bg-red-500/8 text-red-600 dark:text-red-400"
          : "border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-2,#17181b)] text-[color:var(--findable-ink-muted,#d0d6e0)]"
      )}
    >
      {icon}
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{labels.autoTitle}</span>
        <span>{message}</span>
      </div>
    </div>
  );
}

const severityTone: Record<ReadinessSeverity, string> = {
  critical: "border-red-500/25 bg-red-500/8 text-red-600 dark:text-red-400",
  high: "border-orange-500/25 bg-orange-500/8 text-orange-700 dark:text-orange-400",
  medium:
    "border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-400",
  low: "border-sky-500/25 bg-sky-500/8 text-sky-700 dark:text-sky-400",
};

function TechnicalOverview({
  labels,
  previousReport,
  report,
}: {
  labels: SiteReadinessLabels;
  previousReport: SiteReadinessReport | null;
  report: SiteReadinessReport;
}) {
  if (!(report.performance && report.crawl)) {
    return null;
  }
  const indexable = report.crawl.pages.filter((page) => page.indexable).length;
  const previousPerformance = previousReport?.performance;
  const delta = (current: number, previous?: number, divisor = 1) => {
    if (previous === undefined) {
      return null;
    }
    const value = Math.round((current - previous) / divisor);
    return `${value > 0 ? "+" : ""}${value}`;
  };
  const metrics = [
    {
      delta: delta(report.performance.ttfbMs, previousPerformance?.ttfbMs),
      label: labels.ttfbLabel,
      unit: "ms",
      value: report.performance.ttfbMs,
    },
    {
      delta: delta(
        report.performance.totalResponseMs,
        previousPerformance?.totalResponseMs
      ),
      label: labels.totalResponseLabel,
      unit: "ms",
      value: report.performance.totalResponseMs,
    },
    {
      delta: delta(
        report.performance.responseBytes,
        previousPerformance?.responseBytes,
        1024
      ),
      label: labels.responseSizeLabel,
      unit: "KB",
      value: Math.round(report.performance.responseBytes / 1024),
    },
  ];
  const pageSpeed = report.performance.pageSpeed;

  return (
    <div className="flex flex-col gap-5">
      <section className="findable-card p-5">
        <div className="flex items-end justify-between gap-3">
          <h3 className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
            {labels.performanceTitle}
          </h3>
          {previousPerformance ? (
            <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
              {labels.previousComparison}
            </span>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {metrics.map((metric) => (
            <div
              className="rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-0,#090a0b)] p-4"
              key={metric.label}
            >
              <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                {metric.label}
              </p>
              <p className="mt-2 font-mono font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
                {metric.value}
                {metric.unit}
              </p>
              {metric.delta ? (
                <p className="mt-1 font-mono text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                  {metric.delta}
                  {metric.unit}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {pageSpeed ? (
        <PageSpeedPanel labels={labels} pageSpeed={pageSpeed} />
      ) : null}

      <section className="findable-card overflow-hidden">
        <div className="flex flex-col justify-between gap-2 border-[color:var(--findable-hairline,#23252a)] border-b px-5 py-4 sm:flex-row sm:items-end">
          <div>
            <h3 className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
              {labels.crawlTitle}
            </h3>
            <p className="mt-1 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
              {labels.crawlDescription}
            </p>
          </div>
          <div className="flex gap-4 font-mono text-xs">
            <span>
              {labels.auditedLabel} {report.crawl.audited}
            </span>
            <span>
              {labels.discoveredLabel} {report.crawl.discovered}
            </span>
            <span>
              {labels.indexableLabel} {indexable}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-[color:var(--findable-surface-2,#17181b)] text-[color:var(--findable-ink-tertiary,#7e8289)]">
              <tr>
                <th className="px-4 py-3 font-medium">{labels.pageColumn}</th>
                <th className="px-4 py-3 font-medium">
                  {labels.responseColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {labels.indexingColumn}
                </th>
                <th className="px-4 py-3 font-medium">
                  {labels.canonicalColumn}
                </th>
                <th className="px-4 py-3 font-medium">{labels.schemaColumn}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--findable-hairline,#23252a)]">
              {report.crawl.pages.map((page) => (
                <tr key={page.url}>
                  <td
                    className="max-w-xs truncate px-4 py-3 font-mono text-[color:var(--findable-ink-muted,#d0d6e0)]"
                    title={page.finalUrl}
                  >
                    {new URL(page.finalUrl).pathname || "/"}
                  </td>
                  <td className="px-4 py-3 font-mono text-[color:var(--findable-ink-subtle,#8a8f98)]">
                    HTTP {page.statusCode} · {page.ttfbMs}ms
                  </td>
                  <td className="px-4 py-3">
                    {page.indexable ? labels.yesLabel : labels.noLabel}
                  </td>
                  <td className="px-4 py-3">
                    {page.canonicalMatches === true
                      ? labels.yesLabel
                      : labels.noLabel}
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {page.schema.types.join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
            {labels.findingsTitle}
          </h3>
          <p className="mt-1 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
            {labels.findingsDescription}
          </p>
          {previousReport?.findings ? (
            <p className="mt-1 font-mono text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
              {labels.issueCountLabel} {(report.findings ?? []).length} ·{" "}
              {labels.previousComparison} {previousReport.findings.length}
            </p>
          ) : null}
        </div>
        {(report.findings ?? []).map((finding) => {
          const item = labels.findingItems[finding.code];
          return (
            <article
              className="findable-card grid gap-3 p-4 sm:grid-cols-[auto_minmax(0,1fr)_minmax(180px,0.8fr)]"
              key={finding.code}
            >
              <span
                className={cn(
                  "h-fit rounded-full border px-2 py-1 font-medium text-[11px]",
                  severityTone[finding.severity]
                )}
              >
                {labels.severity[finding.severity]}
              </span>
              <div className="min-w-0">
                <h4 className="font-medium text-sm">
                  {item.title} · {finding.affectedCount}
                </h4>
                <p className="mt-1 break-words font-mono text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                  {finding.evidence}
                </p>
              </div>
              <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs leading-5">
                {item.advice}
              </p>
            </article>
          );
        })}
      </section>
    </div>
  );
}

export function SiteReadinessForm({
  brandId,
  completedTaskIds,
  defaultUrl,
  initialRun,
  labels,
  previousReport,
}: {
  brandId: string;
  completedTaskIds: string[];
  defaultUrl: string;
  initialRun: StoredSiteReadinessRun | null;
  labels: SiteReadinessLabels;
  previousReport: SiteReadinessReport | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    runSiteReadiness,
    initialState
  );
  const backgroundRunning =
    initialRun?.status === "queued" || initialRun?.status === "processing";
  const report =
    state.status === "ok" ? state.report : (initialRun?.report ?? null);
  const busy = pending || backgroundRunning;
  const currentTasks = report
    ? buildSiteReadinessTasks(report, labels.locale)
    : [];
  const previousTasks = previousReport
    ? buildSiteReadinessTasks(previousReport, labels.locale)
    : [];

  useEffect(() => {
    if (!backgroundRunning) {
      return;
    }
    const interval = window.setInterval(() => router.refresh(), 2500);
    return () => window.clearInterval(interval);
  }, [backgroundRunning, router]);
  const sortedChecks = report
    ? [...report.checks].sort(
        (left, right) => statusOrder[left.status] - statusOrder[right.status]
      )
    : [];
  const actionableChecks = sortedChecks.filter(
    (check) => check.status === "fail" || check.status === "warning"
  );
  const passedChecks = sortedChecks.filter(
    (check) => check.status === "pass" || check.status === "info"
  );

  const renderCheck = (check: (typeof sortedChecks)[number]) => {
    const StatusIcon = statusIcon[check.status];
    const item = labels.checkItems[check.id];
    return (
      <li
        className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(180px,0.8fr)_minmax(0,1.4fr)_minmax(0,1.2fr)]"
        key={check.id}
      >
        <div className="flex items-start gap-3">
          <StatusIcon
            aria-hidden="true"
            className={cn(
              "mt-0.5 size-4 shrink-0",
              statusIconTone[check.status]
            )}
          />
          <div className="flex flex-col gap-1">
            <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
              {item.title}
            </span>
            <span
              className={cn(
                "w-fit rounded-full border px-2 py-0.5 font-medium text-[11px]",
                statusTone[check.status]
              )}
            >
              {labels.status[check.status]}
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[11px] text-[color:var(--findable-ink-tertiary,#7e8289)] uppercase tracking-wide">
            {labels.evidenceLabel}
          </p>
          <p className="break-words font-mono text-[color:var(--findable-ink-muted,#d0d6e0)] text-xs leading-5">
            {check.evidence}
          </p>
        </div>
        <div>
          <p className="mb-1 text-[11px] text-[color:var(--findable-ink-tertiary,#7e8289)] uppercase tracking-wide">
            {labels.adviceLabel}
          </p>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs leading-5">
            {item.advice}
          </p>
        </div>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-2xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-6 sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full bg-[color:var(--findable-primary,#ff7a4d)]/10 blur-3xl" />
        <div className="relative flex max-w-3xl flex-col gap-5">
          <div className="flex items-center gap-2 font-medium text-[color:var(--findable-primary,#ff7a4d)] text-xs uppercase tracking-[0.18em]">
            <ScanSearchIcon className="size-4" />
            {labels.eyebrow}
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="max-w-2xl font-semibold text-3xl text-[color:var(--findable-ink,#f7f8f8)] tracking-tight sm:text-4xl">
              {labels.title}
            </h1>
            <p className="max-w-2xl text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-6 sm:text-base">
              {labels.description}
            </p>
          </div>

          <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
            <input name="brandId" type="hidden" value={brandId} />
            <label className="sr-only" htmlFor="site-readiness-url">
              {labels.inputLabel}
            </label>
            <input
              autoCapitalize="none"
              autoComplete="url"
              className="min-h-11 flex-1 rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-0,#090a0b)] px-4 text-[color:var(--findable-ink,#f7f8f8)] text-sm transition-colors placeholder:text-[color:var(--findable-ink-tertiary,#7e8289)] focus-visible:border-[color:var(--findable-primary,#ff7a4d)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--findable-primary,#ff7a4d)]/35"
              defaultValue={defaultUrl}
              disabled={busy || !brandId}
              id="site-readiness-url"
              name="url"
              placeholder={labels.inputPlaceholder}
              required
              type="url"
            />
            <button
              className="findable-btn-primary inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 font-medium text-sm disabled:cursor-wait disabled:opacity-70"
              disabled={busy || !brandId}
              type="submit"
            >
              {busy ? (
                <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <ScanSearchIcon className="size-4" />
              )}
              {submitLabel(busy, Boolean(report), labels)}
            </button>
          </form>
          <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
            {labels.formHint}
          </p>
          <div aria-live="polite">
            {initialRun && state.status !== "ok" && (
              <AutomaticRunStatus labels={labels} run={initialRun} />
            )}
            {state.status === "error" && (
              <p className="rounded-lg border border-red-500/20 bg-red-500/8 px-4 py-3 text-red-600 text-sm dark:text-red-400">
                {labels.errors[state.error] ?? labels.errors.UNKNOWN}
              </p>
            )}
          </div>
        </div>
      </section>

      {report && (
        <section className="flex flex-col gap-5" id="site-readiness-result">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
                {labels.resultTitle}
              </h2>
              <p className="truncate text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
                {report.finalUrl}
              </p>
              <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                {labels.checkedAt}{" "}
                {new Date(report.checkedAt).toLocaleString(labels.locale)}
              </p>
            </div>
            <Link
              className="inline-flex items-center gap-2 self-start font-medium text-[color:var(--findable-primary,#ff7a4d)] text-sm sm:self-auto"
              href="/brand"
            >
              {labels.resultCta}
              <ArrowRightIcon className="size-4" />
            </Link>
          </div>

          <nav aria-label="진단 결과 바로가기" className="flex flex-wrap gap-2">
            <a
              className="rounded-full border border-orange-400/25 bg-orange-400/10 px-3 py-1.5 text-orange-100 text-xs hover:bg-orange-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
              href="#priority-checks"
            >
              {labels.prioritySummaryLabel} {actionableChecks.length}
            </a>
            <a
              className="rounded-full border border-white/10 px-3 py-1.5 text-white/70 text-xs hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              href="#site-readiness-tasks"
            >
              {labels.playbookLinkLabel}
            </a>
            <a
              className="rounded-full border border-white/10 px-3 py-1.5 text-white/70 text-xs hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              href="#technical-overview"
            >
              {labels.technicalLinkLabel}
            </a>
          </nav>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {report.categories.map((category) => (
              <article
                className="findable-card flex flex-col gap-3 p-4"
                key={category.category}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
                    {labels.categories[category.category]}
                  </h3>
                  <span className="font-mono text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                    {category.total}
                  </span>
                </div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-[color:var(--findable-surface-2,#17181b)]">
                  {category.pass > 0 && (
                    <span
                      className="bg-emerald-500"
                      style={{
                        width: `${(category.pass / category.total) * 100}%`,
                      }}
                    />
                  )}
                  {category.warning > 0 && (
                    <span
                      className="bg-amber-500"
                      style={{
                        width: `${(category.warning / category.total) * 100}%`,
                      }}
                    />
                  )}
                  {category.fail > 0 && (
                    <span
                      className="bg-red-500"
                      style={{
                        width: `${(category.fail / category.total) * 100}%`,
                      }}
                    />
                  )}
                </div>
                <div className="flex gap-3 font-mono text-xs">
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {labels.status.pass} {category.pass}
                  </span>
                  <span className="text-amber-700 dark:text-amber-400">
                    {labels.status.warning} {category.warning}
                  </span>
                  <span className="text-red-600 dark:text-red-400">
                    {labels.status.fail} {category.fail}
                  </span>
                </div>
              </article>
            ))}
          </div>

          <div
            className="findable-card scroll-mt-24 overflow-hidden"
            id="priority-checks"
          >
            <div className="border-[color:var(--findable-hairline,#23252a)] border-b px-5 py-4">
              <h3 className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
                {labels.prioritySummaryLabel}
              </h3>
            </div>
            <ul className="divide-y divide-[color:var(--findable-hairline,#23252a)]">
              {actionableChecks.map(renderCheck)}
            </ul>
            <details className="border-[color:var(--findable-hairline,#23252a)] border-t">
              <summary className="cursor-pointer px-5 py-4 font-medium text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
                {labels.passedChecksLabel} ({passedChecks.length})
              </summary>
              <ul className="divide-y divide-[color:var(--findable-hairline,#23252a)]">
                {passedChecks.map(renderCheck)}
              </ul>
            </details>
          </div>

          <div className="scroll-mt-24" id="site-readiness-tasks">
            <ExecutionPlaybook
              brandId={brandId}
              completedTaskIds={completedTaskIds}
              currentTasks={currentTasks}
              locale={labels.locale}
              previousTasks={previousTasks}
            />
          </div>

          <div className="scroll-mt-24" id="technical-overview">
            <TechnicalOverview
              labels={labels}
              previousReport={previousReport}
              report={report}
            />
          </div>

          <aside className="flex gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
            <InfoIcon className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
            <div className="flex flex-col gap-1">
              <h3 className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
                {labels.noScoreTitle}
              </h3>
              <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs leading-5">
                {labels.noScoreBody}
              </p>
            </div>
          </aside>
        </section>
      )}
    </div>
  );
}
