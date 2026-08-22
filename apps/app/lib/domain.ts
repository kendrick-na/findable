/**
 * 도메인 정규화·검증 — 순수 함수 단일 진실 (2026-08-10 세션N-13).
 *
 * 🔴 **왜 별도 파일인가**: 원래 `app/actions/brand/start-tracking.ts` 안에 있었는데,
 *   그 파일은 `"use server"` 라 **async 함수만 export 할 수 있다**.
 *   동기 헬퍼를 export 하면 **`tsc` 와 lint 는 통과하고 빌드에서만 터진다**
 *   (`Server Actions must be async functions`). 실제로 이번에 겪었다.
 *   → 여러 서버 액션이 공유하는 순수 함수는 `"use server"` 밖에 둔다.
 *
 * ⚠️ **복제 금지**: 이 규칙이 갈라지면 한쪽만 막는 값이 생기고,
 *   같은 브랜드가 `Brand` 두 건으로 갈라진다(아래 실측 참조).
 */

const PROTOCOL_RE = /^https?:\/\//;
const PATH_RE = /\/.*$/;
const WWW_RE = /^www\./;
// 도메인 형식(간이): 라벨.라벨 최소 1개 점, 프로토콜/경로 없이 호스트만.
const DOMAIN_RE =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

/**
 * 사용자 입력 도메인을 호스트만 남기고 정규화.
 *
 * ⚠️ `AuditJob.domain` 은 **정규화가 보장되지 않는다**(실측 2026-08-10: 29종 중 3종이
 *   `www.` 또는 경로 포함 — 특히 `sulwhasoo.com` 과 `www.sulwhasoo.com` 이 **둘 다 존재**).
 *   그 값을 그대로 Brand 도출에 쓰면 **같은 브랜드가 두 건으로 갈라지고 완료 기록도 갈라진다.**
 */
export const normalizeDomain = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(PROTOCOL_RE, "")
    .replace(PATH_RE, "")
    .replace(WWW_RE, "");

/**
 * 정규화된 도메인이 호스트 형식인가.
 *
 * ⚠️ `normalizeDomain` 을 **먼저 통과시킨 값**을 넣을 것
 *   (이 정규식은 `www.`·경로·프로토콜을 허용하지 않는다).
 */
export const isValidDomain = (normalized: string): boolean =>
  DOMAIN_RE.test(normalized);
