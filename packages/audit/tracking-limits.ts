/**
 * 측정 결과 저장(Tracking)의 크기 제한(2026-10-14 · 영업 20문항 한 회차).
 *
 * 한 회차의 저장 행 수 = 이름 질문 수 × 엔진 수(이름 없는 질문은 저장하지 않는다). 20문항 × 6엔진 = 120행이라
 * 예전 상한 100을 넘으면 저장이 통째로 실패했다(`manifest_too_large`).
 *
 *  · 매니페스트(회차가 쓴 행 키의 전체 목록)는 한 덩어리로 남긴다 — 복구 증명(SQL)이 그 목록 전체를 검사한다.
 *    증명이 감당하는 상한을 100 → 300 으로 올린다(50문항 × 6엔진까지). 같은 상수를 저장 코드와 복구 SQL 이 공유한다.
 *  · 행 삽입은 `TRACKING_INSERT_CHUNK` 개씩 나눠 넣는다(한 문장이 너무 커지지 않게). 모두 **같은 트랜잭션**이라
 *    중간에 실패하면 전부 되돌려지고(부분 적재 없음), 복구 크론이 같은 행 키로 다시 쓴다(멱등).
 */
export const TRACKING_MANIFEST_MAX_KEYS = 300;
export const TRACKING_INSERT_CHUNK = 100;

/** 배열을 `size` 개씩 나눈다. */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
