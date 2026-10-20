/**
 * 시간 예산 — 요청 하나(서버 액션·라우트·크론) 안에서 도는 긴 작업이 플랫폼 제한
 * (`maxDuration`)에 걸려 **아무것도 남기지 못하고 죽는 것**을 막는다.
 *
 * 2026-10-20 사고: 영업 회사 찾기 「데이터 불러오기」가 약 180곳을 한 곳씩 먼 DB에 쓰다가
 * 120초에 강제 종료됐다. 규칙(CLAUDE.md §2-1): 긴 루프는 예산을 받아, 다 쓰면 멈추고
 * 「어디까지 했는지」를 돌려준다(부분 성공 + 이어하기).
 */

export interface TimeBudget {
  readonly deadline: number;
  expired(): boolean;
  remainingMs(): number;
}

export function createTimeBudget(
  totalMs: number,
  opts: { now?: () => number; reserveMs?: number } = {}
): TimeBudget {
  const now = opts.now ?? Date.now;
  const reserve = opts.reserveMs ?? 0;
  if (!(totalMs > reserve)) {
    throw new Error("time budget must exceed its reserve");
  }
  const deadline = now() + totalMs - reserve;
  return {
    deadline,
    remainingMs: () => Math.max(0, deadline - now()),
    expired: () => now() >= deadline,
  };
}

export interface BudgetRun<R> {
  /** 다음에 이어서 시작할 위치. 전부 끝났으면 null */
  nextIndex: number | null;
  processed: number;
  results: R[];
  stoppedBy: "complete" | "budget";
}

/**
 * 항목을 순서대로 처리하되, 다음 항목이 예산 안에 끝나지 못할 것 같으면 시작하지 않는다.
 * 1건 비용은 `perItemEstimateMs`가 없으면 지금까지의 평균으로 추정한다(첫 건은 그냥 실행).
 * worker 오류는 숨기지 않고 그대로 던진다 — 이미 처리한 건은 worker가 저장했어야 한다.
 */
export async function runWithinBudget<T, R>(
  items: readonly T[],
  budget: TimeBudget,
  worker: (item: T, index: number) => Promise<R>,
  opts: {
    now?: () => number;
    perItemEstimateMs?: number;
    startIndex?: number;
  } = {}
): Promise<BudgetRun<R>> {
  const now = opts.now ?? (() => budget.deadline - budget.remainingMs());
  const results: R[] = [];
  const start = opts.startIndex ?? 0;
  let spent = 0;
  for (let i = start; i < items.length; i++) {
    const done = results.length;
    const estimate =
      opts.perItemEstimateMs ?? (done > 0 ? spent / done : undefined);
    if (estimate !== undefined && budget.remainingMs() < estimate) {
      return { results, processed: done, nextIndex: i, stoppedBy: "budget" };
    }
    if (budget.expired()) {
      return { results, processed: done, nextIndex: i, stoppedBy: "budget" };
    }
    const began = now();
    results.push(await worker(items[i] as T, i));
    spent += now() - began;
  }
  return {
    results,
    processed: results.length,
    nextIndex: null,
    stoppedBy: "complete",
  };
}
