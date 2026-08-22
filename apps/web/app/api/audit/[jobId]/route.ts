// GET /api/audit/[jobId] — 무료 Audit 잡 상태·결과 폴링
//
// PRD §11.2 AuditResponse 반환. 비로그인 접근 가능 (jobId가 secret 역할).
// jobId는 UUID v4 (Prisma @default(uuid))이므로 추측 불가.

import {
  type AuditHistoryComparison,
  buildAuditHistory,
  EMPTY_HISTORY,
} from "@repo/audit/history";
import { maskEmail } from "@repo/audit/mask";
import { isUsableRun, scoreOf } from "@repo/audit/run-quality";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveIsOwner } from "../_lib/owner";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

// `maskEmail` 은 `@repo/audit/mask` 로 승격했다(2026-08-08) — 로그 마스킹에도 같은 규율이
//   필요해졌고, 복사하면 한쪽만 고쳐지는 상태가 된다.

/**
 * 히스토리 조회 상한. 1회 측정 = job 1건이라 넉넉하다(실측 최다 이메일이 21건).
 * ⚠️ 폴링 라우트라 매 초 호출된다 — 무거워지면 안 된다. select 도 최소 필드만.
 */
const HISTORY_TAKE = 50;

// ⚠️ `scoreOf`·`isUsableRun`·`metricsOf` 는 원래 이 파일의 사설 함수였다.
//   주간 재측정 알림 cron(투두 #68)이 같은 판정을 쓰므로 `@repo/audit/run-quality` 로
//   승격했다(2026-08-08). 복사하면 화면과 메일이 서로 다른 점수를 말하게 된다.

/**
 * "지난번보다 나아졌나" — 같은 **이메일 + 같은 브랜드**의 직전 측정과 비교(투두 #59).
 *
 * 🔒 이메일로 스코프하는 이유: 도메인만으로 묶으면 남의 진단이 섞인다.
 *   실측(2026-08-07) `medicube.co.kr` 한 도메인에 이메일이 **15개**였다.
 *
 * best-effort — 실패해도 본 응답(결과 표시)을 깨지 않는다.
 */
async function loadHistory(job: {
  createdAt: Date;
  domain: string;
  email: string;
  id: string;
}): Promise<AuditHistoryComparison> {
  try {
    const rows = await database.auditJob.findMany({
      where: { email: job.email, status: "completed" },
      select: { id: true, domain: true, createdAt: true, result: true },
      orderBy: { createdAt: "desc" },
      take: HISTORY_TAKE,
    });
    return buildAuditHistory(
      rows.map((r) => ({
        id: r.id,
        domain: r.domain,
        createdAt: r.createdAt,
        score: scoreOf(r.result),
        usable: isUsableRun(r.result),
      })),
      job.id,
      job.domain
    );
  } catch (error) {
    log.warn("audit.history.failed", {
      jobId: job.id,
      error: parseError(error),
    });
    return EMPTY_HISTORY;
  }
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
        email: true,
        // 소유 판별용(FK = 조직 측정의 정식 연결). 응답에 그대로 내보내지 않는다.
        organizationId: true,
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

    // 히스토리는 **완료된 job 에서만** 조회한다. 이 라우트는 진행 중 1초 간격으로
    //   폴링되므로, 아직 결과가 없는 동안 매번 추가 쿼리를 도는 건 낭비다.
    const history =
      job.status === "completed" ? await loadHistory(job) : EMPTY_HISTORY;

    // 🔒 소유 판별 — 비로그인이면 `auth()` 가 빈 값을 주고 그대로 **비소유자**가 된다.
    //   ⚠️ 실패해도 결과 조회 자체는 깨뜨리지 않는다. 다만 실패 시 기본값은
    //      **비소유(false)** 다 — 판별을 못 하는 상황에서 노출하는 쪽으로 기울면
    //      그게 바로 이 항목이 생긴 이유다(닫히는 쪽이 안전한 기본값).
    const isOwner = await resolveIsOwner(job);

    return NextResponse.json({
      jobId: job.id,
      // 세션L L-1: 결과 소유권 연결용. 무료 진단은 "이 진단에 쓴 이메일로 가입해야"
      // 결과가 대시보드에 이어진다(app 대시보드가 AuditJob.email 로 내 측정을 찾음).
      //
      // 🔴 세션N-26 — **소유자에게만** 준다. 예전엔 소유 검사 없이 항상 줬고,
      //   화면쪽 `?shared=1` 방어는 `window.location` 을 읽는 **클라이언트 전용**이라
      //   ①주소창 URL 을 그대로 복사해 보내면 표식이 없어 제3자에게 보였고
      //   ②API 를 직접 부르면 방어가 **아예 없었다**.
      //   ⚠️ 마스킹 값이라도 **응답에 넣지 않는다** — 보내놓고 화면에서 가리는 건
      //      방어가 아니다(네트워크 탭에 그대로 남는다).
      ...(isOwner
        ? {
            emailMasked: maskEmail(job.email),
            emailDomain: job.email.split("@")[1] ?? null,
          }
        : {}),
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
      // 투두 #59: "지난번보다 나아졌나". 첫 측정이면 전부 null·totalRuns=1.
      history,
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
