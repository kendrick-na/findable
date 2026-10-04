import "server-only";

import { isUsableRun, scoreOf } from "@repo/audit/run-quality";
import {
  compareAcrossSearchSampling,
  searchSamplingVersionOf,
} from "@repo/audit/search-sampling-version";
import { database } from "@repo/database";

const HEADING_RE = /^##\s+/m;
const LINK_RE = /https?:\/\//;

function sourceUrls(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (typeof item === "string") {
      return [item];
    }
    if (item && typeof item === "object" && "url" in item) {
      return [String(item.url)];
    }
    return [];
  });
}

export async function contentPerformance(input: {
  contentId: string;
  organizationId: string;
}) {
  const content = await database.content.findFirst({
    where: {
      id: input.contentId,
      publisher: { brand: { organizationId: input.organizationId } },
    },
    include: {
      publisher: true,
      qualityChecks: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!content) {
    return null;
  }
  const articleUrl = `https://www.findable.co.kr/${content.locale}/p/${content.publisher.slug}/${content.slug}`;
  const audits = content.publisher.brandId
    ? await database.auditJob.findMany({
        where: {
          organizationId: input.organizationId,
          brandId: content.publisher.brandId,
          status: "completed",
        },
        orderBy: { completedAt: "asc" },
        select: { completedAt: true, result: true },
      })
    : [];
  const usable = audits
    .flatMap((run) =>
      run.completedAt && isUsableRun(run.result)
        ? [
            {
              at: run.completedAt,
              score: scoreOf(run.result),
              searchSamplingVersion: searchSamplingVersionOf(run.result),
            },
          ]
        : []
    )
    .filter(
      (
        run
      ): run is { at: Date; score: number; searchSamplingVersion: string } =>
        run.score !== null
    );
  const publishedAt = content.publishedAt;
  const baseline = publishedAt
    ? usable.filter((run) => run.at <= publishedAt).at(-1)
    : undefined;
  const current = publishedAt
    ? usable.filter((run) => run.at > publishedAt).at(-1)
    : undefined;
  const citations =
    content.publisher.brandId && content.publishedAt
      ? await database.tracking.findMany({
          where: {
            brandId: content.publisher.brandId,
            trackedAt: { gt: content.publishedAt },
          },
          select: { citedSources: true, engineId: true, trackedAt: true },
          take: 500,
        })
      : [];
  const citationDetected = citations.some((row) =>
    sourceUrls(row.citedSources).some(
      (url) => url === articleUrl || url.includes(`/${content.slug}`)
    )
  );
  const readinessSignals = [
    Boolean(content.seoTitle),
    Boolean(content.seoDescription),
    Boolean(content.excerpt),
    Boolean(content.coverImageUrl && content.coverImageAlt),
    HEADING_RE.test(content.bodyMarkdown),
    LINK_RE.test(content.bodyMarkdown),
    content.qualityChecks[0]?.status !== "failed",
  ];
  // W1 정책: GEO 점수에는 네이버 검색 노출이 섞인다 → 표본 방식이 다르면 비교하지 않는다.
  const comparison =
    baseline && current
      ? compareAcrossSearchSampling(
          { value: baseline.score, version: baseline.searchSamplingVersion },
          { value: current.score, version: current.searchSamplingVersion }
        )
      : null;
  return {
    contentId: content.id,
    baselineScore:
      comparison?.comparable === false ? null : (baseline?.score ?? null),
    currentScore: current?.score ?? null,
    scoreComparisonBlocked: comparison?.comparable === false,
    scoreDelta: comparison?.delta ?? null,
    citationDetected,
    indexEligibility: content.status === "published" && !content.noindex,
    sitemapIncluded: content.status === "published" && !content.noindex,
    optimizationReadiness: Math.round(
      (readinessSignals.filter(Boolean).length / readinessSignals.length) * 100
    ),
  };
}
