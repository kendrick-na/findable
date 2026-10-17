import type { OpsThresholds } from "./thresholds";

/**
 * 알림 판정(순수 함수) — DB 를 모른다. 숫자를 받아 「울릴 알림 목록」을 돌려준다.
 *
 * 규칙
 *  - 메시지는 **고정 문장**이다(숫자·엔진 이름을 안 섞는다 — Sentry 가 같은 문장을 한 이슈로 묶어 매번 새로 울리지 않는다.
 *    엔진별로 나뉘어야 하는 ①만 엔진 이름이 문장에 들어간다).
 *  - context 에는 **집계 숫자와 엔진 이름만** 넣는다. 이메일·IP·도메인·작업 ID 금지(개인정보).
 *  - 경계: 비율·대기 시간은 「넘으면」(>), 연속 건수·원가 비율은 「도달하면」(>=).
 */

export type OpsAlertContext = Record<string, boolean | number | string | null>;

export interface OpsAlert {
  context: OpsAlertContext;
  kind:
    | "engine_failure_rate"
    | "engine_rate_limit_rate"
    | "quota_streak"
    | "queue_wait"
    | "job_failure_rate"
    | "free_cost_budget";
  message: string;
}

export interface EngineWindowStats {
  /** 칸(질문 × 엔진 응답) 수. */
  cells: number;
  engineId: string;
  /** 오류로 기록된 칸 수(타임아웃·429·빈 응답·기타 합) — 늦게 회복된 칸은 뺀 값. */
  failed: number;
  rateLimited: number;
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** ① 엔진별 실패·429 비율. */
export function evaluateEngineRates(
  stats: readonly EngineWindowStats[],
  t: OpsThresholds
): OpsAlert[] {
  const alerts: OpsAlert[] = [];
  for (const s of stats) {
    if (s.cells < t.engineMinCells || s.cells <= 0) {
      continue;
    }
    const failRate = s.failed / s.cells;
    const rateLimitRate = s.rateLimited / s.cells;
    if (failRate > t.engineFailRate) {
      alerts.push({
        context: {
          cells: s.cells,
          engineId: s.engineId,
          failed: s.failed,
          rate: round3(failRate),
          threshold: t.engineFailRate,
          windowMinutes: 60,
        },
        kind: "engine_failure_rate",
        message: `엔진 실패율이 기준을 넘었습니다(최근 1시간): ${s.engineId}`,
      });
    }
    if (rateLimitRate > t.engineRateLimitRate) {
      alerts.push({
        context: {
          cells: s.cells,
          engineId: s.engineId,
          rate: round3(rateLimitRate),
          rateLimited: s.rateLimited,
          threshold: t.engineRateLimitRate,
          windowMinutes: 60,
        },
        kind: "engine_rate_limit_rate",
        message: `엔진 429(요청 몰림) 비율이 기준을 넘었습니다(최근 1시간): ${s.engineId}`,
      });
    }
  }
  return alerts;
}

export interface FinishedJobSignal {
  /** 이 작업의 칸 중 쿼터 계열 오류가 있었나(또는 작업 실패 사유가 쿼터 계열). */
  quotaError: boolean;
}

/**
 * ② 쿼터·잔량 — 잔량을 직접 조회할 방법이 없어 **대리 지표**를 쓴다:
 * 최근에 끝난 작업부터 거슬러 올라가며 쿼터 오류가 **연속**으로 몇 건인지 센다.
 * @param recentFinished 최신순(가장 최근이 앞).
 */
export function evaluateQuotaStreak(
  recentFinished: readonly FinishedJobSignal[],
  t: OpsThresholds
): OpsAlert[] {
  let streak = 0;
  for (const job of recentFinished) {
    if (!job.quotaError) {
      break;
    }
    streak += 1;
  }
  if (t.quotaStreak <= 0 || streak < t.quotaStreak) {
    return [];
  }
  return [
    {
      context: { streak, threshold: t.quotaStreak },
      kind: "quota_streak",
      message:
        "AI 서비스 사용 한도(쿼터) 오류가 최근 작업에서 연속으로 나고 있습니다(잔량 조회 대신 쓰는 대리 지표)",
    },
  ];
}

/** ③ 대기 초과 — 시작 안 된 queued 작업. */
export function evaluateQueueWait(
  waiting: { count: number; oldestWaitMinutes: number },
  t: OpsThresholds
): OpsAlert[] {
  if (waiting.count <= 0 || waiting.oldestWaitMinutes <= t.queueWaitMinutes) {
    return [];
  }
  return [
    {
      context: {
        count: waiting.count,
        oldestWaitMinutes: Math.round(waiting.oldestWaitMinutes),
        thresholdMinutes: t.queueWaitMinutes,
      },
      kind: "queue_wait",
      message: "시작되지 않고 대기 중인 측정 작업이 기준 시간을 넘겼습니다",
    },
  ];
}

/** ⑤ 측정 실패율 — 최근 1시간에 끝난 작업(완료+실패) 중 실패 비율. */
export function evaluateJobFailureRate(
  jobs: { completed: number; failed: number },
  t: OpsThresholds
): OpsAlert[] {
  const total = jobs.completed + jobs.failed;
  if (total < t.jobFailMinJobs || total <= 0) {
    return [];
  }
  const rate = jobs.failed / total;
  if (rate <= t.jobFailRate) {
    return [];
  }
  return [
    {
      context: {
        failed: jobs.failed,
        rate: round3(rate),
        threshold: t.jobFailRate,
        total,
        windowMinutes: 60,
      },
      kind: "job_failure_rate",
      message: "측정 실패율이 기준을 넘었습니다(최근 1시간)",
    },
  ];
}

/** ⑥ 원가 — 무료 진단 하루 건수가 상한의 기준 비율에 도달. */
export function evaluateFreeCost(
  usage: { count: number; cap: number },
  t: OpsThresholds
): OpsAlert[] {
  if (usage.cap <= 0) {
    return [];
  }
  const ratio = usage.count / usage.cap;
  if (ratio < t.costRatio) {
    return [];
  }
  return [
    {
      context: {
        cap: usage.cap,
        count: usage.count,
        ratio: round3(ratio),
        threshold: t.costRatio,
        windowHours: 24,
      },
      kind: "free_cost_budget",
      message: "무료 진단 하루 건수가 일일 예산 상한에 가까워졌습니다",
    },
  ];
}
