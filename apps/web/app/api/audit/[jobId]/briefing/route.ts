// POST /api/audit/[jobId]/briefing — 네이버 AI 브리핑 on-demand 측정 트리거
//
// 무료 Audit 빠른 모드(7 엔진) 완료 후 사용자가 "네이버 AI 브리핑 측정" 클릭 시 호출.
// after()로 백그라운드 실행, result.briefingStatus를 업데이트.
//
// 같은 jobId에 대해 유효한 processing lease/completed면 409 반환 (중복 트리거 방지).
// Runtime: Node.js, maxDuration 300s (Browserbase 클라우드 크롬은 느림).

import { randomUUID } from "node:crypto";
import { runBriefingForAuditJob } from "@repo/audit/briefing-runner";
import { createAuditRunBudget } from "@repo/audit/run-budget";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { checkBotId } from "botid/server";
import type { NextRequest } from "next/server";
import { after, NextResponse } from "next/server";
import { resolveIsOwner } from "../../_lib/owner";
import { canExposeAuditResult } from "../../_lib/public-access";

export const runtime = "nodejs";
export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

type BriefingStatus = "not_requested" | "processing" | "completed" | "failed";

// A process that disappears after claiming must not hold the customer-visible
// state forever. This is a recovery lease, not a provider idempotency promise.
const BRIEFING_LEASE_MS = 5 * 60 * 1000;

export async function POST(_request: NextRequest, { params }: RouteParams) {
  // BotID — 브리핑은 Browserbase 세션(분당 과금)을 쓰므로 자동화 요청을 먼저 막는다.
  // (등록 경로 = instrumentation-client.ts `/api/audit/*/briefing`)
  const verification = await checkBotId();
  if (verification.isBot) {
    log.warn("audit.briefing.bot_blocked", {});
    return NextResponse.json(
      { error: "자동화된 요청으로 확인되어 차단되었습니다." },
      { status: 403 }
    );
  }

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
      select: {
        id: true,
        email: true,
        organizationId: true,
        status: true,
        result: true,
      },
    });

    if (!job) {
      return NextResponse.json(
        { error: "존재하지 않는 jobId입니다." },
        { status: 404 }
      );
    }

    if (!canExposeAuditResult(job, await resolveIsOwner(job))) {
      return NextResponse.json(
        { error: "이 진단 결과를 조회할 권한이 없습니다." },
        { status: 403 }
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

    const briefingStartedAt = (job.result as { briefingStartedAt?: string })
      .briefingStartedAt;
    const staleProcessing =
      briefingStatus === "processing" &&
      typeof briefingStartedAt === "string" &&
      Number.isFinite(Date.parse(briefingStartedAt)) &&
      Date.now() - Date.parse(briefingStartedAt) >= BRIEFING_LEASE_MS;

    if (briefingStatus === "processing" && !staleProcessing) {
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

    // 중복 트리거 방지: result 전체를 read-modify-write하지 않고 상태 leaf만
    // 조건부로 원자 갱신한다. Tracking/crew/revalidation이 같은 JSON을 바꿔도
    // 예약 획득 시점의 오래된 snapshot이 다른 필드를 지우지 않는다.
    const attemptId = randomUUID();
    const leaseStartedAt = new Date().toISOString();
    const staleBefore = new Date(Date.now() - BRIEFING_LEASE_MS).toISOString();
    const claimed = await database.$executeRawUnsafe(
      `UPDATE "AuditJob"
       SET "result" = jsonb_set(
         jsonb_set(
           jsonb_set(
             COALESCE("result", '{}'::jsonb),
             '{briefingStatus}',
             to_jsonb('processing'::text),
             true
           ),
           '{briefingStartedAt}',
           to_jsonb($2::text),
           true
         ),
         '{briefingAttemptId}',
         to_jsonb($3::text),
         true
       )
       WHERE "id" = $1
         AND "status" = 'completed'
         AND (
           COALESCE("result"->>'briefingStatus', 'not_requested')
             IN ('not_requested', 'failed')
           OR (
             "result"->>'briefingStatus' = 'processing'
             AND "result"->>'briefingStartedAt' IS NOT NULL
             AND "result"->>'briefingStartedAt' <= $4
           )
         )`,
      jobId,
      leaseStartedAt,
      attemptId,
      staleBefore
    );
    if (claimed !== 1) {
      return NextResponse.json(
        { error: "이미 측정이 진행 중이거나 완료되었습니다." },
        { status: 409 }
      );
    }

    after(async () => {
      const budget = createAuditRunBudget();
      try {
        await runBriefingForAuditJob({
          jobId,
          attemptId,
          signal: budget.signal,
        });
      } catch (error) {
        log.error("audit.briefing.uncaught", {
          jobId,
          error: parseError(error),
        });
      } finally {
        budget.dispose();
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
