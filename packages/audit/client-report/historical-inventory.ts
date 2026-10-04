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
  /** Token is set. The page still 404s when the token shape or snapshot is invalid. */
  accessTokenSet: boolean;
  brandId: string | null;
  currentTemplate: boolean;
  decision: "undecided";
  directPdfUrlNeedsDecision: boolean;
  embeddedReviewPresent: boolean;
  generatedAt: string;
  measurementMix: Record<string, number> | null;
  narrativeQuarantinedOnWeb: boolean;
  /** Always true: PDFs printed locally and sent as attachments leave no DB trace. */
  offDbDeliveryUntracked: true;
  organizationId: string | null;
  pdf: {
    hiddenOnWeb: boolean;
    host: PdfHost;
    present: boolean;
    urlSha256: string | null;
  };
  /** ReportView rows only: bots, `?print=1`, failed best-effort writes and direct Blob downloads are not counted. */
  recordedViews: { count: number; lastRecordedAt: string | null };
  reportId: string;
  snapshot: "parsed" | "unparseable" | "missing";
  templateVersion: string | null;
  type: string;
  /** Mirrors apps/web/lib/client-report/load.ts: valid token shape and parseable snapshot. */
  webLinkResolvable: boolean;
}

// Same shape check as apps/web/lib/client-report/load.ts TOKEN_RE.
const ACCESS_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

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
  let snapshot: HistoricalReportRecord["snapshot"] = "unparseable";
  if (row.data == null) {
    snapshot = "missing";
  } else if (parsed) {
    snapshot = "parsed";
  }
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
    accessTokenSet: row.accessToken !== null,
    webLinkResolvable:
      row.accessToken !== null &&
      ACCESS_TOKEN_RE.test(row.accessToken) &&
      snapshot === "parsed",
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
    offDbDeliveryUntracked: true,
    recordedViews: {
      count: row.viewCount,
      lastRecordedAt: row.lastViewedAt ? row.lastViewedAt.toISOString() : null,
    },
    decision: "undecided",
  };
}

export function summarizeHistoricalInventory(
  records: readonly HistoricalReportRecord[]
) {
  return {
    reports: records.length,
    organizations: new Set(
      records.flatMap((r) => (r.organizationId ? [r.organizationId] : []))
    ).size,
    reportsWithoutOrganization: records.filter((r) => !r.organizationId).length,
    accessTokenSet: records.filter((r) => r.accessTokenSet).length,
    webLinkResolvable: records.filter((r) => r.webLinkResolvable).length,
    storedPdf: records.filter((r) => r.pdf.present).length,
    directPdfUrlNeedsDecision: records.filter(
      (r) => r.directPdfUrlNeedsDecision
    ).length,
    withRecordedViews: records.filter((r) => r.recordedViews.count > 0).length,
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
  $transaction<T>(
    fn: (tx: RawQueryClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number }
  ): Promise<T>;
}

const utcIso = (column: string) =>
  `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export function readHistoricalReportInventory(
  client: ReadOnlyInventoryClient
) {
  // Prisma DateTime columns are timestamp(3) WITHOUT time zone holding UTC; raw
  // aggregates come back as naive values the driver would read as local time, so
  // render them as explicit UTC ISO strings in SQL.
  return client.$transaction(
    async (tx) => {
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
        {
          createdAt: string;
          email: string;
          id: string;
          organizationId: string | null;
          pdfUrl: string | null;
        }[]
      >(
        `SELECT id, "organizationId", ${utcIso('"createdAt"')} AS "createdAt",
              email, "pdfUrl"
         FROM "AuditJob"
        WHERE "pdfUrl" IS NOT NULL
           OR id IN (SELECT metadata->>'jobId' FROM "Lead"
                      WHERE source::text = 'free_audit' AND metadata ? 'jobId')
        ORDER BY "createdAt" DESC, id`
      );
      // Lead rows are the only DB trace of where a free-audit PDF e-mail was sent
      // (apps/web/app/api/audit/[jobId]/lead/route.ts); the send itself is only logged.
      const leads = await tx.$queryRawUnsafe<
        { email: string; jobId: string }[]
      >(
        `SELECT metadata->>'jobId' AS "jobId", email FROM "Lead"
        WHERE source::text = 'free_audit' AND metadata ? 'jobId'`
      );
      const leadsByJob = new Map<string, string[]>();
      for (const lead of leads) {
        leadsByJob.set(lead.jobId, [
          ...(leadsByJob.get(lead.jobId) ?? []),
          sha256(lead.email.trim().toLowerCase()),
        ]);
      }
      const byMonth: Record<string, number> = {};
      const hosts: Record<string, number> = {};
      const freeAuditJobs = jobs.map((job) => {
        const host = classifyPdfHost(job.pdfUrl);
        if (job.pdfUrl) {
          const month = job.createdAt.slice(0, 7);
          byMonth[month] = (byMonth[month] ?? 0) + 1;
          hosts[host] = (hosts[host] ?? 0) + 1;
        }
        const leadHashes = leadsByJob.get(job.id) ?? [];
        return {
          jobId: job.id,
          organizationId: job.organizationId,
          createdAt: job.createdAt,
          storedPdf: {
            host,
            urlSha256: job.pdfUrl ? sha256(job.pdfUrl) : null,
          },
          leadDeliveryRecords: leadHashes.length,
          decision: "undecided" as const,
        };
      });
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
          jobsWithStoredPdf: jobs.filter((job) => job.pdfUrl).length,
          // Earlier delivered URLs are lost when a rerun/revalidation nulls pdfUrl
          // or regenerates a new file name; the Lead trace still marks the job.
          jobsWithLeadButNoStoredPdf: freeAuditJobs.filter(
            (job) =>
              job.leadDeliveryRecords > 0 && job.storedPdf.host === "none"
          ).length,
          leadDeliveryRecords: leads.length,
          distinctLeadEmails: new Set(
            leads.map((lead) => sha256(lead.email.trim().toLowerCase()))
          ).size,
          distinctRequesterEmails: new Set(
            jobs.map((job) => sha256(job.email.trim().toLowerCase()))
          ).size,
          byMonth,
          hosts,
          jobs: freeAuditJobs,
        },
        coverage: {
          storedUrlScope: "latest-db-url-only",
          blobListingReconciled: false,
          emailSendLogInDb: false,
          attachmentsTracked: false,
        },
      };
    },
    { maxWait: 10_000, timeout: 120_000 }
  );
}
