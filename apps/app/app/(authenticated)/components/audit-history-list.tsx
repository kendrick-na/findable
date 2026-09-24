import { isUsableRun } from "@repo/audit/run-quality";
import type { AuditJob } from "@repo/database";
import { Badge } from "@repo/design-system/components/ui/badge";
import { cn } from "@repo/design-system/lib/utils";
import { ClockIcon, ExternalLinkIcon } from "lucide-react";
import { env } from "@/env";
import { extractBrandName, extractSov } from "../lib/dashboard-data";
import { EmptyState } from "./empty-state";

const STATUS_LABEL: Record<AuditJob["status"], string> = {
  queued: "대기 중",
  processing: "측정 중",
  completed: "완료",
  failed: "실패",
};

// completed=초록 / processing·queued=노랑 / failed=빨강
const STATUS_TONE: Record<AuditJob["status"], string> = {
  queued: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  processing: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-600 dark:text-red-400",
};

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface AuditHistoryListProps {
  jobs: AuditJob[];
}

function actionLabel(
  status: AuditJob["status"],
  isUnavailable: boolean
): string {
  if (isUnavailable) {
    return "측정 불가 원인 보기";
  }
  if (status === "failed") {
    return "실패 사유 보기";
  }
  if (status === "completed") {
    return "결과 보기";
  }
  return "실시간 상태 보기";
}

export const AuditHistoryList = ({ jobs }: AuditHistoryListProps) => {
  const webUrl = env.NEXT_PUBLIC_WEB_URL;

  // 🔴 S2'(2026-08-11 세션N-19) — 여기 가드가 **없어서** `/history` 가 완전 공백이었다.
  //   `jobs.map()` 은 빈 배열에서 빈 `<ul>` 을 렌더한다 → 제목 두 줄 아래가 **아무것도 없음**.
  //   대시보드는 호출부(`page.tsx` 의 `hasData`)가 막아줘서 안 드러났고,
  //   `/history` 는 그 분기가 없어 그대로 노출됐다(가입자 6명 중 5명이 보는 경로).
  //   → 가드를 **컴포넌트 안**에 둔다: 호출부가 늘어도 같은 실수가 반복되지 않는다.
  if (jobs.length === 0) {
    return (
      <EmptyState
        description="브랜드를 등록하고 한 번만 측정하면, 그동안의 측정 결과가 여기에 시간순으로 쌓여요. 언제 무엇이 달라졌는지 되짚어볼 수 있어요."
        icon={<ClockIcon className="size-5" />}
        title="아직 측정한 적이 없어요"
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {jobs.map((job) => {
        const isUnavailable =
          job.status === "completed" && !isUsableRun(job.result);
        const sov = isUnavailable ? null : extractSov(job.result);
        const brandName = extractBrandName(job.result);
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
                  isUnavailable ? STATUS_TONE.failed : STATUS_TONE[job.status]
                )}
                variant="outline"
              >
                {isUnavailable ? "측정 불가" : STATUS_LABEL[job.status]}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              <span>{dateFormatter.format(job.createdAt)}</span>
              {sov !== null && (
                <span className="text-[color:var(--findable-ink,#f7f8f8)]">
                  {/* §5-3 교체표: SoV → 등장률(대시보드 히어로 카드와 같은 말) */}
                  등장률{" "}
                  <span className="font-semibold tabular-nums">{sov}%</span>
                </span>
              )}
              <span className="ml-auto inline-flex items-center gap-1 text-[color:var(--findable-primary,#ff7a4d)]">
                {actionLabel(job.status, isUnavailable)}
                {isDone && (
                  <>
                    <ExternalLinkIcon aria-hidden="true" className="size-3" />
                    <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                      새 탭
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
                href={`${webUrl}/ko/audit/${job.id}`}
                rel="noopener noreferrer"
                target="_blank"
              >
                {body}
              </a>
            ) : (
              <a
                className={rowClassName}
                href={
                  job.status === "failed" || isUnavailable
                    ? `/history/${job.id}`
                    : `/brand/measuring?job=${job.id}`
                }
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
