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
import { database } from "@repo/database";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { env } from "@/env";
import { dateLocaleFor, getAppDictionary, getAppLocale } from "@/lib/i18n";
import { publicReportUrl } from "@/lib/public-report";
import { Header } from "../../components/header";
import { extractBrandName } from "../../lib/dashboard-data";
import { getPrimaryEmail } from "../../lib/user";

export const generateMetadata = async (): Promise<Metadata> => ({
  title: (await getAppDictionary()).historyDetail.metaTitle,
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const [dict, locale] = await Promise.all([
    getAppDictionary(),
    getAppLocale(),
  ]);
  const t = dict.historyDetail;
  const reportUrl = publicReportUrl(env.NEXT_PUBLIC_WEB_URL, job.id, locale);
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
  let partialHeading = t.partialUnverified;
  if (brandAiVerifiedCount === 0) {
    partialHeading = t.partialBrandHeld;
  } else if (publicationIssue === "question_plan_unverified") {
    partialHeading = t.partialPlanUnverified;
  } else if (publicationIssue === "incomplete_execution") {
    partialHeading = t.partialIncomplete;
  } else if (publicationIssue === "insufficient_sample") {
    partialHeading = t.partialInsufficient;
  }
  const measuredAt = new Intl.DateTimeFormat(dateLocaleFor(locale), {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(job.createdAt);

  return (
    <>
      <Header
        page={t.headerTitle}
        pages={["Findable", t.headerParent]}
        showMetric={false}
      />
      <main className="flex flex-1 flex-col gap-5 p-6 pt-2">
        <Link
          className="inline-flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground"
          href="/history"
        >
          <ArrowLeftIcon aria-hidden className="size-4" />
          {t.back}
        </Link>
        <div>
          <h1 className="font-semibold text-2xl">
            {t.title.replace("{brand}", brandName)}
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            {job.domain} · {measuredAt}
          </p>
        </div>
        {isPartial ? (
          <section className="findable-card border border-amber-500/30 p-5">
            <h2 className="font-semibold text-lg">{partialHeading}</h2>
            <p className="mt-2 text-muted-foreground text-sm">
              {publicationIssue === "incomplete_execution"
                ? t.issueIncomplete
                : null}
              {publicationIssue === "question_plan_unverified"
                ? t.issuePlanUnverified
                : null}
              {publicationIssue === "insufficient_sample"
                ? t.issueInsufficient.replace(
                    "{count}",
                    String(brandAiVerifiedCount)
                  )
                : null}
              {publicationIssue !== "incomplete_execution" &&
              publicationIssue !== "question_plan_unverified" &&
              publicationIssue !== "insufficient_sample"
                ? t.issueUnverified.replace(
                    "{count}",
                    String(metrics?.unverifiedCount ?? 0)
                  )
                : null}{" "}
              {t.seeReport}
            </p>
            {(metrics?.errors?.length ?? 0) > 0 ? (
              <p className="mt-2 text-muted-foreground text-sm">
                {t.engineErrors.replace(
                  "{count}",
                  String(metrics?.errors?.length ?? 0)
                )}
              </p>
            ) : null}
            <a
              className="mt-4 inline-flex items-center gap-1 text-sm underline"
              href={reportUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              {t.viewPartialReport}{" "}
              <ExternalLinkIcon aria-hidden className="size-4" />
            </a>
            {job.brandId ? (
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <Link className="underline" href={`/?brand=${job.brandId}`}>
                  {t.brandDashboard}
                </Link>
                <Link
                  className="underline"
                  href={`/actions?brand=${job.brandId}`}
                >
                  {t.todo}
                </Link>
              </div>
            ) : null}
          </section>
        ) : status === "failed" || !isUsableRun(result) ? (
          <section className="findable-card p-5">
            <h2 className="font-semibold text-lg">{t.notCompletedTitle}</h2>
            <p className="mt-2 text-muted-foreground text-sm">
              {/* 러너가 저장한 실패 문장은 한국어(또는 내부 오류 원문)다 — 영어 화면엔 사전 문장만 쓴다. */}
              {(locale === "ko" ? job.errorMessage : null) ??
                t.notCompletedBody}
            </p>
            <Link className="mt-4 inline-block text-sm underline" href="/brand">
              {t.remeasure}
            </Link>
          </section>
        ) : (
          <section className="findable-card p-5">
            <h2 className="font-semibold text-lg">{t.completedTitle}</h2>
            {metrics ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-white/10 p-4">
                  <p className="text-muted-foreground text-sm">{t.geoScore}</p>
                  <p className="mt-1 font-semibold text-2xl">
                    {geoAxisScores(metrics).total} / 100
                  </p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {t.geoScoreNote}
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 p-4">
                  <p className="text-muted-foreground text-sm">
                    {t.mentionRate}
                  </p>
                  <p className="mt-1 font-semibold text-2xl">
                    {Math.round(metrics.sov)}%
                  </p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {t.mentionRateBasis
                      .replace(
                        "{responses}",
                        String(successfulResponseCount(metrics))
                      )
                      .replace("{measured}", String(coverage.measured))
                      .replace("{attempted}", String(coverage.attempted))}
                  </p>
                </div>
              </div>
            ) : null}
            <p className="mt-2 text-muted-foreground text-sm">
              {t.completedBody}
            </p>
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <a
                className="inline-flex items-center gap-1 font-medium text-[color:var(--findable-primary,#ff7a4d)]"
                href={reportUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {t.viewReport}{" "}
                <ExternalLinkIcon aria-hidden className="size-4" />
              </a>
              <Link
                className="underline"
                href={job.brandId ? `/?brand=${job.brandId}` : "/"}
              >
                {t.viewDashboard}
              </Link>
              <Link
                className="underline"
                href={
                  job.brandId ? `/actions?brand=${job.brandId}` : "/actions"
                }
              >
                {t.viewActions}
              </Link>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
