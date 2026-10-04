import { geoAxisScores, successfulResponseCount } from "@repo/audit/geo-score";
import { countMeasurementCoverage } from "@repo/audit/measurement-coverage";
import {
  auditPublicationIssue,
  publicationVerifiedAnswerCount,
  withRecomputedAuditMetrics,
} from "@repo/audit/normalize-stored-metrics";
import { isUsableRun, metricsOf } from "@repo/audit/run-quality";
import { isStaleAuditJob, reconcileStaleAuditJob } from "@repo/audit/stale-job";
import { auth, currentUser } from "@repo/auth/server";
import { type AuditJob, database } from "@repo/database";
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

type DetailJob = Pick<AuditJob, "id" | "brandId" | "errorMessage">;
type DetailMetrics = ReturnType<typeof metricsOf>;

function partialHeadingFor(
  brandAiVerifiedCount: number,
  publicationIssue: ReturnType<typeof auditPublicationIssue> | null
): string {
  if (brandAiVerifiedCount === 0) {
    return "브랜드 AI 결과 보류";
  }
  if (publicationIssue === "question_plan_unverified") {
    return "질문 계획 확인 불가 · 잠정 결과";
  }
  if (publicationIssue === "incomplete_execution") {
    return "질문 측정 미완료 · 잠정 결과";
  }
  if (publicationIssue === "insufficient_sample") {
    return "확정 답변 부족 · 잠정 결과";
  }
  return "판별 미완료 · 잠정 결과";
}

/** Partial wins first; failed or unusable runs never show a score. */
function detailOutcome(
  isPartial: boolean,
  status: string,
  result: Parameters<typeof isUsableRun>[0]
): "partial" | "incomplete" | "complete" {
  if (isPartial) {
    return "partial";
  }
  if (status === "failed" || !isUsableRun(result)) {
    return "incomplete";
  }
  return "complete";
}

