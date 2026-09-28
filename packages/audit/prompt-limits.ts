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
