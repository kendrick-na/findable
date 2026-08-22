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
        const sov = extractSov(job.result);
        const brandName = extractBrandName(job.result);
        // 🔴 S6-c#4(2026-08-11) — 예전에는 **상태와 무관하게** 행 전체가 결과 링크였고
        //   "결과 보기 →" 도 항상 떴다. 실패·대기 중인 측정에는 **볼 결과가 없다**
        //   (= 없는 것을 약속하는 원인② 계열 결함). 같은 저장소 안에 이미 올바른 선례가
        //   있었다: `brand/page.tsx:117` 은 `completed` 일 때만 링크를 건다 → **자기모순**.
        //   → 완료 건만 링크·CTA 를 주고, 나머지는 지금 상태에 맞는 안내를 준다.
        const isDone = job.status === "completed";
        const rowClassName = cn(
          "findable-card block p-4",
          isDone && "findable-card-interactive"
        );
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
                className={cn("border-transparent", STATUS_TONE[job.status])}
                variant="outline"
              >
                {STATUS_LABEL[job.status]}
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
              {isDone ? (
                // 🔴 S7-2차(2026-08-11) — 결과는 **www(마케팅 사이트)** 에 있어서 누르면
                //   대시보드를 통째로 벗어나고 사이드바가 사라진다. 그 페이지엔 돌아오는
                //   링크가 없어 **브라우저 뒤로가기밖에 길이 없었다**(이력 여러 건을 비교하려면
                //   매번 뒤로가기 → 전체 재로딩). → 새 탭으로 열어 **이력을 잃지 않게** 한다.
                //   ⚠️ "새 탭"을 글자로 밝힌다 — 말없이 탭이 늘어나는 건 그 자체로 결함이다.
                <span className="ml-auto inline-flex items-center gap-1 text-[color:var(--findable-primary,#ff7a4d)]">
                  결과 보기
                  <ExternalLinkIcon aria-hidden="true" className="size-3" />
                  <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                    새 탭
                  </span>
                </span>
              ) : (
                <span className="ml-auto text-[color:var(--findable-ink-tertiary,#7e8289)]">
                  {job.status === "failed"
                    ? "측정에 실패해서 결과가 없어요"
                    : "측정이 끝나면 결과를 볼 수 있어요"}
                </span>
              )}
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
              <div className={rowClassName}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
};
