import "server-only";

import { database, type Prisma } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { scanSiteReadiness } from "./scanner";
import type { SiteReadinessReport, SiteReadinessTrigger } from "./types";

const RUNNING_DEDUP_MS = 5 * 60 * 1000;

const KNOWN_ERROR_CODES = new Set([
  "URL_REQUIRED",
  "URL_INVALID",
  "URL_PROTOCOL",
  "URL_UNSAFE",
  "URL_PRIVATE",
  "URL_DNS",
  "FETCH_TIMEOUT",
  "FETCH_FAILED",
  "RESPONSE_TOO_LARGE",
  "REDIRECT_FAILED",
  "NOT_HTML",
]);

export function siteReadinessErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  return KNOWN_ERROR_CODES.has(code) ? code : "UNKNOWN";
}

export async function createSiteReadinessRun(input: {
  brandId: string;
  organizationId: string;
  targetUrl: string;
  trigger: SiteReadinessTrigger;
}): Promise<{ id: string; reused: boolean }> {
  const brand = await database.brand.findFirst({
    where: {
      id: input.brandId,
      organizationId: input.organizationId,
    },
    select: { id: true },
  });
  if (!brand) {
    throw new Error("BRAND_FORBIDDEN");
  }

  const running = await database.siteReadinessRun.findFirst({
    where: {
      brandId: input.brandId,
      organizationId: input.organizationId,
      status: { in: ["queued", "processing"] },
      createdAt: { gte: new Date(Date.now() - RUNNING_DEDUP_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (running) {
    return { id: running.id, reused: true };
  }

  const run = await database.siteReadinessRun.create({
    data: {
      brandId: input.brandId,
      organizationId: input.organizationId,
      targetUrl: input.targetUrl,
      trigger: input.trigger,
    },
    select: { id: true },
  });
  return { id: run.id, reused: false };
}

export async function executeSiteReadinessRun(
  runId: string
): Promise<SiteReadinessReport | null> {
  const claimed = await database.siteReadinessRun.updateMany({
    where: { id: runId, status: "queued" },
    data: { status: "processing", startedAt: new Date(), errorCode: null },
  });
  if (claimed.count === 0) {
    const existing = await database.siteReadinessRun.findUnique({
      where: { id: runId },
      select: { report: true, status: true },
    });
    return existing?.status === "completed"
      ? (existing.report as unknown as SiteReadinessReport)
      : null;
  }

  const run = await database.siteReadinessRun.findUnique({
    where: { id: runId },
    select: {
      brandId: true,
      organizationId: true,
      targetUrl: true,
      trigger: true,
    },
  });
  if (!run) {
    return null;
  }

  try {
    const report = await scanSiteReadiness(run.targetUrl);
    await database.siteReadinessRun.update({
      where: { id: runId },
      data: {
        completedAt: new Date(),
        finalUrl: report.finalUrl,
        report: report as unknown as Prisma.InputJsonValue,
        status: "completed",
      },
    });
    log.info("site_readiness.completed", {
      runId,
      orgId: run.organizationId,
      brandId: run.brandId,
      trigger: run.trigger,
      hostname: new URL(report.finalUrl).hostname,
      pass: report.summary.pass,
      warning: report.summary.warning,
      fail: report.summary.fail,
    });
    return report;
  } catch (error) {
    const errorCode = siteReadinessErrorCode(error);
    await database.siteReadinessRun.update({
      where: { id: runId },
      data: { completedAt: new Date(), errorCode, status: "failed" },
    });
    log.warn("site_readiness.failed", {
      runId,
      orgId: run.organizationId,
      brandId: run.brandId,
      trigger: run.trigger,
      errorCode,
      error: parseError(error),
    });
    return null;
  }
}
