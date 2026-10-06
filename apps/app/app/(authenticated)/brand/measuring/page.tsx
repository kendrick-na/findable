import { isAuditContinuationPending } from "@repo/audit/audit-execution-lease";
import { isStaleAuditJob } from "@repo/audit/stale-job";
import { database } from "@repo/database";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { continueOrgTracking } from "@/app/actions/brand/continue-tracking";
import { getTrackingStatus } from "@/app/actions/brand/tracking-status";
import { env } from "@/env";
import { requireOrg } from "@/lib/db/scoped";
import { dateLocaleFor, getAppDictionary, getAppLocale } from "@/lib/i18n";
import { sampleReportUrl } from "@/lib/sample-report";
import { Header } from "../../components/header";
import { MeasuringView } from "./measuring-view";

// 이 화면의 폴링이 이어가기 서버액션(continueOrgTracking)을 부른다(2026-10-06).
//   서버액션 시간 상한은 그 액션을 쓰는 page 의 maxDuration 을 따른다(brand/page.tsx 주석).
export const maxDuration = 300;

export const generateMetadata = async (): Promise<Metadata> => {
  const t = (await getAppDictionary()).measuring;
  return { title: t.metaTitle, description: t.metaDescription };
};

interface MeasuringPageProps {
  // Next.js 16 — searchParams 는 Promise(대시보드 page.tsx 관례와 동일).
  searchParams: Promise<{ job?: string }>;
}

/**
 * 측정 대기 화면(재설계안 v2 §4) — 등록 직후 자동 측정이 시작되면 여기로 온다.
 *
 * 🔒 org 스코프: job 을 **`email = org:${orgId}` 로 필터**해 조회한다
 *   (`getTrackingStatus` 와 같은 불변식). 남의 job id 를 URL 로 찔러도 도메인이
 *   새어나가지 않는다 — 못 찾으면 브랜드 목록으로 돌려보낸다.
 */
const MeasuringPage = async ({ searchParams }: MeasuringPageProps) => {
  const { job: jobId } = await searchParams;
  const orgId = await requireOrg();

  if (!jobId) {
    redirect("/brand");
  }

  const job = await database.auditJob.findFirst({
    where: { id: jobId, email: `org:${orgId}` },
    // attemptStartedAt·leaseUntil 까지 읽어야 이어가기 대기(queued + leaseUntil)를
    //   오래된 대기열로 오판하지 않는다(stale-job).
    select: {
      domain: true,
      status: true,
      createdAt: true,
      attemptStartedAt: true,
      leaseUntil: true,
    },
  });

  // 내 org 것이 아니거나 없는 job → 대기할 것이 없다.
  if (!job) {
    redirect("/brand");
  }

  // 이미 끝난 job 으로 들어오면 기다리게 하지 않는다(뒤로가기·새로고침 경로).
  if (job.status === "completed") {
    redirect("/");
  }
  if (job.status === "failed") {
    redirect("/history");
  }
  if (isStaleAuditJob(job)) {
    await getTrackingStatus(jobId);
    redirect("/history");
  }

  const [dict, locale] = await Promise.all([
    getAppDictionary(),
    getAppLocale(),
  ]);

  return (
    <>
      <Header
        page={dict.measuring.headerTitle}
        pages={["Findable"]}
        showMetric={false}
      />
      <MeasuringView
        continueJob={continueOrgTracking}
        createdAt={job.createdAt.toISOString()}
        dateLocale={dateLocaleFor(locale)}
        domain={job.domain}
        initialContinuing={isAuditContinuationPending(job)}
        initialStatus={job.status}
        jobId={jobId}
        pollStatus={getTrackingStatus}
        sampleUrl={sampleReportUrl(env.NEXT_PUBLIC_WEB_URL)}
        t={dict.measuring}
      />
    </>
  );
};

export default MeasuringPage;
