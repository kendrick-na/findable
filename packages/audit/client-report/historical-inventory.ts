// W0-2 기발행 Report/PDF 읽기 전용 inventory.
//
// 웹 격리(clientReportDisclosure)는 모든 동결 스냅숏의 서술과 저장 PDF 링크를 숨기지만,
// 이미 전달된 Blob PDF URL 자체는 계속 열린다. 고객별 keep / reissue / revoke / notify 결정을
// 내리려면 "무엇이 아직 열려 있고 누가 봤는가"를 쓰기 없이 집계해야 한다.
// 출력에는 접근 토큰·PDF URL·파일명·이메일을 넣지 않는다(URL은 sha256 지문으로만 대조).
// 결정은 사람이 내린다: 모든 행은 decision "undecided" 로 시작한다.

import { createHash } from "node:crypto";
import {
  CLIENT_REPORT_TEMPLATE_VERSION,
  clientReportDisclosure,
  parseClientReportData,
} from "./report-data";

export interface HistoricalReportRow {
  accessToken: string | null;
  brandId: string | null;
  data: unknown;
  generatedAt: Date;
  id: string;
  lastViewedAt: Date | null;
  organizationId: string | null;
  pdfUrl: string | null;
  type: string;
  viewCount: number;
}

export type PdfHost = "vercel-blob" | "other" | "none" | "invalid";

export interface HistoricalReportRecord {
  brandId: string | null;
  currentTemplate: boolean;
  decision: "undecided";
  directPdfUrlNeedsDecision: boolean;
  embeddedReviewPresent: boolean;
  generatedAt: string;
  measurementMix: Record<string, number> | null;
  narrativeQuarantinedOnWeb: boolean;
  organizationId: string | null;
  pdf: {
    hiddenOnWeb: boolean;
    host: PdfHost;
    present: boolean;
    urlSha256: string | null;
  };
  reportId: string;
  snapshot: "parsed" | "unparseable" | "missing";
  templateVersion: string | null;
  type: string;
  viewed: { count: number; lastViewedAt: string | null };
  webLinkActive: boolean;
}

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

export function classifyPdfHost(url: string | null): PdfHost {
  if (!url) {
    return "none";
  }
  try {
    return new URL(url).hostname.endsWith(".blob.vercel-storage.com")
      ? "vercel-blob"
      : "other";
  } catch {
    return "invalid";
  }
}

export function classifyHistoricalReport(
  row: HistoricalReportRow
): HistoricalReportRecord {
  const parsed = row.data == null ? null : parseClientReportData(row.data);
  const snapshot =
    row.data == null ? "missing" : parsed ? "parsed" : "unparseable";
  // Inventory has no trusted append-only review store, so it evaluates the same
  // public rule the web uses without one: every frozen snapshot stays quarantined.
  const disclosure = parsed ? clientReportDisclosure(parsed, row.pdfUrl) : null;
  const pdfPresent = Boolean(row.pdfUrl);
  const embedded =
    typeof row.data === "object" &&
    row.data !== null &&
    "publicationReview" in row.data &&
    (row.data as { publicationReview?: unknown }).publicationReview != null;
  return {
    reportId: row.id,
    organizationId: row.organizationId,
    brandId: row.brandId,
    type: row.type,
    generatedAt: row.generatedAt.toISOString(),
    snapshot,
    templateVersion: parsed?.templateVersion ?? null,
    currentTemplate: parsed?.templateVersion === CLIENT_REPORT_TEMPLATE_VERSION,
    embeddedReviewPresent: embedded,
    measurementMix: disclosure ? { ...disclosure.measurementMix } : null,
    webLinkActive: row.accessToken !== null,
    narrativeQuarantinedOnWeb: disclosure
      ? !disclosure.narrativeAttested
      : true,
    pdf: {
      present: pdfPresent,
      host: classifyPdfHost(row.pdfUrl),
      urlSha256: row.pdfUrl ? sha256(row.pdfUrl) : null,
      hiddenOnWeb: pdfPresent && !disclosure?.pdfDownloadAttested,
    },
    // The web hides the link, but a URL that was already delivered stays reachable.
    directPdfUrlNeedsDecision: pdfPresent,
    viewed: {
      count: row.viewCount,
      lastViewedAt: row.lastViewedAt ? row.lastViewedAt.toISOString() : null,
    },
    decision: "undecided",
  };
}

export function summarizeHistoricalInventory(
  records: readonly HistoricalReportRecord[]
) {
  return {
    reports: records.length,
    organizations: new Set(records.map((r) => r.organizationId ?? "(none)"))
      .size,
    webLinkActive: records.filter((r) => r.webLinkActive).length,
    storedPdf: records.filter((r) => r.pdf.present).length,
    directPdfUrlNeedsDecision: records.filter(
      (r) => r.directPdfUrlNeedsDecision
    ).length,
    viewedAtLeastOnce: records.filter((r) => r.viewed.count > 0).length,
    unparseable: records.filter((r) => r.snapshot === "unparseable").length,
    missingSnapshot: records.filter((r) => r.snapshot === "missing").length,
    undecided: records.filter((r) => r.decision === "undecided").length,
  };
}

interface RawQueryClient {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

export interface ReadOnlyInventoryClient {
  $transaction<T>(fn: (tx: RawQueryClient) => Promise<T>): Promise<T>;
}

export async function readHistoricalReportInventory(
  client: ReadOnlyInventoryClient
) {
  // Prisma DateTime columns are timestamp(3) WITHOUT time zone holding UTC; raw
  // aggregates come back as naive values the driver would read as local time, so
  // render them as explicit UTC ISO strings in SQL.
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const reports = await tx.$queryRawUnsafe<
      (Omit<
        HistoricalReportRow,
        "generatedAt" | "lastViewedAt" | "viewCount"
      > & {
        generatedAt: string;
        lastViewedAt: string | null;
        viewCount: bigint | number;
      })[]
    >(
      `SELECT r.id, r."organizationId", r."brandId", r.type::text AS type,
              to_char(r."generatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "generatedAt",
              r."accessToken", r."pdfUrl", r.data,
              count(v.id) AS "viewCount",
              to_char(max(v."viewedAt"), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastViewedAt"
         FROM "Report" r
         LEFT JOIN "ReportView" v ON v."reportId" = r.id
        GROUP BY r.id
        ORDER BY r."generatedAt" DESC, r.id`
    );
    const jobs = await tx.$queryRawUnsafe<
      { createdAt: string; email: string; pdfUrl: string }[]
    >(
      `SELECT to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt", email, "pdfUrl"
         FROM "AuditJob" WHERE "pdfUrl" IS NOT NULL`
    );
    const byMonth: Record<string, number> = {};
    const hosts: Record<string, number> = {};
    for (const job of jobs) {
      const month = job.createdAt.slice(0, 7);
      byMonth[month] = (byMonth[month] ?? 0) + 1;
      const host = classifyPdfHost(job.pdfUrl);
      hosts[host] = (hosts[host] ?? 0) + 1;
    }
    const records = reports.map((row) =>
      classifyHistoricalReport({
        ...row,
        generatedAt: new Date(row.generatedAt),
        lastViewedAt: row.lastViewedAt ? new Date(row.lastViewedAt) : null,
        viewCount: Number(row.viewCount),
      })
    );
    return {
      reports: records,
      summary: summarizeHistoricalInventory(records),
      freeAuditPdfs: {
        jobsWithStoredPdf: jobs.length,
        distinctRecipients: new Set(
          jobs.map((job) => sha256(job.email.trim().toLowerCase()))
        ).size,
        byMonth,
        hosts,
      },
    };
  });
}
