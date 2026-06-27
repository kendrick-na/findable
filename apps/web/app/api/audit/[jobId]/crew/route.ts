// POST /api/audit/[jobId]/crew — 4 에이전트 강화 분석 트리거
//
// 무료 Audit 빠른 모드 완료 후 사용자가 "4 에이전트 분석" 클릭 시 호출.
// after()로 백그라운드 실행, AuditJob.crewStatus 업데이트.
//
// 같은 jobId에 대해 이미 progressing/completed면 409 반환 (중복 트리거 방지).
// Runtime: Node.js, maxDuration 300s.

import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { NextResponse, after } from "next/server";
import type { NextRequest } from "next/server";
import { runCrewForAuditJob } from "@/lib/audit/crew-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { jobId } = await params;
  log.info("audit.crew.requested", { jobId });

  try {
    if (!jobId || typeof jobId !== "string" || jobId.length < 10) {
      return NextResponse.json({ error: "잘못된 jobId입니다." }, { status: 400 });
    }

    const job = await database.auditJob.findUnique({
      where: { id: jobId },
      select: { id: true, status: true, crewStatus: true, result: true },
    });

    if (!job) {
      return NextResponse.json({ error: "존재하지 않는 jobId입니다." }, { status: 404 });
    }

    if (job.status !== "completed" || !job.result) {
      return NextResponse.json(
        {
          error: "빠른 모드 Audit이 먼저 완료되어야 합니다.",
          currentStatus: job.status,
        },
        { status: 400 }
      );
    }

    if (job.crewStatus === "processing" || job.crewStatus === "queued") {
      return NextResponse.json(
        { error: "이미 분석이 진행 중입니다.", crewStatus: job.crewStatus },
        { status: 409 }
      );
    }

    if (job.crewStatus === "completed") {
      return NextResponse.json(
        { error: "이미 분석이 완료되었습니다.", crewStatus: job.crewStatus },
        { status: 409 }
      );
    }

    // queued 상태로 전환 후 백그라운드 트리거
    await database.auditJob.update({
      where: { id: jobId },
      data: { crewStatus: "queued" },
    });

    after(async () => {
      try {
        await runCrewForAuditJob({ jobId });
      } catch (error) {
        log.error("audit.crew.uncaught", { jobId, error: parseError(error) });
      }
    });

    return NextResponse.json({
      jobId,
      crewStatus: "queued",
      pollUrl: `/api/audit/${jobId}`,
    });
  } catch (error) {
    const message = parseError(error);
    log.error("audit.crew.unhandled", { jobId, error: message });
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
