import { ArrowRightIcon, LinkIcon, ScanSearchIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { database } from "@repo/database";

/**
 * 대시보드 요약은 진단 상세 타입 전체가 아니라 집계 수치만 읽는다. 별도 진단
 * 패키지가 아직 배포되지 않은 환경에서도 대시보드 자체가 실패하지 않게 경계를 둔다.
 */

interface DashboardSystemStatusProps {
  brandId: string;
  canAudit: boolean;
  organizationId: string;
}

interface SiteReadinessSummary {
  score?: number;
}

function formatUpdatedAt(value: Date | null | undefined) {
  if (!value) {
    return "아직 실행 기록이 없어요";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "numeric",
  }).format(value);
}

function connectionStatusLabel(status: string) {
  if (status === "connected") return "연결됨";
  if (status === "syncing") return "동기화 중";
  if (status === "error") return "확인 필요";
  return "속성 선택 필요";
}

const StatusCard = ({
  description,
  href,
  icon,
  label,
  meta,
  value,
}: {
  description: string;
  href: string;
  icon: ReactNode;
  label: string;
  meta: string;
  value: string;
}) => (
  <Link
    className="findable-card group flex min-w-0 flex-col gap-4 p-5 transition-colors hover:border-[color:var(--findable-primary,#ff7a4d)]"
    href={href}
  >
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
        {icon}
        {label}
      </span>
      <ArrowRightIcon className="size-4 text-[color:var(--findable-ink-tertiary,#7e8289)] transition-colors group-hover:text-[color:var(--findable-primary,#ff7a4d)]" />
    </div>
    <div>
      <p className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-xl tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
        {description}
      </p>
    </div>
    <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
      {meta}
    </p>
  </Link>
);

export const DashboardSystemStatusSkeleton = () => (
  <section aria-label="전체 상태 불러오는 중" className="space-y-3">
    <div className="h-5 w-20 animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
    <div className="grid gap-3 md:grid-cols-2">
      <div className="findable-card h-40 animate-pulse bg-white/[0.02] motion-reduce:animate-none" />
      <div className="findable-card h-40 animate-pulse bg-white/[0.02] motion-reduce:animate-none" />
    </div>
  </section>
);

export const DashboardSystemStatus = async ({
  brandId,
  canAudit,
  organizationId,
}: DashboardSystemStatusProps) => {
  if (!canAudit) {
    return (
      <section aria-labelledby="dashboard-system-status" className="space-y-3">
        <h2
          className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm"
          id="dashboard-system-status"
        >
          전체 상태
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <StatusCard
            description="사이트의 SEO·GEO 기술 상태를 확인합니다."
            href="/site-audit"
            icon={<ScanSearchIcon className="size-4" />}
            label="사이트 준비도"
            meta="Growth 플랜에서 확인"
            value="확인 필요"
          />
          <StatusCard
            description="실제 검색 노출·클릭·유입 데이터를 연결합니다."
            href={`/site-audit/integrations?brand=${brandId}`}
            icon={<LinkIcon className="size-4" />}
            label="검색 데이터"
            meta="Growth 플랜에서 연결"
            value="연결 필요"
          />
        </div>
      </section>
    );
  }

  const [latestReadinessRun, connections] = await Promise.all([
    database.siteReadinessRun.findFirst({
      orderBy: { createdAt: "desc" },
      select: { completedAt: true, createdAt: true, report: true, status: true },
      where: { brandId, organizationId },
    }),
    database.searchPerformanceConnection.findMany({
      orderBy: { updatedAt: "desc" },
      select: { lastSyncedAt: true, provider: true, status: true, updatedAt: true },
      where: { brandId, organizationId },
    }),
  ]);
  const readinessReport = latestReadinessRun?.report as
    | SiteReadinessSummary
    | null;
  const readinessValue =
    latestReadinessRun?.status === "completed" &&
    typeof readinessReport?.score === "number"
      ? `${readinessReport.score}점`
      : latestReadinessRun?.status === "completed"
        ? "점검 완료"
      : latestReadinessRun?.status === "processing" ||
          latestReadinessRun?.status === "queued"
        ? "점검 중"
        : "진단 전";
  const readinessMeta =
    latestReadinessRun?.status === "failed"
      ? "최근 점검을 완료하지 못했습니다 · 다시 실행해 보세요"
      : formatUpdatedAt(
          latestReadinessRun?.completedAt ?? latestReadinessRun?.createdAt
        );
  const connectedCount = connections.filter(
    (connection) => connection.status === "connected"
  ).length;
  const latestConnection = connections[0];
  const connectionMeta = latestConnection
    ? `${connectionStatusLabel(latestConnection.status)} · ${formatUpdatedAt(
        latestConnection.lastSyncedAt ?? latestConnection.updatedAt
      )}`
    : "Search Console·GA4·네이버 데이터를 연결할 수 있어요";

  return (
    <section aria-labelledby="dashboard-system-status" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm"
          id="dashboard-system-status"
        >
          전체 상태
        </h2>
        <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
          핵심 상태만 요약했어요. 카드를 누르면 근거와 해결 방법을 확인할 수
          있어요.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <StatusCard
          description={
            latestReadinessRun?.status === "failed"
              ? "점검을 다시 실행해 원인을 확인하세요."
              : "저장한 도메인의 SEO·GEO 기술 준비도를 확인하세요."
          }
          href="/site-audit"
          icon={<ScanSearchIcon className="size-4" />}
          label="사이트 준비도"
          meta={readinessMeta}
          value={readinessValue}
        />
        <StatusCard
          description="Search Console·GA4·네이버 데이터를 연결하고 성과를 확인하세요."
          href={`/site-audit/integrations?brand=${brandId}`}
          icon={<LinkIcon className="size-4" />}
          label="검색 데이터"
          meta={connectionMeta}
          value={`${connectedCount}/${connections.length}개 연결`}
        />
      </div>
    </section>
  );
};
