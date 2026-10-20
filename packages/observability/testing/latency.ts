/**
 * 테스트 전용 — 가짜 DB·API에 **실제 왕복 시간만큼 지연**을 넣고 호출 수를 센다.
 *
 * 지연 0인 가짜 store로는 「1건마다 DB를 여러 번 오가는 루프(N+1)」가 늘 통과한다.
 * 2026-10-20 사고(180곳 × 약 6회 × 먼 DB → 120초 초과)를 배포 전에 잡기 위한 도구.
 * 사용: 대량 작업 테스트에서 `withLatency(store, 측정한_왕복_ms)`로 감싸고
 *       총 소요가 maxDuration의 60% 미만인지, 1건당 호출 수 상한을 함께 검사한다.
 */

export interface LatencyProbe<T> {
  calls(): number;
  callsByMethod(): Record<string, number>;
  proxy: T;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function withLatency<T extends object>(
  target: T,
  ms: number,
  opts: { sleep?: (ms: number) => Promise<void> } = {}
): LatencyProbe<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const counts: Record<string, number> = {};
  const proxy = new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      const name = String(prop);
      return async (...args: unknown[]) => {
        counts[name] = (counts[name] ?? 0) + 1;
        await sleep(ms);
        return value.apply(obj, args);
      };
    },
  });
  return {
    proxy,
    calls: () => Object.values(counts).reduce((a, b) => a + b, 0),
    callsByMethod: () => ({ ...counts }),
  };
}
