// U5 — 가짜 시계 헬퍼 (vi.useFakeTimers 위).
//
// U1(재시도·서킷브레이커)·U2(입장 관리)·U3(중단 복구)의 시간 규칙을 실제로 기다리지 않고 시험한다.
// 아래 PLANNED_* 값은 **U1~U3 설계안의 계획값**이지 현재 코드에서 읽은 값이 아니다.
// 단위가 합쳐지면 실제 상수 import 로 바꾸고(값이 다르면 시나리오 단언도 같이 갱신) 이 표는 지운다.

import { vi } from "vitest";

/** [확인필요] U1 설계안: 429/5xx 재시도 간격 2초 → 8초(칸당 호출 ≤ 3 = 최초 1 + 재시도 2). */
export const PLANNED_RETRY_BACKOFF_MS = [2000, 8000] as const;
/** [확인필요] U1 설계안: 서킷브레이커 쿨다운 120초. */
export const PLANNED_BREAKER_COOLDOWN_MS = 120_000;
/** 이미 코드에 있는 값: 엔진 1회 호출 상한(ENGINE_CALL_TIMEOUT_MS). */
export const ENGINE_CALL_CAP_MS = 60_000;

export interface FakeClock {
  /** 시계를 ms 만큼 앞으로. 그 사이 예약된 타이머·마이크로태스크가 모두 돈다. */
  advance: (ms: number) => Promise<void>;
  /** 쿨다운(120초)을 지나간다. */
  advanceThroughCooldown: () => Promise<void>;
  /** 재시도 간격 전부(2초 + 8초)를 지나간다. */
  advanceThroughRetryBackoff: () => Promise<void>;
  /** 지금 가짜 시각(ms). */
  now: () => number;
  /** 원래 시계로 복귀. afterEach 에서 호출. */
  restore: () => void;
  /**
   * promise 가 끝날 때까지 stepMs 씩 시계를 밀고 결과를 돌려준다.
   * maxMs 안에 안 끝나면 오류 — 「무한 대기」 회귀를 테스트 멈춤이 아니라 실패로 드러낸다.
   */
  settle: <T>(
    promise: Promise<T>,
    options?: { maxMs?: number; stepMs?: number }
  ) => Promise<T>;
}

export function installFakeClock(
  startAt: Date | number = new Date("2026-10-18T09:00:00+09:00")
): FakeClock {
  vi.useFakeTimers();
  vi.setSystemTime(startAt);

  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
  };

  return {
    advance,
    advanceThroughRetryBackoff: async () => {
      for (const ms of PLANNED_RETRY_BACKOFF_MS) {
        await advance(ms);
      }
    },
    advanceThroughCooldown: async () => {
      await advance(PLANNED_BREAKER_COOLDOWN_MS);
    },
    now: () => Date.now(),
    restore: () => {
      vi.useRealTimers();
    },
    settle: async (promise, options = {}) => {
      const stepMs = options.stepMs ?? 1000;
      const maxMs = options.maxMs ?? 10 * 60_000;
      const state: {
        done: boolean;
        error?: unknown;
        failed: boolean;
        value?: unknown;
      } = { done: false, failed: false };
      promise.then(
        (value) => {
          state.done = true;
          state.value = value;
        },
        (error) => {
          state.done = true;
          state.failed = true;
          state.error = error;
        }
      );
      let elapsed = 0;
      while (!state.done && elapsed < maxMs) {
        await advance(stepMs);
        elapsed += stepMs;
      }
      if (!state.done) {
        throw new Error(
          `가짜 시계 ${maxMs}ms 안에 끝나지 않음(무한 대기 의심)`
        );
      }
      if (state.failed) {
        throw state.error;
      }
      return state.value as never;
    },
  };
}
