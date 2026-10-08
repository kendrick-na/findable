/**
 * 발굴(세그먼트) 공통 타입 — 공공 목록 소스 1행 → DiscoveredCompany 1개.
 *
 * 원칙(2026-10-07):
 *  - 원천이 준 값만 담는다. 모르면 null(추정해서 채우지 않음).
 *  - 대표자 **이름은 담지 않는다** — 개인정보이고, 보관 여부는 대표 결정 대기(설계안 §5-2).
 *  - 사업자번호가 없는 원천(벤처기업명단)은 이름+지역으로만 묶인다 → 적재 시 matchConfidence=name_only.
 */

export const DISCOVERY_SOURCES = [
  "venture",
  "innobiz",
  "mainbiz",
  "ftc_mail_order",
  "nps",
  "fsc",
  "opendart",
  "mfds",
  "nts",
  "input",
] as const;

export type DiscoverySourceId = (typeof DISCOVERY_SOURCES)[number];

/** 원천별 부가 사실(인증 유효기간·판매방식·가입자 추이 등). 값은 원문 그대로. */
export type DiscoveryExtra = Record<string, string | number | boolean | null>;

export interface DiscoveredCompany {
  /** 시·군·구까지의 주소(원천 표기 그대로) */
  address: string | null;
  /** 원천 기준일(YYYY-MM-DD / YYYY-MM) — 모르면 null */
  asOf: string | null;
  /** 국민연금처럼 앞 6자리만 공개되는 경우 */
  bizNoPrefix: string | null;
  /** 숫자 10자리 */
  businessNumber: string | null;
  corpRegNo: string | null;
  dartCorpCode: string | null;
  employees: number | null;
  extra: DiscoveryExtra;
  /** YYYY-MM-DD */
  foundedOn: string | null;
  /** 원천이 준 홈페이지/쇼핑몰 주소 원문 */
  homepage: string | null;
  /** KSIC 코드(원천이 KSIC 를 줄 때만 — 국민연금 업종코드는 KSIC 가 아니라 넣지 않는다) */
  industryCode: string | null;
  /** 원천 업종명 */
  industryName: string | null;
  name: string;
  /** 주생산품 / 취급품목 */
  products: string | null;
  /** 시·도 약칭(서울·경기 …) */
  region: string | null;
  source: DiscoverySourceId;
  /** 원천 행 식별자 */
  sourceRef: string | null;
  /** 원천에서 바로 알 수 있는 태그(venture · innobiz · listed …) */
  tags: string[];
}

/** 페이지 단위 결과 — API 소스 공통 */
export interface DiscoveryPage {
  items: DiscoveredCompany[];
  pageNo: number;
  totalCount: number | null;
}

export function emptyDiscovered(
  source: DiscoverySourceId,
  name: string
): DiscoveredCompany {
  return {
    address: null,
    asOf: null,
    bizNoPrefix: null,
    businessNumber: null,
    corpRegNo: null,
    dartCorpCode: null,
    employees: null,
    extra: {},
    foundedOn: null,
    homepage: null,
    industryCode: null,
    industryName: null,
    name,
    products: null,
    region: null,
    source,
    sourceRef: null,
    tags: [],
  };
}
