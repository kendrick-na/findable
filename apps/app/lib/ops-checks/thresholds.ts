/**
 * 운영자 알림 임계값(2026-10-18, 안정성 U4) — 전부 **환경값**이고, 아래 기본값은 **발명한 시작점**이다.
 *
 * ⚠️ 근거 없는 숫자다(공급자 실제 한도·평소 실패율을 아직 모른다). 일부러 **느슨하게** 잡았다 —
 *    처음엔 진짜 큰 이상만 울리고, 운영에서 평소 수치를 본 뒤 환경값으로 조인다(코드는 안 고친다).
 * 환경값 이름은 고정이다.
 */

export interface OpsThresholds {
  /** ⑥ 무료 일일 건수 ÷ 상한 ≥ 이 값이면 알림(80% 도달). */
  costRatio: number;
  /** ① 엔진별 실패 비율(회복된 칸 제외)이 이 값을 **넘으면** 알림. */
  engineFailRate: number;
  /** ① 표본이 이보다 적은 엔진은 비율을 판정하지 않는다(몇 칸으로 호들갑 방지). */
  engineMinCells: number;
  /** ① 엔진별 429 비율이 이 값을 **넘으면** 알림. */
  engineRateLimitRate: number;
  /** ⑤ 표본(끝난 작업 수)이 이보다 적으면 판정하지 않는다. */
  jobFailMinJobs: number;
  /** ⑤ 최근 1시간 측정 실패율이 이 값을 **넘으면** 알림. */
  jobFailRate: number;
  /** ③ 시작 안 된 queued 가 이 분을 **넘기면** 알림. */
  queueWaitMinutes: number;
  /** ② 쿼터 오류로 끝난 작업이 최근부터 연속 이 건수 **이상**이면 알림. */
  quotaStreak: number;
}

const num = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(parsed)
    ? parsed
    : fallback;
};

export function opsThresholds(
  env: Record<string, string | undefined> = process.env
): OpsThresholds {
  return {
    // 발명한 시작점들 — 위 주석 참고.
    costRatio: num(env.STABILITY_ALERT_COST_RATIO, 0.8),
    engineFailRate: num(env.STABILITY_ALERT_ENGINE_FAIL_RATE, 0.4),
    engineMinCells: num(env.STABILITY_ALERT_ENGINE_MIN_CELLS, 20),
    engineRateLimitRate: num(env.STABILITY_ALERT_ENGINE_429_RATE, 0.2),
    jobFailMinJobs: num(env.STABILITY_ALERT_JOB_FAIL_MIN_JOBS, 5),
    jobFailRate: num(env.STABILITY_ALERT_JOB_FAIL_RATE, 0.3),
    queueWaitMinutes: num(env.STABILITY_ALERT_QUEUE_WAIT_MINUTES, 10),
    quotaStreak: num(env.STABILITY_ALERT_QUOTA_STREAK, 3),
  };
}
