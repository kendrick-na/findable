import { regionFromText } from "../discovery/taxonomy";
import { type DiscoveredCompany, emptyDiscovered } from "../discovery/types";
import { csvRecords, hasColumns, pick } from "./csv";
import { normalizeBizNo } from "./http";

/**
 * 이노비즈(기술혁신형)·메인비즈(경영혁신형) 인증기업 — 중소벤처기업부 파일데이터 (2026-10-07 확인)
 *
 *  ① 기술혁신형 중소기업 생산품 목록 — https://www.data.go.kr/data/15134641/fileData.do
 *     CSV(CP949) 23,478행 · 연간 · 이용허락범위 제한 없음
 *     열: 연번, 지역, 업체명, 대표자, 사업자번호, 주생산품, 확인서유효기간시작일, 확인서유효기간종료일, **홈페이지**
 *  ② 혁신형중소기업 현황 — https://www.data.go.kr/data/3033893/fileData.do
 *     ZIP 1개 안에 CSV(CP949) 2개 · 연간 · 이용허락범위 제한 없음
 *     - 기술혁신형: 연번, 업체명, 대표자, 사업자번호, 관련업종(기계금속/전기전자/서비스 …), 지역, 확인서유효기간종료일
 *     - 경영혁신형: 번호, 사업자명, 사업자등록번호, 대표자명, 업종(제조업/도소매업 …), 지역, 인증만료일
 *  세 파일 모두 **사업자번호가 있다** → 적재 시 exact 매칭. ZIP 해제는 opendart.ts 의 unzipFirstEntry 와 같은 방식(수동 다운로드 단계에서 풀어도 됨).
 *  자동변환 오픈API(odcloud)는 데이터셋별 활용신청 필요(2026-10-07 미신청 → -401).
 */

export type InnoMainbizFile =
  | "innobiz_products"
  | "innobiz_status"
  | "mainbiz_status";

/** 헤더로 파일 종류 판별. 모르는 파일이면 null. */
export function detectInnoMainbizFile(text: string): InnoMainbizFile | null {
  if (hasColumns(text, ["업체명", "사업자번호", "주생산품", "홈페이지"])) {
    return "innobiz_products";
  }
  if (hasColumns(text, ["업체명", "사업자번호", "관련업종"])) {
    return "innobiz_status";
  }
  if (hasColumns(text, ["사업자명", "사업자등록번호", "업종", "인증만료일"])) {
    return "mainbiz_status";
  }
  return null;
}

export function parseInnoMainbizCsv(
  text: string,
  options: { asOf?: string | null } = {}
): DiscoveredCompany[] {
  const kind = detectInnoMainbizFile(text);
  if (!kind) {
    return [];
  }
  const out: DiscoveredCompany[] = [];
  for (const record of csvRecords(text)) {
    const name = pick(record, "업체명", "사업자명");
    if (!name) {
      continue;
    }
    const source = kind === "mainbiz_status" ? "mainbiz" : "innobiz";
    const company = emptyDiscovered(source, name);
    company.asOf = options.asOf ?? null;
    company.businessNumber = normalizeBizNo(
      pick(record, "사업자번호", "사업자등록번호")
    );
    company.region = regionFromText(pick(record, "지역"));
    company.tags = [source];
    if (kind === "innobiz_products") {
      company.products = pick(record, "주생산품");
      company.homepage = pick(record, "홈페이지");
      company.extra = {
        validFrom: pick(record, "확인서유효기간시작일"),
        validUntil: pick(record, "확인서유효기간종료일"),
      };
    } else if (kind === "innobiz_status") {
      company.industryName = pick(record, "관련업종");
      company.extra = { validUntil: pick(record, "확인서유효기간종료일") };
    } else {
      company.industryName = pick(record, "업종");
      company.extra = { validUntil: pick(record, "인증만료일") };
    }
    out.push(company);
  }
  return out;
}
