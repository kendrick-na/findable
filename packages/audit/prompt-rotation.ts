/**
 * 러너가 실행마다 어떤 저장된 프롬프트 8개를 쓸지 고르는 순수 함수.
 * DB 의존이 없어 `runner.ts`(DB 접속 필수)와 분리해 단위 테스트한다.
 *
 * 🔴 2026-08-22 — 예전엔 `createdAt asc` 고정이라 **가장 먼저 저장한 8개만 영원히
 *   측정**되고 9번째부터는 요금제가 150개까지 저장을 허용해도 러너가 절대 보지 않았다
 *   (growth 유료 고객이 돈 내고 저장한 질문이 죽어있던 것과 같은 결함).
 *   → 이번 실행마다 "가장 오래(또는 한 번도) 측정 안 된 것"부터 골라, 여러 번
 *   실행되면 결국 전체가 돌아가며 측정된다(라운드로빈).
 */
export function pickRotatingPrompts<
  T extends { id: string; lastTrackedAt: Date | null },
>(prompts: T[], limit: number): T[] {
  const sorted = [...prompts].sort((a, b) => {
    const aTime = a.lastTrackedAt?.getTime() ?? 0;
    const bTime = b.lastTrackedAt?.getTime() ?? 0;
    // 한 번도 안 잰 것(0)이 가장 오래 잰 것보다 먼저 오도록 오름차순.
    return aTime - bTime;
  });
  return sorted.slice(0, limit);
}
