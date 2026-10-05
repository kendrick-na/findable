// /api/admin/client-reports — 영업 리포트 점검(preview)·발행(issue)·목록.
//
// 🔒 운영자(admin) 전용.
// 🔴 기본은 preview(쓰기 0). issue 는 사람 승인(status=approved·검토자·검토일)과
//   원본 일치(회차 ID·해시)·판별 누락 0·최근 측정을 모두 통과할 때만 Report 1행을 만든다.
// 🔴 PDF 는 발행된 `/r/<토큰>?print=1` 을 인쇄한다(scripts/print-client-report.ts) — 같은 데이터.

import { requireAdmin } from "@repo/auth/admin";
import { log } from "@repo/observability/log";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/env";
import {
  issueClientReport,
  listIssuedReports,
  reportWebUrl,
} from "@/lib/client-report/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const BodySchema = z.object({
  auditJobId: z.string().uuid(),
  review: z.unknown(),
  mode: z.enum(["preview", "issue"]).default("preview"),
  version: z.number().int().positive().max(99),
  slug: z.string().regex(/^[a-z0-9-]{1,40}$/),
  expiresInDays: z.number().int().positive().max(90).default(30),
});

const webUrl = () => reportWebUrl(env.NEXT_PUBLIC_WEB_URL);

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: NO_STORE }
    );
  }
  return NextResponse.json(
    { reports: await listIssuedReports(webUrl()) },
    { headers: NO_STORE }
  );
}

export async function POST(request: Request) {
  let adminId: string;
  try {
    adminId = await requireAdmin();
  } catch {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: NO_STORE }
    );
  }
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body" },
      { status: 400, headers: NO_STORE }
    );
  }
  const outcome = await issueClientReport(parsed.data);
  switch (outcome.kind) {
    case "source_error":
      return NextResponse.json(
        { error: "source_unavailable", reasons: outcome.errors },
        { status: outcome.status, headers: NO_STORE }
      );
    case "review_error":
      return NextResponse.json(
        { error: "review_rejected", reasons: outcome.errors },
        { status: 422, headers: NO_STORE }
      );
    case "duplicate_version":
      return NextResponse.json(
        { error: "duplicate_version" },
        { status: 409, headers: NO_STORE }
      );
    case "preview":
      return NextResponse.json(
        {
          mode: "preview",
          summary: outcome.data.computed.s,
          denominator: outcome.data.denominator,
          review: outcome.data.review,
        },
        { headers: NO_STORE }
      );
    default:
      log.warn("admin.client_report.issued", {
        adminId,
        reportId: outcome.reportId,
        auditJobId: parsed.data.auditJobId,
        version: parsed.data.version,
        n: outcome.data.denominator.n,
      });
      return NextResponse.json(
        {
          mode: "issue",
          reportId: outcome.reportId,
          url: `${webUrl()}/r/${outcome.token}`,
          summary: outcome.data.computed.s,
          denominator: outcome.data.denominator,
        },
        { status: 201, headers: NO_STORE }
      );
  }
}
