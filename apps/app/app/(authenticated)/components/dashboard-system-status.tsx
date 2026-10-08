import { database } from "@repo/database";
import { ArrowRightIcon, LinkIcon, ScanSearchIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  type AppDictionary,
  dateLocaleFor,
  getAppDictionary,
  getAppLocale,
} from "@/lib/i18n";

type StatusLabels = AppDictionary["systemStatus"];

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

function formatUpdatedAt(
  value: Date | null | undefined,
  t: StatusLabels,
  dateLocale: string
) {
  if (!value) {
    return t.neverRun;
  }

  return new Intl.DateTimeFormat(dateLocale, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "numeric",
    timeZone: "Asia/Seoul",
  }).format(value);
}

function connectionStatusLabel(status: string, t: StatusLabels) {
  if (status === "connected") {
    return t.connected;
  }
  if (status === "syncing") {
    return t.syncing;
  }
  if (status === "error") {
    return t.needsCheck;
  }
  return t.needsProperty;
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

export const DashboardSystemStatusSkeleton = ({ label }: { label: string }) => (
  <section aria-label={label} className="space-y-3">
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
  const [dict, locale] = await Promise.all([
    getAppDictionary(),
    getAppLocale(),
  ]);
  const t = dict.systemStatus;
  const dateLocale = dateLocaleFor(locale);
  if (!canAudit) {
    return (
      <section aria-labelledby="dashboard-system-status" className="space-y-3">
        <h2
          className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm"
          id="dashboard-system-status"
        >
          {t.title}
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <StatusCard
            description={t.readinessLockedBody}
            href={`/site-audit?brand=${brandId}`}
            icon={<ScanSearchIcon className="size-4" />}
            label={t.readinessLabel}
            meta={t.readinessLockedMeta}
            value={t.needsCheck}
          />
          <StatusCard
            description={t.searchLockedBody}
            href={`/site-audit/integrations?brand=${brandId}`}
            icon={<LinkIcon className="size-4" />}
            label={t.searchLabel}
            meta={t.searchLockedMeta}
            value={t.connectNeeded}
          />
        </div>
      </section>
    );
  }

  const [latestReadinessRun, connections] = await Promise.all([
    database.siteReadinessRun.findFirst({
      orderBy: { createdAt: "desc" },
      select: {
        completedAt: true,
        createdAt: true,
        report: true,
        status: true,
      },
      where: { brandId, organizationId },
    }),
    database.searchPerformanceConnection.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        lastSyncedAt: true,
        provider: true,
        status: true,
        updatedAt: true,
      },
      where: { brandId, organizationId },
    }),
  ]);
  const readinessReport =
    latestReadinessRun?.report as SiteReadinessSummary | null;
  const readinessValue =
    latestReadinessRun?.status === "completed" &&
    typeof readinessReport?.score === "number"
      ? t.score.replace("{n}", String(readinessReport.score))
      : latestReadinessRun?.status === "completed"
        ? t.checkDone
        : latestReadinessRun?.status === "processing" ||
            latestReadinessRun?.status === "queued"
          ? t.checking
          : t.notChecked;
  const readinessMeta =
    latestReadinessRun?.status === "failed"
      ? t.lastFailed
      : formatUpdatedAt(
          latestReadinessRun?.completedAt ?? latestReadinessRun?.createdAt,
          t,
          dateLocale
        );
  const connectedCount = connections.filter(
    (connection) => connection.status === "connected"
  ).length;
  const latestConnection = connections[0];
  const connectionMeta = latestConnection
    ? `${connectionStatusLabel(latestConnection.status, t)} · ${formatUpdatedAt(
        latestConnection.lastSyncedAt ?? latestConnection.updatedAt,
        t,
        dateLocale
      )}`
    : t.searchConnectHint;

  return (
    <section aria-labelledby="dashboard-system-status" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm"
          id="dashboard-system-status"
        >
          {t.title}
        </h2>
        <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
          {t.lede}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <StatusCard
          description={
            latestReadinessRun?.status === "failed"
              ? t.readinessRetryBody
              : t.readinessBody
          }
          href={`/site-audit?brand=${brandId}`}
          icon={<ScanSearchIcon className="size-4" />}
          label={t.readinessLabel}
          meta={readinessMeta}
          value={readinessValue}
        />
        <StatusCard
          description={t.searchBody}
          href={`/site-audit/integrations?brand=${brandId}`}
          icon={<LinkIcon className="size-4" />}
          label={t.searchLabel}
          meta={connectionMeta}
          value={
            connections.length === 0
              ? t.noConnections
              : t.connectedCount
                  .replace("{connected}", String(connectedCount))
                  .replace("{total}", String(connections.length))
          }
        />
      </div>
    </section>
  );
};
