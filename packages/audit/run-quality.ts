/**
 * 저장된 `AuditJob.result` 를 읽어 **점수**와 **비교에 쓸 만한가**를 판정한다.
 * (2026-08-08 세션N-11 — `apps/web/app/api/audit/[jobId]/route.ts` 에서 승격)
 *
 * 왜 패키지로 올렸나: 이 판정은 원래 폴링 라우트 안의 사설 함수였는데,
 *   주간 재측정 알림 cron(투두 #68)이 **같은 판정**을 필요로 한다.
 *   복사하면 두 벌이 되어 화면과 메일이 서로 다른 점수를 말할 수 있다
 *   (계산은 한 곳, 표시층만 분리 — 프로젝트 불변식).
 *
 * ⚠️ `history.ts` 에 합치지 않은 이유: 그 파일은 **의존성 0의 순수 모듈**이다.
 *   여기는 `geo-score` 를 import 하므로 분리해 둔다.
 */

import { type GeoScoreMetrics, geoAxisScores } from "./geo-score";

/** 러너가 `result.metrics` 에 저장하는 형태(실패·stub 집계 포함). */
export type StoredMetrics = GeoScoreMetrics & {
  errors?: Array<{ engineId: string; message: string }>;
  stubCount?: number;
};

export function metricsOf(result: unknown): StoredMetrics | null {
  return (result as { metrics?: StoredMetrics } | null)?.metrics ?? null;
}

/** `result` JSON 에서 GEO 총점. metrics 가 없으면 null — **지어내지 않는다**. */
export function scoreOf(result: unknown): number | null {
  const metrics = metricsOf(result);
  return metrics ? geoAxisScores(metrics).total : null;
}

/**
 * 이 측정을 **비교 기준으로 쓸 수 있나**.
 *
 * 🔴 `status=completed` 만으로는 부족하다 — 실측(2026-07-29 `nike.com`)에 28개 엔진이
 *   **전부 error** 인데 completed 인 job 이 있었다(점수 0). 그걸 직전으로 잡으면
 *   다음 측정이 *"+80점 개선"* 이라는 거짓말이 된다.
 *   → **성공 응답이 하나라도 있어야** 비교 대상으로 인정한다.
 *
 * ⚠️ 알림에서 특히 중요하다: 고장난 회차를 기준으로 "점수가 급락했습니다" 메일을 보내면
 *   사실이 아닌 경보가 된다(신뢰 손상이 미발송보다 크다).
 */
export function isUsableRun(result: unknown): boolean {
  const metrics = metricsOf(result);
  if (!metrics) {
    return false;
  }
  const total = metrics.enginesCovered?.length ?? 0;
  const failed = (metrics.errors?.length ?? 0) + (metrics.stubCount ?? 0);
  return total > 0 && failed < total;
}
