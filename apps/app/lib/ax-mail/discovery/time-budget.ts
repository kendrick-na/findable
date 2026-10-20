/**
 * 시간 예산 — 서버 액션 시간 제한(120초) 안에서 끝내려고 남은 시간을 센다.
 * 임시 로컬 구현(Codex 컨트롤타워2 계약 모양). 공용 `@repo/observability/time-budget` 받으면 import 로 바꾼다.
 */

export interface TimeBudget {
  readonly deadline: number;
  expired(): boolean;
  remainingMs(): number;
}

export function createTimeBudget(
  totalMs: number,
  opts: { reserveMs?: number; now?: () => number } = {}
): TimeBudget {
  const now = opts.now ?? (() => Date.now());
  const reserve = opts.reserveMs ?? 0;
  const deadline = now() + totalMs - reserve;
  return {
    deadline,
    expired: () => now() >= deadline,
    remainingMs: () => Math.max(0, deadline - now()),
  };
}

export async function runWithinBudget<T, R>(
  items: readonly T[],
  budget: TimeBudget,
  worker: (item: T, index: number) => Promise<R>,
  opts: { startIndex?: number; perItemEstimateMs?: number } = {}
): Promise<{
  results: R[];
  processed: number;
  nextIndex: number | null;
  stoppedBy: "complete" | "budget";
}> {
  const start = opts.startIndex ?? 0;
  const estimate = opts.perItemEstimateMs ?? 0;
  const results: R[] = [];
  let index = start;
  for (; index < items.length; index += 1) {
    // 다음 한 건을 끝낼 시간이 없으면 여기서 멈춘다(함수가 죽지 않게).
    if (budget.remainingMs() <= estimate) {
      return {
        nextIndex: index,
        processed: index - start,
        results,
        stoppedBy: "budget",
      };
    }
    results.push(await worker(items[index] as T, index));
  }
  return {
    nextIndex: null,
    processed: index - start,
    results,
    stoppedBy: "complete",
  };
}
