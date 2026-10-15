/**
 * 「내 브랜드 정보」 ↔ 사이트 비교(G1 4단계, 2026-10-16) — 순수 함수. 사이트를 읽는 일은 호출부가 한다.
 * 새 점수·임계값을 만들지 않는다: 항목마다 같음/다름/사이트에서 못 찾음/입력 안 함, 네 가지 사실만 돌려준다.
 */
export type CompareStatus = "match" | "differs" | "notFound" | "notEntered";

export interface CompareItem {
  /** 고객이 입력한 값(없으면 null). */
  mine: string | null;
  /** 사이트에서 읽은 값(못 찾으면 null). */
  site: string | null;
  status: CompareStatus;
}

export interface CompareResult {
  businessNumber: CompareItem;
  legalName: CompareItem;
}

const COMPANY_FORM_RE =
  /\(주\)|㈜|주식회사|\(유\)|유한회사|inc\.?|co\.,?\s*ltd\.?|corp\.?/gi;
const NON_WORD_RE = /[\s().,·\-_]/g;
const DIGITS_RE = /\D/g;

/** 상호 비교용 정규화 — 법인 형태 표기·공백·구두점·대소문자 차이는 같은 상호로 본다. */
export const normalizeNameForCompare = (value: string): string =>
  value.replace(COMPANY_FORM_RE, "").replace(NON_WORD_RE, "").toLowerCase();

const item = (
  mine: string | null | undefined,
  site: string | null | undefined,
  same: (a: string, b: string) => boolean
): CompareItem => {
  const m = mine?.trim() ? mine.trim() : null;
  const s = site?.trim() ? site.trim() : null;
  if (!m) {
    return { mine: null, site: s, status: "notEntered" };
  }
  if (!s) {
    return { mine: m, site: null, status: "notFound" };
  }
  return { mine: m, site: s, status: same(m, s) ? "match" : "differs" };
};

export function compareWithSite(
  mine: { businessNumber: string | null; legalName: string | null },
  site: { businessNumber?: string | null; legalName?: string | null } | null
): CompareResult {
  return {
    businessNumber: item(
      mine.businessNumber,
      site?.businessNumber,
      (a, b) => a.replace(DIGITS_RE, "") === b.replace(DIGITS_RE, "")
    ),
    legalName: item(
      mine.legalName,
      site?.legalName,
      (a, b) => normalizeNameForCompare(a) === normalizeNameForCompare(b)
    ),
  };
}
