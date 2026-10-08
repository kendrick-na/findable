/**
 * 고객이 직접 넣는 공식 회사 정보(상호·사업자등록번호) 정규화 — 2026-10-06.
 *
 * 측정 판정이 "AI 답변이 정말 이 회사를 말하는가"를 가릴 때 쓰는 공식 근거다.
 * 홈페이지가 짧은 슬로건뿐이면(예: 토스) 판정 근거가 없어 정답 답변까지 점수에서
 * 빠졌다(운영 실측: 토스 24개 중 11~12개). 고객이 상호를 알려 주면 그 구멍이 막힌다.
 *
 * ⚠️ 순수 함수만 둔다 — 서버액션·화면이 같은 규칙을 쓴다(두 벌이 되면 갈린다).
 */

const DIGITS_RE = /\D/g;
const MIN_LEGAL_NAME = 2;
const MAX_LEGAL_NAME = 60;

export type OfficialIdentityField<T> =
  | { ok: true; value: T }
  | { ok: false; error: "legal_name_length" | "business_number_format" };

/** 빈 값은 "지우기"(null). 그 외에는 2~60자. */
export function normalizeLegalName(
  raw: string
): OfficialIdentityField<string | null> {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length === 0) {
    return { ok: true, value: null };
  }
  if (value.length < MIN_LEGAL_NAME || value.length > MAX_LEGAL_NAME) {
    return { ok: false, error: "legal_name_length" };
  }
  return { ok: true, value };
}

/** 빈 값은 "지우기"(null). 숫자 10자리만 받아 "000-00-00000" 으로 맞춘다. */
export function normalizeBusinessNumber(
  raw: string
): OfficialIdentityField<string | null> {
  const digits = raw.replace(DIGITS_RE, "");
  if (raw.trim().length === 0) {
    return { ok: true, value: null };
  }
  if (digits.length !== 10) {
    return { ok: false, error: "business_number_format" };
  }
  return {
    ok: true,
    value: `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`,
  };
}
