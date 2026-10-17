// 측정 대기 줄 일꾼 cron (안정성 U2, 플래그 STABILITY_ADMISSION_ENABLED).
//
// 1회 호출 = 함수 1개 = 최대 300초 → 호출당 측정 1건만 집어 실행한다.
// 1분 간격으로 부르면 호출이 겹쳐 여러 건이 동시에 돈다(전역·고객별 상한 안에서 — lib/audit-queue/worker).
// 옴니버스 cron(auto-refresh-tracking)과 별개 라우트다 — 그쪽은 건드리지 않는다.
//
// 인증은 `denyIfNotCron`(CRON_SECRET Bearer, Preview 403) — 원가가 나가는 작업 이전에 막는다.

import { isStabilityFlagOn } from "@repo/audit/stability-flags";
import { log } from "@repo/observability/log";
import { denyIfNotCron } from "@repo/security/cron";
import type { NextRequest } from "next/server";
import { runAuditQueueTick } from "@/lib/audit-queue/worker";

export const maxDuration = 300;

export const GET = async (request: NextRequest) => {
  const invocationStartedAtMs = Date.now();
  const denied = denyIfNotCron(request);
  if (denied) {
    return denied;
  }
  if (!isStabilityFlagOn("STABILITY_ADMISSION_ENABLED")) {
    return Response.json({ skipped: true });
  }
  const result = await runAuditQueueTick(invocationStartedAtMs);
  log.info("audit.queue.tick", { ...result });
  return Response.json(result);
};
