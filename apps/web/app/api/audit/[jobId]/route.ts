// GET /api/audit/[jobId] — 무료 Audit 잡 상태·결과 폴링
//
// PRD §11.2 AuditResponse 반환. 비로그인 접근 가능 (jobId가 secret 역할).
// jobId는 UUID v4 (Prisma @default(uuid))이므로 추측 불가.

import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { jobId } = await params;
  log.debug("audit.poll.received", { jobId });

  try {
    if (!jobId || typeof jobId !== "string" || jobId.length < 10) {
      log.warn("audit.poll.invalid_id", { jobId });
      return NextResponse.json(
        { error: "잘못된 jobId입니다." },
        { status: 400 }
      );
    }

    const job = await database.auditJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        domain: true,
        language: true,
        pdfUrl: true,
        result: true,
        crewStatus: true,
        crewResult: true,
        crewStartedAt: true,
        crewCompletedAt: true,
        errorMessage: true,
        createdAt: true,
        completedAt: true,
      },
    });

    if (!job) {
      return NextResponse.json(
        { error: "존재하지 않는 jobId입니다." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      domain: job.domain,
      language: job.language,
      pdfUrl: job.pdfUrl,
      result: job.result,
      crewStatus: job.crewStatus,
      crewResult: job.crewResult,
      crewStartedAt: job.crewStartedAt?.toISOString() ?? null,
      crewCompletedAt: job.crewCompletedAt?.toISOString() ?? null,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    });
  } catch (error) {
    const message = parseError(error);
    log.error("audit.poll.unhandled", { error: message });
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
