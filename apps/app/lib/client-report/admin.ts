import "server-only";

// 영업 리포트 발행 — 관리자 전용 DB 처리(원본 내보내기·점검·발행·폐기·영업 링크).
//
// 🔴 권한 확인은 호출하는 라우트/페이지가 **먼저** 한다(requireAdmin). 이 모듈은 DB 만 다룬다.
// 🔴 발행 = Report 행 1개 생성(type=custom, accessToken 256비트). 기존 무료 진단(/ko/audit)
//   과 v1 리포트는 건드리지 않는다.
// 🔴 링크는 승인본(v2)만. 초안·만료·폐기 리포트는 영업 reportUrl 로 나가지 않는다.

import { randomBytes } from "node:crypto";
import {
  buildReportFromReview,
  type ReviewError,
} from "@repo/audit/client-report/publish";
import {
  type ClientReportDataV2,
  isClientReportExpired,
  parseClientReportData,
} from "@repo/audit/client-report/report-data";
import {
  buildReportSource,
  type ReportSource,
  type SourceError,
} from "@repo/audit/client-report/source";
import { database } from "@repo/database";

export const MAX_EXPIRES_DAYS = 90;
const TRAILING_SLASH_RE = /\/$/;
const SCHEME_RE = /^https?:\/\//;
const WWW_RE = /^www\./;
const PATH_RE = /\/.*$/;

/** 운영 웹 주소(끝 슬래시 제거). 없으면 공식 주소. */
export function reportWebUrl(value: string | undefined): string {
  return (value || "https://www.findable.co.kr").replace(TRAILING_SLASH_RE, "");
}

/** 리드 도메인과 발행본 도메인을 같은 모양으로 맞춘다. */
export function bareDomain(d: string): string {
  return d
    .toLowerCase()
    .replace(SCHEME_RE, "")
    .replace(WWW_RE, "")
    .replace(PATH_RE, "");
}

export async function loadReportSource(auditJobId: string): Promise<
  | {
      ok: true;
      source: ReportSource;
      job: { organizationId: string | null; brandId: string | null };
    }
  | { ok: false; status: 404 | 422; errors: SourceError[] | ["not_found"] }
> {
  const job = await database.auditJob.findUnique({
    where: { id: auditJobId },
    select: {
      id: true,
      status: true,
      domain: true,
      createdAt: true,
      completedAt: true,
      result: true,
      organizationId: true,
      brandId: true,
    },
  });
  if (!job) {
    return { ok: false, status: 404, errors: ["not_found"] };
  }
  const built = buildReportSource(job);
  if (!built.ok) {
    return { ok: false, status: 422, errors: built.errors };
  }
  return {
    ok: true,
    source: built.source,
    job: { organizationId: job.organizationId, brandId: job.brandId },
  };
}

export type IssueOutcome =
  | { kind: "source_error"; status: 404 | 422; errors: string[] }
  | { kind: "review_error"; errors: ReviewError[] }
  | { kind: "duplicate_version" }
  | { kind: "preview"; data: ClientReportDataV2 }
  | {
      kind: "issued";
      reportId: string;
      token: string;
      data: ClientReportDataV2;
    };

export async function issueClientReport(input: {
  auditJobId: string;
  expiresInDays: number;
  mode: "preview" | "issue";
  now?: Date;
  review: unknown;
  slug: string;
  version: number;
}): Promise<IssueOutcome> {
  const loaded = await loadReportSource(input.auditJobId);
  if (!loaded.ok) {
    return {
      kind: "source_error",
      status: loaded.status,
      errors: loaded.errors,
    };
  }
  const now = input.now ?? new Date();
  const days = Math.min(Math.max(1, input.expiresInDays), MAX_EXPIRES_DAYS);
  const built = buildReportFromReview({
    source: loaded.source,
    review: input.review,
    mode: input.mode,
    slug: input.slug,
    version: input.version,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + days * 86_400_000),
  });
  if (!built.ok) {
    return { kind: "review_error", errors: built.errors };
  }
  if (input.mode === "preview") {
    return { kind: "preview", data: built.data };
  }
  // 같은 회차·같은 판(version)을 두 번 발행하지 않는다 — 고치려면 판을 올린다.
  const existing = await database.report.findFirst({
    where: {
      type: "custom",
      AND: [
        { data: { path: ["source", "auditJobId"], equals: input.auditJobId } },
        { data: { path: ["version"], equals: input.version } },
      ],
    },
    select: { id: true },
  });
  if (existing) {
    return { kind: "duplicate_version" };
  }
  const token = randomBytes(32).toString("base64url");
  const row = await database.report.create({
    data: {
      type: "custom",
      organizationId: loaded.job.organizationId,
      brandId: loaded.job.brandId,
      accessToken: token,
      data: JSON.parse(JSON.stringify(built.data)),
    },
    select: { id: true },
  });
  return { kind: "issued", reportId: row.id, token, data: built.data };
}

