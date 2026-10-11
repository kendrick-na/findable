/**
 * 기본 질문 세트 버전 표식 — 저장 질문이 없을 때 러너가 쓰는 기본 질문에
 * 이름 없는 추천형이 들어간 세트(2026-10-12). 결과의
 * `measurementContext.defaultQuestionSet` 로 남고, 비교 키(`search-sampling-version.ts`)가 읽는다.
 */
export const DEFAULT_QUESTION_SET_V2 = "default-v2" as const;
