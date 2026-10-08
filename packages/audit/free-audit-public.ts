/**
 * 공개 무료 진단(www `/[locale]/audit` 폼 + `POST /api/audit`)을 외부에 열지 여부.
 *
 * 👤 CEO 결정(2026-10-07): 무료 진단은 **외부에서 보이는 모든 곳에서 숨긴다.**
 *   단 코드는 지우지 않는다 — 나중에 이 env 하나로 다시 켤 수 있어야 한다.
 *
 * - env 이름: `FREE_AUDIT_PUBLIC_ENABLED`
 * - 기본값: **꺼짐**(미설정·빈 값·그 밖의 값 = 숨김). 켜려면 `true`·`1`·`on`·`yes`.
 * - 서버 전용이다. `NEXT_PUBLIC_` 접두사를 붙이지 않는다 — 클라이언트에는
 *   서버 컴포넌트가 읽은 결과(boolean)만 prop 으로 내려준다.
 *
 * ⚠️ 정적·ISR 페이지(홈·요금제 등)는 빌드/재검증 시점에 읽는다.
 *   Vercel 에서 값을 바꾼 뒤에는 **재배포**해야 모든 화면에 반영된다.
 *
 * 🔒 이 값은 「공개 진입」만 막는다. 로그인 앱의 측정(start-tracking)·admin 단건 측정·
 *   cron·기존 결과 페이지(`/audit/<jobId>`)는 영향을 받지 않는다.
 */
export const FREE_AUDIT_PUBLIC_ENV = "FREE_AUDIT_PUBLIC_ENABLED";

const ENABLED_VALUES = new Set(["true", "1", "on", "yes"]);

export function isFreeAuditPublicEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env[FREE_AUDIT_PUBLIC_ENV];
  return raw ? ENABLED_VALUES.has(raw.trim().toLowerCase()) : false;
}
