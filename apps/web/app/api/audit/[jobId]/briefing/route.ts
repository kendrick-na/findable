// POST /api/audit/[jobId]/briefing — 네이버 AI 브리핑 on-demand 측정 트리거
//
// 무료 Audit 빠른 모드(7 엔진) 완료 후 사용자가 "네이버 AI 브리핑 측정" 클릭 시 호출.
// after()로 백그라운드 실행, result.briefingStatus를 업데이트.
//
// 같은 jobId에 대해 이미 processing/completed면 409 반환 (중복 트리거 방지).
// Runtime: Node.js, maxDuration 300s (Browserbase 클라우드 크롬은 느림).

import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import type { NextRequest } from "next/server";
import { after, NextResponse } from "next/server";
import { runBriefingForAuditJob } from "@/lib/audit/briefing-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

type BriefingStatus = "not_requested" | "processing" | "completed" | "failed";

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { jobId } = await params;
  log.info("audit.briefing.requested", { jobId });

  try {
    if (!jobId || typeof jobId !== "string" || jobId.length < 10) {
      return NextResponse.json(
        { error: "잘못된 jobId입니다." },
        { status: 400 }
      );
    }

    const job = await database.auditJob.findUnique({
      where: { id: jobId },
      select: { id: true, status: true, result: true },
    });

    if (!job) {
      return NextResponse.json(
        { error: "존재하지 않는 jobId입니다." },
        { status: 404 }
      );
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

    // briefingStatus는 result JSON 내부에 저장됨.
    const briefingStatus = ((job.result as { briefingStatus?: BriefingStatus })
      .briefingStatus ?? "not_requested") as BriefingStatus;

    if (briefingStatus === "processing") {
      return NextResponse.json(
        { error: "이미 측정이 진행 중입니다.", briefingStatus },
        { status: 409 }
      );
    }

    if (briefingStatus === "completed") {
      return NextResponse.json(
        { error: "이미 측정이 완료되었습니다.", briefingStatus },
        { status: 409 }
      );
    }

    // 중복 트리거 방지: after() 예약 전에 processing을 먼저 커밋한다.
    // (crew route와 동일 패턴 — 백그라운드 러너 내부 세팅만으로는 응답 시점까지
    //  상태가 not_requested로 남아 동시 2요청이 둘 다 통과, Browserbase 중복 호출됨.)
    // result JSON은 공유되므로 최신 값 위에 briefingStatus만 병합.
    await database.auditJob.update({
      where: { id: jobId },
      data: {
        result: {
          ...(job.result as Record<string, unknown>),
          briefingStatus: "processing",
        } as never,
      },
    });

    after(async () => {
      try {
        await runBriefingForAuditJob({ jobId });
      } catch (error) {
        log.error("audit.briefing.uncaught", {
          jobId,
          error: parseError(error),
        });
      }
    });

    return NextResponse.json({
      jobId,
      briefingStatus: "processing",
      pollUrl: `/api/audit/${jobId}`,
    });
  } catch (error) {
    const message = parseError(error);
    log.error("audit.briefing.unhandled", { jobId, error: message });
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
