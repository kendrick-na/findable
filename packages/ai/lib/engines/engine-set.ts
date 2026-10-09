// 메인(점수) 엔진 세트 스위치 — 소비자 화면 정렬 api-search-v1 (2026-10-10 · 3단계)
//
//   FINDABLE_ENGINE_SET=api-search-v1  → chatgpt·gemini·claude 본 답이 api-search-v1 후보 경로로 바뀐다.
//   미설정(기본)·다른 값                → 기존 운영 동작 100% 그대로.
//
// 🔴 이 파일은 의존성이 없어야 한다(클라이언트 컴포넌트가 import 하는 engine-labels 도 읽는다).
//   서버 전용 변수 FINDABLE_ENGINE_SET 은 브라우저 번들에 없으므로, 화면 문구용으로
//   같은 값을 NEXT_PUBLIC_FINDABLE_ENGINE_SET 에도 넣으면 클라이언트도 같은 갈래를 탄다(비밀 아님).
//   ⚠️ 정적 `process.env.NEXT_PUBLIC_*` 표기여야 Next 가 인라인한다 — 동적 접근으로 바꾸지 말 것.

/** 세트 식별자. 행 `usage.engineSet` 과 비교키 꼬리표(`api:search-v1`)의 원천. */
export const API_SEARCH_ENGINE_SET = "api-search-v1";

/** 지금 프로세스가 읽는 원시 플래그 값(서버 변수 우선, 없으면 공개 변수). */
export function readEngineSetFlag(): string | undefined {
  return (
    process.env.FINDABLE_ENGINE_SET?.trim() ||
    process.env.NEXT_PUBLIC_FINDABLE_ENGINE_SET?.trim() ||
    undefined
  );
}

/** api-search-v1 메인 엔진 세트가 켜져 있는가. 기본 false. */
export function isApiSearchEngineSetActive(
  raw: string | undefined = readEngineSetFlag()
): boolean {
  return raw?.trim().toLowerCase() === API_SEARCH_ENGINE_SET;
}
