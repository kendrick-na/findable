import { ArrowRightIcon, LinkIcon, ScanSearchIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * 대시보드 요약은 진단 상세 타입 전체가 아니라 집계 수치만 읽는다. 별도 진단
 * 패키지가 아직 배포되지 않은 환경에서도 대시보드 자체가 실패하지 않게 경계를 둔다.
 */

interface DashboardSystemStatusProps {
  brandId: string;
  canAudit: boolean;
  organizationId: string;
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
          description="저장한 도메인의 SEO·GEO 기술 준비도를 확인하세요."
          href="/site-audit"
          icon={<ScanSearchIcon className="size-4" />}
          label="사이트 준비도"
          meta="진단 결과와 해결 방법 보기"
          value="진단하기"
        />
        <StatusCard
          description="Search Console·GA4·네이버 데이터를 연결하고 성과를 확인하세요."
          href={`/site-audit/integrations?brand=${brandId}`}
          icon={<LinkIcon className="size-4" />}
          label="검색 데이터"
          meta="연결 상태와 최근 동기화 보기"
          value="연결 관리"
        />
      </div>
    </section>
  );
};
