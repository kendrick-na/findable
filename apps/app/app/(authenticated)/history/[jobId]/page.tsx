import { geoAxisScores, successfulResponseCount } from "@repo/audit/geo-score";
import { countMeasurementCoverage } from "@repo/audit/measurement-coverage";
import { isUsableRun, metricsOf } from "@repo/audit/run-quality";
import { isStaleAuditJob, reconcileStaleAuditJob } from "@repo/audit/stale-job";
import { auth, currentUser } from "@repo/auth/server";
import { database } from "@repo/database";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { env } from "@/env";
import { Header } from "../../components/header";
import { extractBrandName } from "../../lib/dashboard-data";
import { getPrimaryEmail } from "../../lib/user";

export const metadata: Metadata = {
  title: "측정 상세 — Findable",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AuditHistoryDetail({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  if (!UUID_RE.test(jobId)) {
    notFound();
  }

  const user = await currentUser();
  const email = user ? getPrimaryEmail(user) : null;
  const { orgId } = await auth();
  const identifiers = [
    ...(email ? [email] : []),
    ...(orgId ? [`org:${orgId}`] : []),
  ];
  if (identifiers.length === 0) {
    notFound();
  }

  // Same ownership boundary as /history. A public report ID alone must never
  // grant access to another customer's dashboard record.
  const job = await database.auditJob.findFirst({
    where: {
      id: jobId,
      OR: [
        { email: { in: identifiers } },
        ...(orgId ? [{ organizationId: orgId }] : []),
      ],
    },
  });
  if (!job) {
    notFound();
  }

  const status = isStaleAuditJob(job)
    ? ((await reconcileStaleAuditJob(job)) ?? job.status)
    : job.status;
  if (status === "queued" || status === "processing") {
    redirect(`/brand/measuring?job=${job.id}`);
  }

  const brandName = extractBrandName(job.result) ?? job.domain;
  const metrics = metricsOf(job.result);
  const storedResponses = (
    job.result as {
      engineResponses?: Array<{
        engineId: string;
        errorMessage?: string | null;
        isStub?: boolean;
      }>;
    } | null
  )?.engineResponses;
  const coverage = countMeasurementCoverage(
    storedResponses?.filter((value) => value.engineId !== "naver-briefing")
  );
  const measuredAt = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(job.createdAt);

  return (
    <>
      <Header page="측정 상세" pages={["Findable", "측정 이력"]} />
      <main className="flex flex-1 flex-col gap-5 p-6 pt-2">
        <Link
          className="inline-flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground"
          href="/history"
        >
          <ArrowLeftIcon aria-hidden className="size-4" />
          측정 이력으로 돌아가기
        </Link>
        <div>
          <h1 className="font-semibold text-2xl">{brandName} 측정 상세</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            {job.domain} · {measuredAt}
          </p>
        </div>
        {status === "failed" || !isUsableRun(job.result) ? (
          <section className="findable-card p-5">
            <h2 className="font-semibold text-lg">
              이번 측정은 완료되지 않았습니다
            </h2>
            <p className="mt-2 text-muted-foreground text-sm">
              {job.errorMessage ??
                "AI 응답을 충분히 받지 못해 점수와 결과를 표시할 수 없습니다. 브랜드·측정에서 다시 시도해 주세요."}
            </p>
            <Link className="mt-4 inline-block text-sm underline" href="/brand">
              다시 측정하기
            </Link>
          </section>
        ) : (
          <section className="findable-card p-5">
            <h2 className="font-semibold text-lg">이번 회차 측정 완료</h2>
            {metrics ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-white/10 p-4">
                  <p className="text-muted-foreground text-sm">
                    GEO 종합 진단 점수
                  </p>
                  <p className="mt-1 font-semibold text-2xl">
                    {geoAxisScores(metrics).total} / 100
                  </p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    인지·감성·출처·등장·경쟁 위치를 합산한 5축 진단
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 p-4">
                  <p className="text-muted-foreground text-sm">
                    AI 답변 등장률
                  </p>
                  <p className="mt-1 font-semibold text-2xl">
                    {Math.round(metrics.sov)}%
                  </p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    성공한 답변 {successfulResponseCount(metrics)}개 기준 · AI{" "}
                    {coverage.measured}/{coverage.attempted}곳 측정
                  </p>
                </div>
              </div>
            ) : null}
            <p className="mt-2 text-muted-foreground text-sm">
              이 회차의 점수·엔진별 답변·근거와 우선 처방은 공개 리포트에
              있습니다. 대시보드에서는 이후 회차와 비교하고 실행 항목을 관리할
              수 있어요.
            </p>
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <a
                className="inline-flex items-center gap-1 font-medium text-[color:var(--findable-primary,#ff7a4d)]"
                href={`${env.NEXT_PUBLIC_WEB_URL}/ko/audit/${job.id}`}
                rel="noopener noreferrer"
                target="_blank"
              >
                이 회차 리포트 보기{" "}
                <ExternalLinkIcon aria-hidden className="size-4" />
              </a>
              <Link
                className="underline"
                href={job.brandId ? `/?brand=${job.brandId}` : "/"}
              >
                대시보드 요약 보기
              </Link>
              <Link className="underline" href="/actions">
                개선 실행 항목 보기
              </Link>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
