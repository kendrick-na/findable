// stuck AuditJob 스윕 cron — 2차 안전망(최종)
//
// 배경: crew-runner 는 CREW_TIMEOUT_MS(270s) 로 자체 정리하지만, 함수 급사
//       (Vercel kill·크래시)로 그 코드가 못 돌면 status/crewStatus 가 processing
//       또는 queued 에 영구 고정된다. 이 cron 이 오래된 것을 failed 로 정리한다.
//
// 정리 대상(멱등, updateMany, 스키마 무변경):
//   1) 빠른 모드: `@repo/audit/stale-job` 의 `staleAuditJobsWhere` 단일 기준 → status=failed
//      (processing = 실행 lease 만료 또는 lease 없는 6분 초과, queued = 30분 초과).
//      러너·화면의 `isStaleAuditJob` 과 같은 기준이라 cron 만 먼저 죽이는 일이 없다.
//   2) crew:    crewStatus = processing 이고 crewStartedAt 이 STALE 초과 → crewStatus=failed
//
// ⚠️ 배포 위치 = apps/web(findable, 이미 배포·env 세팅됨). apps/api 는 미배포라 web 에 둠.
//    Pro 플랜 cron 을 15분 간격으로 예약해 함수 급사 후 장시간 방치되는 잡을 정리한다.
//    1차 안전망은 crew-runner 270s 이며, 이 스윕은 그 안전망이 실행되지 못한 경우를 맡는다.
//
// 인증: `denyIfNotCron` 단일 진실(`CRON_SECRET` Bearer 만 신뢰).
//   🔴 예전엔 `x-vercel-cron` 헤더 폴백이 있었고 그게 **외부에서 스푸핑 가능한 구멍**이었다.
//      되살리지 말 것 → `packages/security/cron.ts` 주석 참고.

import {
  AUDIT_JOB_QUEUE_STALE_ERROR,
  staleAuditJobsWhere,
} from "@repo/audit/stale-job";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { captureOpsAlert } from "@repo/observability/ops-alert";
import { denyIfNotCron } from "@repo/security/cron";
import type { NextRequest } from "next/server";

export const maxDuration = 30;

// crew 단계 전용 임계값. crew route STALE_AFTER_MS(15분)와 동일.
const STALE_AFTER_MS = 15 * 60 * 1000;

export const GET = async (request: NextRequest) => {
  const denied = denyIfNotCron(request);
  if (denied) {
    return denied;
  }

  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);

  // 1) 빠른 모드 stuck — 기준은 stale-job 단일 진실. 문구 "stuck-swept" 는
  //    measure-one 의 재개 판별(RESUMABLE_TIMEOUT_RE)이 읽으므로 바꾸지 말 것.
  const now = new Date();
  const fastProcessing = await database.auditJob.updateMany({
    where: staleAuditJobsWhere("processing", now),
    data: {
      status: "failed",
      errorMessage:
        "stuck-swept: 백그라운드 처리가 시간 내 완료되지 않았습니다.",
      completedAt: now,
      leaseToken: null,
      leaseUntil: null,
    },
  });
  const fastQueued = await database.auditJob.updateMany({
    where: staleAuditJobsWhere("queued", now),
    data: {
      status: "failed",
      errorMessage: AUDIT_JOB_QUEUE_STALE_ERROR,
      completedAt: now,
      leaseToken: null,
      leaseUntil: null,
    },
  });
  const fast = { count: fastProcessing.count + fastQueued.count };

  // 2) crew stuck
  const crew = await database.auditJob.updateMany({
    where: {
      crewStatus: "processing",
      crewStartedAt: { lt: staleBefore },
    },
    data: {
      crewStatus: "failed",
      crewCompletedAt: new Date(),
    },
  });

  const swept = { crew: crew.count, fast: fast.count };
  if (swept.fast > 0 || swept.crew > 0) {
    log.warn("cron.sweep-stuck-jobs.swept", swept);

    // 🔴 BL-Day17-02(2026-08-12 세션N-24) — 예전엔 위 `log.warn` 하나로 끝났고
    //    **아무도 그 로그를 보지 않았다**("알림을 로그로 대신하는" 혼용 함정).
    //    Logtail 을 사람이 상시 들여다보지 않으므로, 스윕이 실제로 무언가를 주웠으면
    //    Sentry 로 올려 **런북(§2 stuck)** 진입점을 만든다.
    //
    // 🔬 **왜 임계값(threshold)을 두지 않았나** — 백로그 원안은 `SWEEP_ALERT_THRESHOLD`
    //    (기본 3)를 제안했지만 그 "3"에는 **근거가 없다**. 이 저장소에는 stuck 발생
    //    분포 자체가 없어서(측정 2회·시계열 1일) 경계선을 정하면 그건 발명이다.
    //    → 근거 없는 임계값 발명 금지 규칙에 걸린다(전력: *"40% 미만 경고"* 를 제안했다가 철회).
    //
    //    ⭐ 대신 **구조가 임계값을 대신한다**: 1차 가드가 `CREW_TIMEOUT_MS`(270초,
    //    `packages/audit/crew-runner.ts:28`)로 스스로 정리하므로, 이 스윕이 줍는 건
    //    **1차 가드가 아예 못 돌았을 때(함수 급사)뿐**이다.
    //    즉 `count > 0` 자체가 이미 예외 상황이라 별도 경계선이 필요 없다.
    captureOpsAlert("cron.sweep-stuck-jobs: stuck 작업을 정리했습니다", swept);
  }

  return Response.json({ ok: true, swept });
};
