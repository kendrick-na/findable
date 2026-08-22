// `server-only` 마커 패키지의 테스트용 대체 모듈 (2026-08-08).
//
// 실물 `server-only/index.js` 는 최상단에서 throw 한다 — Next.js 는 서버 번들에서 `react-server`
// exports 조건으로 빈 모듈(`empty.js`)을 받지만, vitest 는 그 조건을 붙이지 않아 throw 를 맞는다.
// 조건을 전역으로 켜면 React 가 깨지므로(RSC 런타임이 선택됨) 이 마커만 여기로 매핑한다.
// → `vitest.config.mts` 의 `resolve.alias["server-only"]`.
export {};
