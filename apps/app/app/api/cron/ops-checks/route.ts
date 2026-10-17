// 운영자 알림 점검 cron (2026-10-18, 안정성 U4)
//
// 읽기 전용 DB 조회로 엔진 실패·429 비율 · 쿼터 연속 오류 · 대기 초과 · 측정 실패율 · 무료 일일 원가를 보고,
// 기준을 넘으면 Sentry 경고(`captureOpsAlert`)를 올린다. 새 알림 채널 없음.
//
// 🔒 인증: `denyIfNotCron`(CRON_SECRET Bearer 만 신뢰). 플래그 `STABILITY_OPS_ALERTS_ENABLED` 꺼짐이면 즉시 skip —
//    인증 **뒤**에 확인한다(꺼져 있어도 외부인이 이 주소로 상태를 알아내지 못하게).
// ⚠️ "멈춘 작업 정리"는 `sweep-stuck-jobs` 가 한다 — 여기서 중복 구현하지 않는다(대기 10분 초과는 알림만).
// ⚠️ 예약(vercel.json)은 합치는 사람이 추가한다.

import { isStabilityFlagOn } from "@repo/audit/stability-flags";
import { withCronHeartbeat } from "@repo/observability/cron-heartbeat";
import { log } from "@repo/observability/log";
import { denyIfNotCron } from "@repo/security/cron";
import type { NextRequest } from "next/server";
import { runOpsChecks } from "@/lib/ops-checks/run";

export const maxDuration = 60;

export const GET = async (request: NextRequest) => {
  const denied = denyIfNotCron(request);
  if (denied) {
    return denied;
  }
  if (!isStabilityFlagOn("STABILITY_OPS_ALERTS_ENABLED")) {
    return Response.json({ ok: true, skipped: "flag_off" });
  }
  const summary = await withCronHeartbeat("ops-checks", "*/15 * * * *", () =>
    runOpsChecks()
  );
  log.info("cron.ops_checks.done", {
    alerts: summary.alerts.length,
    failedChecks: summary.failedChecks.length,
  });
  return Response.json({ ok: true, ...summary });
};
