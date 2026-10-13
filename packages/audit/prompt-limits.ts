/**
 * 러너 프롬프트 상한 — 순수 상수 모듈(2026-09-29 분리).
 *
 * runner.ts 는 DB·AI 클라이언트를 끌어와 테스트·화면에서 가볍게 import 할 수 없어
 * 상수만 여기로 뺐다. runner.ts 는 기존 import 경로 호환을 위해 다시 내보낸다.
 */

/**
 * 한 번 실행에 던지는 질문 수의 **합계** 상한(엔진 ≤7 × 질문 = 호출 수 → 원가·429 보호).
 * 브랜드 이름 질문 + 이름 없는 질문(discovery)을 합쳐 이 수를 넘지 않는다.
 */
export const RUNNER_PROMPT_LIMIT = 8;

/** 한 회차에 넣는 이름 없는 질문 상한 — 브랜드 질문 자리를 지킨다. */
export const MAX_DISCOVERY_PROMPTS = 2;

/**
 * 저장 프롬프트가 한 회차에 최소 몇 개 측정되는가. 이름 없는 질문이 자리를 가져가면
 * 저장 프롬프트는 이만큼까지 줄어든다 — `/prompts` 화면이 이 값으로 안내한다.
 */
export const SAVED_PROMPTS_MIN_PER_RUN =
  RUNNER_PROMPT_LIMIT - MAX_DISCOVERY_PROMPTS;

/**
 * 영업 경로(관리자 측정)의 한 회차 질문 상한(2026-10-14 · 대표 결정 2026-10-07 「20문항 1회」).
 * 대시보드·고객 측정은 그대로 `RUNNER_PROMPT_LIMIT`(8)이다 — 호출 옵션 `promptLimit` 으로만 늘린다.
 */
export const SALES_PROMPT_LIMIT = 20;

/** 호출 옵션 `promptLimit` 의 절대 상한 — 잘못된 값이 원가를 키우지 못하게 한다. */
export const MAX_PROMPT_LIMIT_OPTION = 20;

/** 호출 옵션을 실제 상한으로. 없거나 이상하면 기본(8), 너무 크면 20으로 자른다. */
export function effectivePromptLimit(option: number | undefined): number {
  if (option === undefined || !Number.isFinite(option)) {
    return RUNNER_PROMPT_LIMIT;
  }
  return Math.min(MAX_PROMPT_LIMIT_OPTION, Math.max(1, Math.floor(option)));
}
