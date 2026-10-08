import { regionFromText } from "../discovery/taxonomy";
import { type DiscoveredCompany, emptyDiscovered } from "../discovery/types";
import { csvRecords, pick } from "./csv";
import { normalizeCorpName } from "./http";

/**
 * 중소벤처기업부_벤처기업명단 (파일데이터, 벤처확인종합관리시스템 원천)
 * 문서: https://www.data.go.kr/data/15084581/fileData.do (2026-10-07 확인)
 *  - 형식: CSV(UTF-8 BOM) 약 9.5MB · 39,668행(20260521판) · 업데이트 연간(차기 2027-05-21)
 *  - 이용허락범위: **공공저작물 출처표시(제1유형)** → 화면·리포트에 「출처: 중소벤처기업부 벤처기업명단」 표기 필요
 *  - 열: 연번, 업체명, 대표자명(익명), 벤처확인유형(벤처투자/연구개발/혁신성장/예비벤처), 지역, 주소(시·구),
 *        업종분류(기보), 업종명(11차), 주생산품, 벤처유효시작일, 벤처유효종료일, 벤처확인기관, 신규_재확인
 *  - ⚠️ **사업자번호가 없다** → 이름+지역으로만 묶인다(적재 시 name_only). 다른 원천(이노비즈·국민연금)과 붙일 때 동명 주의.
 *  - ⚠️ 업종명(11차)은 KSIC 11차 「이름」이고 코드는 없다 → 이름 규칙으로 분류.
 *  - 자동변환 오픈API(api.odcloud.kr/api/15084581/v1/…)도 있으나 **데이터셋별 활용신청**이 필요하다
 *    (2026-10-07 실측: 현재 키로 -401). 파일 다운로드는 로그인 없이 가능 → 연 1회 수동/크론 다운로드 후 이 파서로 적재.
 */

/** 벤처투자유형 = VC 등 적격 투자기관 투자를 근거로 확인받은 회사 → vc_invested 태그 */
const VC_TYPE = "벤처투자유형";

export interface VentureParseOptions {
  /** 데이터셋 기준일(파일명/페이지의 날짜, 예: 2026-05-21) */
  asOf?: string | null;
}

export function parseVentureListCsv(
  text: string,
  options: VentureParseOptions = {}
): DiscoveredCompany[] {
  const out: DiscoveredCompany[] = [];
  for (const record of csvRecords(text)) {
    const name = pick(record, "업체명");
    if (!(name && normalizeCorpName(name))) {
      continue;
    }
    const ventureType = pick(record, "벤처확인유형");
    const regionText = pick(record, "지역");
    const address = pick(record, "주소");
    const company = emptyDiscovered("venture", name);
    company.address = address;
    company.asOf = options.asOf ?? null;
    company.industryName =
      pick(record, "업종명(11차)") ?? pick(record, "업종분류(기보)");
    company.products = pick(record, "주생산품");
    company.region = regionFromText(regionText) ?? regionFromText(address);
    company.tags =
      ventureType === VC_TYPE ? ["venture", "vc_invested"] : ["venture"];
    company.extra = {
      broadIndustry: pick(record, "업종분류(기보)"),
      newOrRenewal: pick(record, "신규_재확인"),
      validFrom: pick(record, "벤처유효시작일"),
      validUntil: pick(record, "벤처유효종료일"),
      ventureType,
    };
    out.push(company);
  }
  return out;
}
