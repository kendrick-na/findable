/**
 * 개인정보 마스킹 — 화면·로그 공용 (2026-08-08 세션N-11 승격).
 *
 * 왜 패키지로 올렸나: 원래 `apps/web/app/api/audit/[jobId]/route.ts` 안의 사설 함수였다.
 *   같은 규율이 **로그에도** 필요해졌는데(리드 API 가 이메일을 평문으로 남기고 있었다),
 *   복사하면 두 벌이 되어 한쪽만 고쳐지는 상태가 된다.
 *
 * ⚠️ 순수 함수 — 의존성 0.
 */

const MASK_VISIBLE_CHARS = 2;

/**
 * 이메일 마스킹 — `na***@gmail.com`. 로컬파트가 2자 이하면 첫 1자만 남긴다.
 *
 * 용도 두 가지:
 *   1. **화면** — jobId 링크가 공유돼도 주소 전체가 노출되지 않게.
 *   2. **로그** — 로그는 장기 보관·외부 수집기로 흘러가므로 평문 주소를 남기지 않는다.
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!(local && domain)) {
    return "***";
  }
  const visible = local.slice(
    0,
    local.length > MASK_VISIBLE_CHARS ? MASK_VISIBLE_CHARS : 1
  );
  return `${visible}***@${domain}`;
}
