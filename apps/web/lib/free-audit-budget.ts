// 무료 진단 일일 예산 — 건수 × 평균단가 환산(스키마 변경 없이 전역 상한을 건다).
//   쓰는 곳: apps/web/app/api/audit/route.ts (isDailyBudgetExhausted · cache hit savedKrw)

/**
 * 무료 진단 1건의 **원가모델 v2 기준** 평균 원가(KRW) — 2026-10-07 재보정.
 *
 * ## 왜 바꿨나
 * 예전 값 250원은 v1(2026-07, 엔진·질문 수가 적던 시기·웹검색 없음) 실측이었다.
 * 그 값으로 5만원 ÷ 250 = **하루 200건**을 받았는데, 지금 실제 1건 원가는 그 3배 이상이라
 * 상한이 예산을 지키지 못했다.
 *
 * ## 산식 (프로덕션 읽기 전용 조회 · 최근 14일 완료 측정 156건 · 2026-10-07)
 * 무료 진단은 로그인 측정과 **같은 러너**(`runAuditJob`, 질문 상한 RUNNER_PROMPT_LIMIT=8)를
 * 탄다 → 같은 원가 분포를 쓴다. (무료 측정은 14일간 0건이라 직접 표본이 없다.)
 *
 *   ① 기록된 원가(v1 규칙) 평균               620.6원 (p50 603.6 · p90 847.9)
 *   ② chatgpt output 단가 보정 $10→$15         평균 out 1,053 tok × $5/1M × 1,380 × 4.49호출/건
 *                                              = +32.6원
 *   ③ claude 웹검색료 누락분 $10/1,000회        2회/호출(가정·관제탑 추정) × $0.01 × 1,380 × 4.49호출/건
 *                                              = +123.9원
 *   → v2 환산 평균 ≈ **777원** (p90 ≈ 1,004원)
 *
 *   ④ 아직 원가에 안 잡히는 호출 — 언급 판정기·브랜드/업종/경쟁사 추론(haiku)·
 *      네이버 브리핑 Firecrawl 1크레딧(플래그 on 시) — 를 감안해 **1,000원으로 올림**(보수).
 *
 * → 기본 예산 5만원이면 **하루 50건**. 더 받으려면 FINDABLE_DAILY_FREE_BUDGET_KRW 를 올린다.
 * ⚠️ ③의 「호출당 검색 2회」는 실측이 아니다(저장 응답에 검색 횟수 필드가 아직 없음) — [확인필요].
 *    원가모델 v2 배포 후 `usage.webSearchRequests` 가 쌓이면 이 값을 실측 평균으로 다시 잰다.
 */
export const FREE_AUDIT_AVG_COST_KRW = 1000;

export const DEFAULT_DAILY_FREE_BUDGET_KRW = 50_000;

/** 일일 예산(KRW) → 하루 무료 진단 건수 상한. 최소 1건. */
export function dailyFreeJobCap(
  budgetKrw: number,
  avgCostKrw: number = FREE_AUDIT_AVG_COST_KRW
): number {
  if (!(Number.isFinite(budgetKrw) && budgetKrw > 0)) {
    return 1;
  }
  return Math.max(1, Math.floor(budgetKrw / avgCostKrw));
}
