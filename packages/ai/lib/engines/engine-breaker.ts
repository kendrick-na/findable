/**
 * 회차 내 서킷브레이커(2026-10-18 · 안정성 U1, 플래그 STABILITY_ENGINE_BREAKER_ENABLED).
 *
 * 한 프로세스 안에서 같은 엔진이 `breakerFailThreshold` 번 **연속 최종 실패**하면
 * `breakerCooldownMs` 동안 그 엔진을 부르지 않고 즉시 오류로 돌려준다(그 칸은 기존대로 오류 → 분모 제외).
 * 쿨다운이 지나면 **1회 시험 호출**(반열림) — 성공하면 닫히고, 실패하면 다시 격리한다.
 *
 * 규칙
 *  - 상태는 모듈 메모리(프로세스 단위). 공유 저장소 없음 → 서버리스 인스턴스끼리는 서로 모른다(의도).
 *  - 못 잰 것을 미노출로 세지 않는다: 격리된 칸은 `errorMessage` 가 있는 오류 칸이다.
 *  - 타임아웃·중단(abort)은 「실패」로도 「성공」으로도 세지 않는다(느린 것과 죽은 것은 다르다).
 */
import { stabilityLimits } from "../stability-flags";

interface BreakerState {
  consecutiveFailures: number;
  openedAt: number | null;
  probing: boolean;
}

const states = new Map<string, BreakerState>();

const PAUSED_MESSAGE_RE = /^Engine \S+ paused: consecutive failures$/;

export const enginePausedMessage = (engineId: string): string =>
  `Engine ${engineId} paused: consecutive failures`;

/** 이 오류 문구가 「서킷브레이커로 격리된 엔진」인가(engine-error-log 가 분류에 쓴다). */
export function isEnginePausedMessage(
  message: string | null | undefined
): boolean {
  return typeof message === "string" && PAUSED_MESSAGE_RE.test(message);
}

export type BreakerGate = "pass" | "probe" | "blocked";

/** 호출 직전에 부른다. `blocked` 면 호출하지 않는다. `probe` 면 이 호출이 반열림 시험 1회다. */
export function acquireEngineBreaker(
  engineId: string,
  now: number = Date.now(),
  limits: { breakerCooldownMs: number } = stabilityLimits()
): BreakerGate {
  const state = states.get(engineId);
  if (!state || state.openedAt === null) {
    return "pass";
  }
  if (now - state.openedAt < limits.breakerCooldownMs || state.probing) {
    return "blocked";
  }
  state.probing = true;
  return "probe";
}

/** 최종 결과를 기록한다(재시도가 끝난 뒤 한 번). */
export function recordEngineOutcome(
  engineId: string,
  outcome: "success" | "failure",
  now: number = Date.now(),
  limits: { breakerFailThreshold: number } = stabilityLimits()
): void {
  if (outcome === "success") {
    states.delete(engineId);
    return;
  }
  const state = states.get(engineId) ?? {
    consecutiveFailures: 0,
    openedAt: null,
    probing: false,
  };
  states.set(engineId, state);
  if (state.probing) {
    // 반열림 시험 호출이 실패 → 다시 격리.
    state.probing = false;
    state.openedAt = now;
    return;
  }
  if (state.openedAt !== null) {
    return; // 이미 격리 중 — 격리 직전에 출발했던 호출의 늦은 실패는 쿨다운을 늘리지 않는다.
  }
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= limits.breakerFailThreshold) {
    state.openedAt = now;
  }
}

/** 시험 호출이 결과 없이 끝났을 때(중단·타임아웃) 시험 자리를 돌려준다. */
export function releaseEngineProbe(engineId: string): void {
  const state = states.get(engineId);
  if (state) {
    state.probing = false;
  }
}

/** 테스트 전용 — 모든 상태를 지운다. */
export function resetEngineBreakers(): void {
  states.clear();
}
