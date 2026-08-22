import { database } from "@repo/database";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTrackingStatus } from "@/app/actions/brand/tracking-status";
import { env } from "@/env";
import { requireOrg } from "@/lib/db/scoped";
import { sampleReportUrl } from "@/lib/sample-report";
import { Header } from "../../components/header";
import { MeasuringView } from "./measuring-view";

export const metadata: Metadata = {
  title: "측정 중 · Findable",
  description: "AI에게 물어보는 중이에요.",
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
    select: { domain: true, status: true },
  });

  // 내 org 것이 아니거나 없는 job → 대기할 것이 없다.
  if (!job) {
    redirect("/brand");
  }

  // 이미 끝난 job 으로 들어오면 기다리게 하지 않는다(뒤로가기·새로고침 경로).
  if (job.status === "completed") {
    redirect("/");
  }

  return (
    <>
      <Header page="측정 중" pages={["Findable"]} />
      <MeasuringView
        domain={job.domain}
        jobId={jobId}
        pollStatus={getTrackingStatus}
        sampleUrl={sampleReportUrl(env.NEXT_PUBLIC_WEB_URL)}
      />
    </>
  );
};

export default MeasuringPage;
