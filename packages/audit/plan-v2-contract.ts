// 질문 계획 v2 계약 상수 — 순수 모듈(2026-10-07, A1)
//
// checkpoint 검증·추세 비교 가드·그림자 실행이 같은 값을 쓴다. DB·네트워크 import 금지
// (checkpoint.ts·search-sampling-version.ts 가 가볍게 import 한다).

export const QUESTION_PLAN_V2 = 2 as const;

/** A 카테고리 구매 · B 고민·사용법 · C 대표 상품 · D 비교·대안 · E 브랜드 이해(이름 넣음). */
export type PlanV2Type = "A" | "B" | "C" | "D" | "E";

export interface PlanV2Provenance {
  competitor?: string;
  /** true = 검색량 키워드에 그 유형이 없어 같은 핵심어를 다른 유형 틀로 넓힌 질문. */
  expanded: boolean;
  keyword: string | null;
  leftover?: string[];
  offering?: string;
  source:
    | "naver"
    | "google"
    | "catalog"
    | "site"
    | "competitor"
    | "registration";
  volume: number | null;
}

/** 실행 프롬프트(RunPrompt.planV2)에 붙는 그림자 질문 표시. 있으면 점수·Tracking 에서 빠진다. */
export interface PlanV2PromptMeta {
  engineSetKey: PlanV2EngineSetKey;
  market: "KR" | "US";
  provenance: PlanV2Provenance;
  type: PlanV2Type;
}

/**
 * 엔진 구성 키(대표 결정 2026-10-07 · 안 ④): 매일 회차는 Claude 제외, 주 1회 회차는 Claude 포함.
 * 결과(measurementContext.engineSetKey)에 남기고, 추세 비교 가드가 이 값이 다른 회차를 섞지 않는다.
 */
export const ENGINE_SET_DAILY_NOCLAUDE = "daily-noclaude-v1";
export const ENGINE_SET_WEEKLY_FULL = "weekly-full-v1";
export type PlanV2EngineSetKey =
  | typeof ENGINE_SET_DAILY_NOCLAUDE
  | typeof ENGINE_SET_WEEKLY_FULL;
export const PLAN_V2_ENGINE_SETS: readonly PlanV2EngineSetKey[] = [
  ENGINE_SET_DAILY_NOCLAUDE,
  ENGINE_SET_WEEKLY_FULL,
];
/** daily 세트에서 빼는 엔진(원가의 약 86% — 설계안 §5-1). */
const DAILY_EXCLUDED_ENGINES = new Set(["claude"]);

/** 엔진 구성 키에 맞게 질문 하나의 엔진 목록을 줄인다(순서 유지). 키가 없으면 그대로. */
export function enginesForEngineSet(
  engines: readonly string[],
  engineSetKey: string | null | undefined
): string[] {
  return engineSetKey === ENGINE_SET_DAILY_NOCLAUDE
    ? engines.filter((id) => !DAILY_EXCLUDED_ENGINES.has(id))
    : [...engines];
}

/** 그림자 회차의 이어가기 절대 상한(비용·cron 점유 보호). */
export const SHADOW_MAX_CONTINUATIONS = 8;

/** checkpoint 에 저장하는 그림자 기록 중 검증에 필요한 부분. */
export interface ShadowPlanCheckpointShape {
  engineSetKey: PlanV2EngineSetKey;
  maxContinuations: number;
  questionCount: number;
  questionPlanVersion: typeof QUESTION_PLAN_V2;
  startIndex: number;
}

/** checkpoint JSON 의 그림자 기록 검증(재개 전 — 모르는 모양이면 실패). */
export function isValidShadowCheckpoint(
  value: unknown,
  promptCount: number,
  baseContinuationLimit: number
): value is ShadowPlanCheckpointShape {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    v.questionPlanVersion === QUESTION_PLAN_V2 &&
    PLAN_V2_ENGINE_SETS.includes(v.engineSetKey as PlanV2EngineSetKey) &&
    Number.isInteger(v.startIndex) &&
    (v.startIndex as number) >= 1 &&
    Number.isInteger(v.questionCount) &&
    (v.questionCount as number) >= 1 &&
    (v.startIndex as number) + (v.questionCount as number) === promptCount &&
    Number.isInteger(v.maxContinuations) &&
    (v.maxContinuations as number) >= baseContinuationLimit &&
    (v.maxContinuations as number) <= SHADOW_MAX_CONTINUATIONS
  );
}
