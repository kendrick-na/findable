// 운영 집계 cron — daily digest(읽기전용, 최종)
//
// 배경: 매일 AuditJob 처리 현황을 한눈에 보기 위한 운영 요약. 진단 생성 수,
//       상태별 분포, 강화(crew) 요청·완료 수, stuck(15분 초과 대기/진행) 수를
//       구조화 로깅으로 남긴다. 관측성 대시보드(@repo/observability)에서 확인.
//
// ⚠️ 배포 위치 = apps/web(findable, 이미 배포·env 세팅됨). apps/api 는 미배포라 web 에 둠.
//    Hobby 플랜 cron 하루1회 제약 → vercel.json schedule 은 "0 15 * * *"(하루1회).
//    🔴 **UTC 다** — 15:00 UTC = **자정 KST**(자세한 함정은 auto-refresh-tracking 상단 참고).
//
// 범위: 읽기 전용 집계만 한다. DB write·이메일/외부 발송은 하지 않는다(env 의존·범위 밖).
//       count / groupBy 만 사용.
//
// 인증: `denyIfNotCron` 단일 진실(`CRON_SECRET` Bearer 만 신뢰).
//   🔴 예전 `x-vercel-cron` 폴백은 **스푸핑 가능한 구멍**이었다 → `packages/security/cron.ts`.

import { BRIEFING_FAIL_PREFIX } from "@repo/ai/lib/engines/briefing-failure";
import { database, Prisma } from "@repo/database";
import { log } from "@repo/observability/log";
import { denyIfNotCron } from "@repo/security/cron";
import type { NextRequest } from "next/server";

export const maxDuration = 30;

// stuck 판정 기준. crew route·sweep-stuck 의 STALE_AFTER_MS(15분)와 동일.
const STALE_AFTER_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const GET = async (request: NextRequest) => {
  const denied = denyIfNotCron(request);
  if (denied) {
    return denied;
  }

  const now = Date.now();
  const since = new Date(now - DAY_MS); // 직전 24h
  const staleBefore = new Date(now - STALE_AFTER_MS);

  // 직전 24h 창(멱등, 읽기 전용). 병렬 집계.
  const [created, statusGroups, crewGroups, stuckCount, briefingJobs] =
    await Promise.all([
    // 어제 생성된 진단 수
    database.auditJob.count({
      where: { createdAt: { gte: since } },
    }),
    // 어제 생성분의 status 분포
    database.auditJob.groupBy({
      by: ["status"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    // 어제 생성분의 crewStatus 분포(강화 요청·완료 추적)
    database.auditJob.groupBy({
      by: ["crewStatus"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    // 현재 stuck 상태(창 무관·전체 기준): 15분 초과 queued/processing
    database.auditJob.count({
      where: {
        status: { in: ["queued", "processing"] },
        createdAt: { lt: staleBefore },
      },
    }),
    /**
     * 🔴 **브리핑이 「조치가 필요해서」 실패했는지**(N-45 · 남은일 #4-b B-6).
     *
     * 왜 필요한가: Firecrawl 크레딧은 **다 마른 뒤에야** 402 로 알 수 있다.
     *   어느 날 갑자기 브리핑이 멈추는데, 화면은(N-45 수정 후) *"이번엔 측정하지
     *   못했어요"* 라고 정직하게 말할 뿐 **👤 에게 알리지는 않는다.**
     *   → 매일 도는 이 다이제스트에 실어 **마르기 전에 보이게** 한다.
     *
     * ⚠️ `result` 는 `Json` 이라 DB 에서 접두어로 못 거른다 → 24h 창만 읽어 앱에서 센다
     *   (읽기 전용·창 제한이라 이 cron 의 기존 성격을 벗어나지 않는다).
     */
    database.auditJob.findMany({
      select: { result: true },
      where: { createdAt: { gte: since }, result: { not: Prisma.DbNull } },
    }),
  ]);

  // groupBy 결과 → 상태별 카운트 맵으로 평탄화
  const byStatus: Record<string, number> = {};
  for (const g of statusGroups) {
    byStatus[g.status] = g._count._all;
  }

  const byCrewStatus: Record<string, number> = {};
  for (const g of crewGroups) {
    byCrewStatus[g.crewStatus] = g._count._all;
  }

  // crew 요청 수 = not_requested 이외 전부, 완료 수 = completed
  const crewRequested = created - (byCrewStatus.not_requested ?? 0);
  const crewCompleted = byCrewStatus.completed ?? 0;

  /**
   * 브리핑 실패를 **사유별로** 센다 — 「미노출」과 섞으면 경보가 무의미해진다.
   * ⛔ `credits`·`auth` 만 👤 조치가 필요하다. `rateLimit` 은 저절로 풀린다.
   */
  const briefing = { auth: 0, credits: 0, measured: 0, rateLimit: 0 };
  for (const job of briefingJobs) {
    const res = job.result as { engineResponses?: unknown } | null;
    const responses = Array.isArray(res?.engineResponses)
      ? (res.engineResponses as Array<{
          engineId?: string;
          errorMessage?: string | null;
        }>)
      : [];
    const br = responses.find((r) => r.engineId === "naver-briefing");
    if (!br) {
      continue;
    }
    const err = br.errorMessage ?? "";
    if (err.startsWith(BRIEFING_FAIL_PREFIX.credits)) {
      briefing.credits += 1;
    } else if (err.startsWith(BRIEFING_FAIL_PREFIX.auth)) {
      briefing.auth += 1;
    } else if (err.startsWith(BRIEFING_FAIL_PREFIX.rateLimit)) {
      briefing.rateLimit += 1;
    } else {
      briefing.measured += 1;
    }
  }

  // 🔴 👤 조치가 필요한 실패는 **별도 로그 레벨**로 올린다 — info 에 묻히면 못 본다.
  const needsAction = briefing.credits + briefing.auth;
  if (needsAction > 0) {
    log.error("cron.daily-ops-digest.briefing_blocked", {
      auth: briefing.auth,
      credits: briefing.credits,
      hint:
        briefing.credits > 0
          ? "Firecrawl 크레딧 충전 필요 — 충전 전까지 네이버 AI 브리핑이 계속 실패한다."
          : "FIRECRAWL_API_KEY 재설정 필요.",
    });
  }

  const digest = {
    window: { from: since.toISOString(), to: new Date(now).toISOString() },
    created,
    completed: byStatus.completed ?? 0,
    failed: byStatus.failed ?? 0,
    processing: byStatus.processing ?? 0,
    queued: byStatus.queued ?? 0,
    crewRequested,
    crewCompleted,
    stuck: stuckCount,
    briefing,
  };

  log.info("cron.daily-ops-digest.summary", digest);

  return Response.json({ ok: true, digest });
};
