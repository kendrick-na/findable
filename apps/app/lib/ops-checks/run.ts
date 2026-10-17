import { captureOpsAlert } from "@repo/observability/ops-alert";
import {
  evaluateEngineRates,
  evaluateFreeCost,
  evaluateJobFailureRate,
  evaluateQueueWait,
  evaluateQuotaStreak,
  type OpsAlert,
} from "./evaluate";
import {
  loadEngineWindowStats,
  loadFreeDailyUsage,
  loadJobOutcomes,
  loadQueueWait,
  loadRecentFinishedQuotaSignals,
} from "./load";
import { opsThresholds } from "./thresholds";

export interface OpsChecksSummary {
  alerts: Pick<OpsAlert, "kind" | "message">[];
  /** 조회에 실패해 건너뛴 점검(알림 경로가 죽어도 나머지는 계속 돈다). */
  failedChecks: string[];
}

/**
 * 읽기 전용 점검 5종을 돌리고 기준을 넘은 것만 `captureOpsAlert` 로 올린다.
 * ④ cron 정지는 여기서 직접 읽지 않는다 — 각 cron 이 `withCronHeartbeat` 로 보내는 Sentry 모니터 체크인이 감지한다.
 * 한 점검이 실패해도 다른 점검은 계속한다(실패는 summary.failedChecks 에만 남긴다 — 원문 오류를 알림에 싣지 않는다).
 */
export async function runOpsChecks(
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env
): Promise<OpsChecksSummary> {
  const t = opsThresholds(env);
  const alerts: OpsAlert[] = [];
  const failedChecks: string[] = [];

  const attempt = async (
    name: string,
    run: () => Promise<OpsAlert[]>
  ): Promise<void> => {
    try {
      alerts.push(...(await run()));
    } catch {
      failedChecks.push(name);
    }
  };

  await attempt("engine_rates", async () =>
    evaluateEngineRates(await loadEngineWindowStats(now), t)
  );
  await attempt("quota_streak", async () =>
    evaluateQuotaStreak(await loadRecentFinishedQuotaSignals(now), t)
  );
  await attempt("queue_wait", async () =>
    evaluateQueueWait(await loadQueueWait(now, t.queueWaitMinutes), t)
  );
  await attempt("job_failure_rate", async () =>
    evaluateJobFailureRate(await loadJobOutcomes(now), t)
  );
  await attempt("free_cost", async () =>
    evaluateFreeCost(await loadFreeDailyUsage(now), t)
  );

  for (const alert of alerts) {
    captureOpsAlert(alert.message, alert.context);
  }
  return {
    alerts: alerts.map(({ kind, message }) => ({ kind, message })),
    failedChecks,
  };
}
