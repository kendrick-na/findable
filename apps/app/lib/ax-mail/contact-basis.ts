/**
 * 수신 근거(contact basis) — 「이 회사에 메일을 먼저 보내도 되는 근거」.
 *
 * KISA 불법스팸 방지 안내서 기준(대표 지시 2026-10-06): 회사에 처음 보내는 영업 메일은
 * 아래 셋 중 하나가 아니면 광고성 정보로 본다.
 *  ① business_card     — 명함을 직접 받았다(받은 날짜·장소 기록)
 *  ② requested         — 상대가 정보를 요청했다(요청 방법·날짜 기록)
 *  ③ existing_customer — 거래한 지 6개월 이내 기존 고객(거래 날짜 기록)
 *     ⚠️ ③은 「동의 없이 보내도 되는」 예외일 뿐 광고성 정보다 → 제목 앞 「(광고)」 표기 유지.
 *  ④ public_contact    — 회사가 홈페이지에 문의·제휴용으로 공개한 회사 메일(공개된 페이지 주소·확인 날짜 기록)
 *     2026-10-07 대표가 KISA(118) 전화로 「공개 회사 메일 수집·협업 제안 발송 문제 없음」 확인(구두, 서면 회신 없음).
 *     수신거부 안내·보낸 사람 표기는 그대로 둔다.
 *
 * 리드 스냅샷(200KB)을 끌어오지 않도록 별도 파일로 둔다 — 클라이언트 작성기도 이 파일만 import.
 */

export const CONTACT_BASIS_KINDS = [
  "business_card",
  "requested",
  "existing_customer",
  "public_contact",
] as const;

export type ContactBasisKind = (typeof CONTACT_BASIS_KINDS)[number];

export interface ContactBasis {
  /** YYYY-MM-DD — 명함 받은 날 / 요청 받은 날 / 마지막 거래일 / 공개 메일 확인일 */
  date: string;
  /** 장소·요청 방법·거래 내용·공개된 페이지 주소 등 근거 설명 */
  detail: string;
  kind: ContactBasisKind;
}

/** 기존 고객 예외가 유효한 기간(거래 후 개월 수). */
export const EXISTING_CUSTOMER_MONTHS = 6;

export type ContactBasisProblem = "missing" | "expired";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const AD_LABEL = "(광고)";
const AD_PREFIX_RE = /^\(광고\)\s*/;

/** 한국 시간 기준 오늘 날짜(YYYY-MM-DD). */
export function seoulToday(now: Date): string {
  return now.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function validIsoDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);
  if (!match) {
    return false;
  }
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** YYYY-MM-DD 에 개월 수를 더한다(말일 넘침은 그 달 말일로 맞춘다). */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * 근거가 없거나(종류·설명·날짜 중 하나라도 비었거나 미래 날짜) 기존 고객 6개월이 지났으면 문제를 돌려준다.
 * null = 초안을 만들어도 되는 근거가 있다.
 */
export function contactBasisProblem(
  basis: ContactBasis | null | undefined,
  now: Date
): ContactBasisProblem | null {
  if (
    !(
      basis &&
      CONTACT_BASIS_KINDS.includes(basis.kind) &&
      basis.detail.trim() &&
      validIsoDate(basis.date)
    )
  ) {
    return "missing";
  }
  const today = seoulToday(now);
  if (basis.date > today) {
    return "missing";
  }
  if (
    basis.kind === "existing_customer" &&
    addMonths(basis.date, EXISTING_CUSTOMER_MONTHS) < today
  ) {
    return "expired";
  }
  return null;
}

/** 기존 고객(③)은 광고성 정보 — 제목 앞에 「(광고)」를 붙이고, 다른 근거면 뗀다. */
export function subjectForBasis(
  subject: string,
  kind: ContactBasisKind | null | undefined
): string {
  const bare = subject.replace(AD_PREFIX_RE, "");
  return kind === "existing_customer" ? `${AD_LABEL} ${bare}` : bare;
}

export function hasAdLabel(subject: string): boolean {
  return subject.trim().startsWith(AD_LABEL);
}
