/**
 * `/.well-known/*` — 기계가 읽는 표준 경로(도메인 인증·OAuth 메타데이터 등).
 *
 * 🔴 왜 따로 판정하나: 이 경로가 i18n 미들웨어를 타면 `/ko/.well-known/...` 로 리다이렉트돼 404 가 된다.
 *   ChatGPT 플러그인 디렉터리의 도메인 인증(`/.well-known/openai-apps-challenge`)과
 *   OAuth 보호 리소스 메타데이터가 **리다이렉트 없이 200** 이어야 한다.
 *   `proxy.ts` 가 `/api/*` 와 같은 방식으로 i18n·Arcjet 합성 전에 반환한다.
 */
export function isWellKnownPath(pathname: string): boolean {
  return pathname === "/.well-known" || pathname.startsWith("/.well-known/");
}
