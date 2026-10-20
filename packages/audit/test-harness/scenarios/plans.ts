// T1~T5 시나리오의 「준비」를 코드로 고정한 값들. 시나리오 문서(*.scenario.md)와 1:1 이다.
// 값을 바꾸면 해당 .scenario.md 도 같이 고친다.
//
// 표기: [확인필요] = U1~U4 가 합쳐져 실제 상수가 정해지면 확정. 지금은 설계안의 계획값.

import type { FaultPlan } from "@repo/ai/lib/engines/test-harness/fault-engine";

/** 모든 시나리오 공통 — 같은 시드, 같은 결과. */
export const SCENARIO_SEED = 20_261_018;

// ── T1 동시 폭주 ─────────────────────────────────────────────
export const T1 = {
  /** 고객 A 는 20개 질문, B·C 는 1개씩. 같은 순간에 시작한다. */
  customers: [
    { owner: "A", jobs: 20, kind: "customer" },
    { owner: "B", jobs: 1, kind: "customer" },
    { owner: "C", jobs: 1, kind: "customer" },
    { owner: "internal", jobs: 2, kind: "internal" },
    { owner: "free", jobs: 3, kind: "free" },
  ],
  /** DB 연결 풀 크기 가정(1~2). */
  poolSizes: [1, 2],
  /** [확인필요] U2 의 동시 실행 상한. */
  plannedMaxConcurrent: undefined as number | undefined,
  /** 이미 코드에 있는 30분 규칙: 대기 중 job 이 30분 넘게 지나면 실패 처리된다(stale-job.ts). */
  staleAfterMs: 30 * 60_000,
} as const;

// ── T2 엔진 1개 100% 5xx + 다른 엔진 20% 429 ──────────────────
export const T2_QUESTIONS = 20;
export const T2_PLAN: FaultPlan = {
  // SCENARIO_SEED 는 gemini 호출 24번 안에 429 가 한 번도 안 나온다(시드 스캔 실측) → 시드 3(7·8·9·13·16번째가 429).
  seed: 3,
  rules: [
    { engine: "claude", fault: { type: "http5xx", status: 503 } },
    {
      engine: "gemini",
      probability: 0.2,
      fault: { type: "http429", retryAfterSec: 5 },
    },
  ],
};
/** U1 합격선: 칸당 호출 ≤ 2(최초 1 + 재시도 1 = stabilityLimits().cellMaxRetries 기본값). 초안의 3 은 낡았다. */
export const MAX_CALLS_PER_CELL = 2;

// ── T3 빈 응답 20% ──────────────────────────────────────────
export const T3_QUESTIONS = 20;
export const T3_PLAN: FaultPlan = {
  seed: SCENARIO_SEED,
  rules: [
    { engine: "chatgpt", probability: 0.2, fault: { type: "empty" } },
    { engine: "perplexity", probability: 0.2, fault: { type: "empty" } },
  ],
};

// ── T4 중단 시뮬 ────────────────────────────────────────────
export const T4 = {
  questions: 12,
  /** 이 개수만큼 저장된 직후 lease 가 만료된다. */
  interruptAfterSavedQuestions: 7,
} as const;

// ── T5 롤백 호환 ────────────────────────────────────────────
export const T5 = {
  /** 새 코드가 checkpoint 에 더할 수 있는 필드 예(이름은 U1~U3 가 정한 뒤 교체). [확인필요] */
  addedTopLevelFields: ["engineHealth", "admission"] as const,
  addedRowFields: ["retryInfo"] as const,
} as const;
