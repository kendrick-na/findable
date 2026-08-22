import "server-only";

import { isUsableRun, scoreOf } from "@repo/audit/run-quality";
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
        ? [{ at: run.completedAt, score: scoreOf(run.result) }]
        : []
    )
    .filter((run): run is { at: Date; score: number } => run.score !== null);
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
  return {
    contentId: content.id,
    baselineScore: baseline?.score ?? null,
    currentScore: current?.score ?? null,
    scoreDelta: baseline && current ? current.score - baseline.score : null,
    citationDetected,
    indexEligibility: content.status === "published" && !content.noindex,
    sitemapIncluded: content.status === "published" && !content.noindex,
    optimizationReadiness: Math.round(
      (readinessSignals.filter(Boolean).length / readinessSignals.length) * 100
    ),
  };
}
