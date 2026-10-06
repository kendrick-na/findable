import {
  auditPublicationStatus,
  withRecomputedAuditMetrics,
} from "@repo/audit/normalize-stored-metrics";
import { isUsableRun } from "@repo/audit/run-quality";
import type { AuditJob } from "@repo/database";
import { Badge } from "@repo/design-system/components/ui/badge";
import { cn } from "@repo/design-system/lib/utils";
import { ClockIcon, ExternalLinkIcon } from "lucide-react";
import { env } from "@/env";
import { type AppDictionary, type AppLocale, dateLocaleFor } from "@/lib/i18n";
import { publicReportUrl } from "@/lib/public-report";
import { extractBrandName, extractSov } from "../lib/dashboard-data";
import { EmptyState } from "./empty-state";

type StatusLabels = AppDictionary["jobStatus"];
type ListLabels = AppDictionary["historyList"];

// completed=초록 / processing·queued=노랑 / failed=빨강
const STATUS_TONE: Record<AuditJob["status"], string> = {
  queued: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  processing: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-600 dark:text-red-400",
};

interface AuditHistoryListProps {
  /** 빈 상태 기본 버튼 문구(사전 `app.common`). */
  common: AppDictionary["common"];
  jobs: AuditJob[];
  locale: AppLocale;
  status: StatusLabels;
  t: ListLabels;
}

function actionLabel(
  status: AuditJob["status"],
  isUnavailable: boolean,
  s: StatusLabels,
  t: ListLabels
): string {
  if (isUnavailable) {
    return s.unavailableLink;
  }
  if (status === "failed") {
    return t.failedReason;
  }
  if (status === "completed") {
    return s.viewResult;
  }
  return t.liveStatus;
}

function statusTone(
  status: AuditJob["status"],
  isUnavailable: boolean
): string {
  return isUnavailable ? STATUS_TONE.failed : STATUS_TONE[status];
}

function statusLabel(
  status: AuditJob["status"],
  isUnavailable: boolean,
  s: StatusLabels
): string {
  return isUnavailable ? s.unavailable : s[status];
}

/** Failure details for failed/unusable runs; live progress otherwise. */
function unfinishedRunHref(
  job: Pick<AuditJob, "id" | "status">,
  isUnavailable: boolean
): string {
  return job.status === "failed" || isUnavailable
    ? `/history/${job.id}`
    : `/brand/measuring?job=${job.id}`;
}

function hasCollectedEngineAnswer(result: unknown): boolean {
  const responses = (
    result as {
      engineResponses?: Array<{
        errorMessage?: string | null;
        isStub?: boolean;
      }>;
    } | null
  )?.engineResponses;
  return (
    responses?.some(
      (response) => !(response.errorMessage || response.isStub)
    ) ?? false
  );
}

export const AuditHistoryList = ({
  common,
  jobs,
  locale,
  status: s,
  t,
}: AuditHistoryListProps) => {
  const webUrl = env.NEXT_PUBLIC_WEB_URL;
  const dateFormatter = new Intl.DateTimeFormat(dateLocaleFor(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  });

  // 🔴 S2'(2026-08-11 세션N-19) — 여기 가드가 **없어서** `/history` 가 완전 공백이었다.
  //   `jobs.map()` 은 빈 배열에서 빈 `<ul>` 을 렌더한다 → 제목 두 줄 아래가 **아무것도 없음**.
  //   대시보드는 호출부(`page.tsx` 의 `hasData`)가 막아줘서 안 드러났고,
  //   `/history` 는 그 분기가 없어 그대로 노출됐다(가입자 6명 중 5명이 보는 경로).
  //   → 가드를 **컴포넌트 안**에 둔다: 호출부가 늘어도 같은 실수가 반복되지 않는다.
  if (jobs.length === 0) {
    return (
      <EmptyState
        description={t.emptyBody}
        icon={<ClockIcon className="size-5" />}
        t={common}
        title={t.emptyTitle}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {jobs.map((job) => {
        const result = withRecomputedAuditMetrics(job.result);
        const hasCollectedAnswer = hasCollectedEngineAnswer(result);
        const publicationStatus = auditPublicationStatus(result);
        const isPartial =
          job.status === "completed" &&
          hasCollectedAnswer &&
          publicationStatus === "provisional";
        const isUnavailable =
          job.status === "completed" && !isUsableRun(result);
        const sov = isUnavailable ? null : extractSov(result);
        const brandName = extractBrandName(result);
        // Each state has a real destination: live progress, failure details, or
        // the completed public report. Never label an unfinished run as a result.
        const isDone = job.status === "completed" && !isUnavailable;
        const rowClassName =
          "findable-card findable-card-interactive block p-4";
        const body = (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
                  {brandName ?? job.domain}
                </span>
                {brandName && (
                  <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
                    {job.domain}
                  </span>
                )}
              </div>
              <Badge
                className={cn(
                  "border-transparent",
                  isPartial
                    ? STATUS_TONE.processing
                    : statusTone(job.status, isUnavailable)
                )}
                variant="outline"
              >
                {isPartial
                  ? s.partial
                  : statusLabel(job.status, isUnavailable, s)}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              <span>{dateFormatter.format(job.createdAt)}</span>
              {sov !== null && (
                <span className="text-[color:var(--findable-ink,#f7f8f8)]">
                  {/* §5-3 교체표: SoV → 등장률(대시보드 히어로 카드와 같은 말) */}
                  {t.mentionRate}{" "}
                  <span className="font-semibold tabular-nums">{sov}%</span>
                </span>
              )}
              <span className="ml-auto inline-flex items-center gap-1 text-[color:var(--findable-primary,#ff7a4d)]">
                {isPartial
                  ? s.partialLink
                  : actionLabel(job.status, isUnavailable, s, t)}
                {isDone && (
                  <>
                    <ExternalLinkIcon aria-hidden="true" className="size-3" />
                    <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                      {s.newTab}
                    </span>
                  </>
                )}
              </span>
            </div>
          </>
        );

        return (
          <li key={job.id}>
            {isDone ? (
              <a
                className={rowClassName}
                href={publicReportUrl(webUrl, job.id, locale)}
                rel="noopener noreferrer"
                target="_blank"
              >
                {body}
              </a>
            ) : (
              <a
                className={rowClassName}
                href={unfinishedRunHref(job, isUnavailable)}
              >
                {body}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
};
