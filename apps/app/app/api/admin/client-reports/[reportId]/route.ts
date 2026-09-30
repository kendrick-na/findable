// DELETE /api/admin/client-reports/<Report.id> — 공유 링크 폐기(토큰 삭제 → 즉시 404).
// PATCH  /api/admin/client-reports/<Report.id> {action:"approve-send", approverName} —
//   대표 고객 발송 최종 승인(판별 검토 승인과 다른 단계). 승인 전 링크는 「내부 시안」.
// 🔒 운영자(admin) 전용. 발행본 데이터와 열람 기록은 남긴다(감사 추적).

import { requireAdmin } from "@repo/auth/admin";
import { log } from "@repo/observability/log";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  approveClientReportSend,
  revokeClientReport,
} from "@/lib/client-report/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ reportId: string }> }
) {
  let adminId: string;
  try {
    adminId = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { reportId } = await params;
  if (!z.string().uuid().safeParse(reportId).success) {
    return NextResponse.json({ error: "invalid_report_id" }, { status: 400 });
  }
  const revoked = await revokeClientReport(reportId);
  log.warn("admin.client_report.revoked", { adminId, reportId, revoked });
  return revoked
    ? NextResponse.json({ revoked: true })
    : NextResponse.json(
        { error: "not_found_or_already_revoked" },
        { status: 404 }
      );
}

const PatchSchema = z.object({
  action: z.literal("approve-send"),
  approverName: z.string().trim().min(1).max(40),
  /** 화면에서 「링크를 직접 열어 확인했다」 체크 — 보지 않고 누르는 것을 막는다. */
  viewedLink: z.literal(true),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> }
) {
  let adminId: string;
  try {
    adminId = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { reportId } = await params;
  if (!z.string().uuid().safeParse(reportId).success) {
    return NextResponse.json({ error: "invalid_report_id" }, { status: 400 });
  }
  const body = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const outcome = await approveClientReportSend({
    adminId,
    reportId,
    approverName: body.data.approverName,
  });
  log.warn("admin.client_report.send_approval", {
    adminId,
    reportId,
    outcome: outcome.kind,
  });
  switch (outcome.kind) {
    case "approved":
      return NextResponse.json({
        approved: true,
        approvedAt: outcome.approvedAt,
      });
    case "already_approved":
      return NextResponse.json({ error: "already_approved" }, { status: 409 });
    case "not_live":
      return NextResponse.json(
        { error: "not_live", reason: outcome.reason },
        { status: 409 }
      );
    default:
      return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
