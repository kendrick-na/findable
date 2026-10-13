import { SHADOW_MAX_CONTINUATIONS } from "./plan-v2-contract";

/**
 * 이어가기 상한을 **질문 수**로 계산한다(2026-10-14 · 20문항 한 회차 측정).
 *
 * 한 번의 함수 실행(270초)은 질문 5~6개쯤 끝낸다(질문당 약 40초 가정 · 새 질문은 남은 시간 35초 이상일 때만
 * 시작). 질문이 많은 회차는 「실행 1번 + 이어가기 여러 번」이 필요해서, 고정 상한 2로는 20문항이 끝나지 못한다.
 * 계산식은 그림자 회차가 쓰던 것(`shadow-plan-v2`)을 그대로 모은 것이다.
 */
export const SECONDS_PER_QUESTION = 40;
export const SECONDS_PER_INVOCATION = 240;

/** 이어가기 절대 상한(원가·cron 점유 보호). 그림자 회차와 같은 값. */
export const ABSOLUTE_MAX_CONTINUATIONS = SHADOW_MAX_CONTINUATIONS;

/** ⌈질문 수 × 40초 ÷ 240초⌉ + 1(여유 1회). */
export function requiredContinuations(questionCount: number): number {
  const q = Math.max(0, Math.floor(questionCount));
  return Math.ceil((q * SECONDS_PER_QUESTION) / SECONDS_PER_INVOCATION) + 1;
}

/** 이어가기 상한 — 기본 상한(`baseLimit`) 이상, 절대 상한(8) 이하. */
export function plannedContinuationLimit(
  totalQuestions: number,
  baseLimit: number
): number {
  return Math.min(
    ABSOLUTE_MAX_CONTINUATIONS,
    Math.max(baseLimit, requiredContinuations(totalQuestions))
  );
}