function PartialResultSection({
  brandAiVerifiedCount,
  job,
  metrics,
  partialHeading,
  publicationIssue,
}: {
  brandAiVerifiedCount: number;
  job: DetailJob;
  metrics: DetailMetrics;
  partialHeading: string;
  publicationIssue: ReturnType<typeof auditPublicationIssue> | null;
}) {
  return (
    <section className="findable-card border border-amber-500/30 p-5">
      <h2 className="font-semibold text-lg">{partialHeading}</h2>
      <p className="mt-2 text-muted-foreground text-sm">
        {publicationIssue === "incomplete_execution"
          ? "계획한 브랜드 질문의 AI 측정이 중단되거나 일부 미완료됐습니다. 이번 회차의 점수·등장률·개선 처방은 확정하지 않습니다."
          : null}
        {publicationIssue === "question_plan_unverified"
          ? "과거 측정의 질문 계획을 확인할 수 없어 이번 회차의 점수·등장률·개선 처방을 확정하지 않습니다. 수집된 답변은 근거로만 확인할 수 있습니다."
          : null}
        {publicationIssue === "insufficient_sample"
          ? `브랜드 질문의 AI 판별이 끝난 답변이 ${brandAiVerifiedCount}건뿐이라 이번 회차의 점수·등장률·개선 처방은 확정하지 않습니다.`
          : null}
        {publicationIssue !== "incomplete_execution" &&
        publicationIssue !== "question_plan_unverified" &&
        publicationIssue !== "insufficient_sample"
          ? `AI 답변은 일부 수집했지만 브랜드 판별이 ${metrics?.unverifiedCount ?? 0}건 완료되지 않았습니다. 이번 회차의 점수·등장률·개선 처방은 확정하지 않습니다.`
          : null}{" "}
        자세한 응답은 공개 리포트에서 확인할 수 있습니다.
      </p>
      {(metrics?.errors?.length ?? 0) > 0 ? (
        <p className="mt-2 text-muted-foreground text-sm">
          별도로 AI 엔진 응답 오류 {metrics?.errors?.length}건이 있어 해당
          답변은 수집되지 않았습니다.
        </p>
      ) : null}
      <a
        className="mt-4 inline-flex items-center gap-1 text-sm underline"
        href={`${env.NEXT_PUBLIC_WEB_URL}/ko/audit/${job.id}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        잠정 리포트 보기 <ExternalLinkIcon aria-hidden className="size-4" />
      </a>
      {job.brandId ? (
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link className="underline" href={`/?brand=${job.brandId}`}>
            이 브랜드 대시보드
          </Link>
          <Link className="underline" href={`/actions?brand=${job.brandId}`}>
            지금 할 일
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function IncompleteRunSection({ job }: { job: DetailJob }) {
  return (
    <section className="findable-card p-5">
      <h2 className="font-semibold text-lg">이번 측정은 완료되지 않았습니다</h2>
      <p className="mt-2 text-muted-foreground text-sm">
        {job.errorMessage ??
          "AI 응답을 충분히 받지 못해 점수와 결과를 표시할 수 없습니다. 브랜드·측정에서 다시 시도해 주세요."}
      </p>
      <Link className="mt-4 inline-block text-sm underline" href="/brand">
        다시 측정하기
      </Link>
    </section>
  );
}

function CompletedRunSection({
  coverage,
  job,
  metrics,
}: {
  coverage: ReturnType<typeof countMeasurementCoverage>;
  job: DetailJob;
  metrics: DetailMetrics;
}) {
  return (
    <section className="findable-card p-5">
      <h2 className="font-semibold text-lg">이번 회차 측정 완료</h2>
      {metrics ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 p-4">
            <p className="text-muted-foreground text-sm">GEO 종합 진단 점수</p>
            <p className="mt-1 font-semibold text-2xl">
              {geoAxisScores(metrics).total} / 100
            </p>
            <p className="mt-1 text-muted-foreground text-xs">
              인지·감성·출처·등장·경쟁 위치를 합산한 5축 진단
            </p>
          </div>
          <div className="rounded-lg border border-white/10 p-4">
            <p className="text-muted-foreground text-sm">AI 답변 등장률</p>
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
        이 회차의 점수·엔진별 답변·근거와 우선 처방은 공개 리포트에 있습니다.
        대시보드에서는 이후 회차와 비교하고 실행 항목을 관리할 수 있어요.
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
        <Link
          className="underline"
          href={job.brandId ? `/actions?brand=${job.brandId}` : "/actions"}
        >
          개선 실행 항목 보기
        </Link>
      </div>
    </section>
  );
}

export default async function AuditHistoryDetail({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ brand?: string }>;
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

  // The sidebar derives its brand context from the URL. A history deep link
  // without it would send the customer to another brand's default dashboard.
  if (job.brandId && (await searchParams).brand !== job.brandId) {
    redirect(`/history/${job.id}?brand=${encodeURIComponent(job.brandId)}`);
  }

  const status = isStaleAuditJob(job)
    ? ((await reconcileStaleAuditJob(job)) ?? job.status)
    : job.status;
  if (status === "queued" || status === "processing") {
    redirect(`/brand/measuring?job=${job.id}`);
  }

  const result = withRecomputedAuditMetrics(job.result);
  const brandName = extractBrandName(result) ?? job.domain;
  const metrics = metricsOf(result);
  const publicationIssue =
    status === "completed" ? auditPublicationIssue(result) : null;
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
  const isPartial = publicationIssue !== null && coverage.measured > 0;
  const brandAiVerifiedCount = publicationVerifiedAnswerCount(result) ?? 0;
  const partialHeading = partialHeadingFor(
    brandAiVerifiedCount,
    publicationIssue
  );
  const outcome = detailOutcome(isPartial, status, result);
  const measuredAt = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(job.createdAt);

  return (
    <>
      <Header
        page="측정 상세"
        pages={["Findable", "측정 이력"]}
        showMetric={false}
      />
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
        {outcome === "partial" ? (
          <PartialResultSection
            brandAiVerifiedCount={brandAiVerifiedCount}
            job={job}
            metrics={metrics}
            partialHeading={partialHeading}
            publicationIssue={publicationIssue}
          />
        ) : null}
        {outcome === "incomplete" ? <IncompleteRunSection job={job} /> : null}
        {outcome === "complete" ? (
          <CompletedRunSection
            coverage={coverage}
            job={job}
            metrics={metrics}
          />
        ) : null}
      </main>
    </>
  );
}