/** 링크 폐기 — 토큰만 지운다(발행본 데이터·열람 기록은 보존). 즉시 404. */
export async function revokeClientReport(reportId: string): Promise<boolean> {
  const result = await database.report.updateMany({
    where: { id: reportId, type: "custom", accessToken: { not: null } },
    data: { accessToken: null },
  });
  return result.count > 0;
}

export interface IssuedReportRow {
  accessToken: string | null;
  data: unknown;
  generatedAt: Date;
  id: string;
}

export interface IssuedReportView {
  auditJobId: string;
  brand: string;
  domain: string;
  expiresAt: string | null;
  id: string;
  issuedAt: string;
  n: number;
  okN: number;
  reviewedAt: string | null;
  reviewer: string | null;
  state: "live" | "expired" | "revoked";
  url: string | null;
  version: number;
}

/** 발행 목록 — v2 승인본만(v1·형식 불일치 행은 빼고 센다). 순수 함수. */
export function issuedReportViews(
  rows: IssuedReportRow[],
  webUrl: string,
  now: Date = new Date()
): IssuedReportView[] {
  const base = webUrl.replace(TRAILING_SLASH_RE, "");
  return rows.flatMap((row) => {
    const data = parseClientReportData(row.data);
    if (data?.schemaVersion !== 2) {
      return [];
    }
    const expired = isClientReportExpired(data, now);
    let state: IssuedReportView["state"] = "live";
    if (!row.accessToken) {
      state = "revoked";
    } else if (expired) {
      state = "expired";
    }
    return [
      {
        id: row.id,
        auditJobId: data.source.auditJobId,
        brand: data.config.brand,
        domain: data.config.domain,
        version: data.version,
        n: data.computed.s.n,
        okN: data.computed.s.ok_n,
        reviewer: data.review.reviewer,
        reviewedAt: data.review.reviewedAt,
        issuedAt: data.release.issuedAt,
        expiresAt: data.release.expiresAt,
        state,
        url: state === "live" ? `${base}/r/${row.accessToken}` : null,
      },
    ];
  });
}

/**
 * T8 — 영업 리드 도메인 → 승인된 v12 링크. 살아 있는(폐기·만료 아님) 승인본 중 가장 최신 판.
 * 초안·v1·만료·폐기는 절대 들어가지 않는다.
 */
export function approvedReportUrlByDomain(
  views: IssuedReportView[]
): Map<string, string> {
  const best = new Map<string, IssuedReportView>();
  for (const v of views) {
    if (!(v.state === "live" && v.url)) {
      continue;
    }
    const key = bareDomain(v.domain);
    const prev = best.get(key);
    if (
      !prev ||
      v.version > prev.version ||
      (v.version === prev.version && v.issuedAt > prev.issuedAt)
    ) {
      best.set(key, v);
    }
  }
  return new Map([...best].map(([d, v]) => [d, v.url as string]));
}

export async function listIssuedReports(
  webUrl: string,
  now: Date = new Date()
): Promise<IssuedReportView[]> {
  const rows = await database.report.findMany({
    where: { type: "custom", data: { path: ["schemaVersion"], equals: 2 } },
    orderBy: { generatedAt: "desc" },
    take: 100,
    select: { id: true, accessToken: true, data: true, generatedAt: true },
  });
  return issuedReportViews(rows, webUrl, now);
}
