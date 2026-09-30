// DELETE /api/admin/client-reports/<Report.id> — 공유 링크 폐기(토큰 삭제 → 즉시 404).
// 🔒 운영자(admin) 전용. 발행본 데이터와 열람 기록은 남긴다(감사 추적).

import { requireAdmin } from "@repo/auth/admin";
import { log } from "@repo/observability/log";
import { NextResponse } from "next/server";
import { z } from "zod";
import { revokeClientReport } from "@/lib/client-report/admin";

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
