// GET /api/admin/report-source/<AuditJob.id> — 영업 리포트용 **사실 원본**(ReportSource@1) 내려받기.
//
// 🔒 운영자(admin) 전용. 원문 전체가 들어 있으므로 고객·외부에 보내지 않는다.
// 🔴 옛 측정(원문·질문 원문 없음)·미완료 회차는 422 + 사유 목록(재측정 필요).
// v12 리포트 세션은 이 JSON 의 run.resultSha256 을 판별 파일(ReportReview@1)에 적어 넣는다.

import { requireAdmin } from "@repo/auth/admin";
import { log } from "@repo/observability/log";
import { NextResponse } from "next/server";
import { z } from "zod";
import { loadReportSource } from "@/lib/client-report/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  let adminId: string;
  try {
    adminId = await requireAdmin();
  } catch {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: NO_STORE }
    );
  }
  const { jobId } = await params;
  if (!z.string().uuid().safeParse(jobId).success) {
    return NextResponse.json(
      { error: "invalid_job_id" },
      { status: 400, headers: NO_STORE }
    );
  }
  const loaded = await loadReportSource(jobId);
  if (!loaded.ok) {
    return NextResponse.json(
      { error: "source_unavailable", reasons: loaded.errors },
      { status: loaded.status, headers: NO_STORE }
    );
  }
  log.info("admin.report_source.export", {
    adminId,
    jobId,
    answers: loaded.source.answers.length,
  });
  return NextResponse.json(loaded.source, {
    headers: {
      ...NO_STORE,
      "Content-Disposition": `attachment; filename="report-source_${jobId.slice(0, 8)}.json"`,
    },
  });
}
