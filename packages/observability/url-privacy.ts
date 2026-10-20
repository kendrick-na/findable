/**
 * 외부 분석·오류 도구로 나가는 주소에서 「링크만 알면 열리는 비밀 값」을 지운다.
 * (Sentry·PostHog·GA가 같은 규칙을 쓰도록 한 곳에 둔다.)
 *
 * - /r/<토큰>            -> /r/[token]
 * - /audit/<jobId>       -> /audit/[jobId]   (언어 접두사 /ko/audit/<id> 포함)
 * - /api/audit/<jobId>/… -> /api/audit/[jobId]/…
 * - 쿼리 문자열          -> 전부 제거 (뉴스레터 확인·해지 토큰 포함)
 * - #해시                -> 제거
 */

const REPORT_PATH = /(^|\/)r\/[^/?#]+/;
const AUDIT_PATH = /(^|\/)audit\/[^/?#]+/;
const NEWSLETTER_TOKEN_PATH = /\/api\/newsletter\/(confirm|unsubscribe)/;
const REPORT_ROOT = /^\/r(\/|$)/;
const QUERY_OR_HASH = /[?#]/;

const PATH_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|\/)r\/[^/?#]+/g, "$1r/[token]"],
  [/(^|\/)audit\/(?!\[jobId\])[^/?#]+/g, "$1audit/[jobId]"],
];

/** 경로 부분만 치환한다(쿼리·해시는 호출한 쪽이 이미 떼어낸 상태). */
export const redactPath = (path: string): string => {
  let result = path;
  for (const [pattern, replacement] of PATH_RULES) {
    result = result.replace(pattern, replacement);
  }
  return result;
};

/**
 * 주소 문자열(절대·상대 모두)에서 비밀 경로와 쿼리·해시를 지운다.
 * 해석할 수 없는 값도 안전하게 처리한다(쿼리 제거 + 경로 치환만 수행).
 */
export const redactUrl = (value: string): string => {
  const cut = value.search(QUERY_OR_HASH);
  const base = cut === -1 ? value : value.slice(0, cut);
  return redactPath(base);
};

/** 값이 문자열일 때만 치환하고, 아니면 그대로 돌려준다. */
export const redactUrlValue = <T>(value: T): T =>
  (typeof value === "string" ? redactUrl(value) : value) as T;

/** 비밀 경로를 담은 페이지인지(분석 도구를 아예 켜지 않을 대상). */
export const isSensitivePath = (pathname: string): boolean =>
  REPORT_PATH.test(pathname) ||
  AUDIT_PATH.test(pathname) ||
  NEWSLETTER_TOKEN_PATH.test(pathname);

/** 비밀 경로 중 「토큰 경로(/r/…)」만 판정 — 분석 초기화를 건너뛸 대상. */
export const isReportTokenPath = (pathname: string): boolean =>
  REPORT_ROOT.test(pathname);
