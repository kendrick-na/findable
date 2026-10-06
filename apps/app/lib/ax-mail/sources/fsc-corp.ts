import "server-only";

import {
  dataGoKrItems,
  fetchJson,
  normalizeBizNo,
  normalizeCorpName,
  num,
  str,
  ymd,
} from "./http";

/**
 * 금융위원회_기업기본정보 — 기업개요조회(getCorpOutline_V2)
 * 문서: https://www.data.go.kr/data/15043184/openapi.do (페이지 내장 swagger 로 필드 확인, 2026-10-06)
 * 이용허락범위: 제한 없음
 *
 * GET https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2
 *   ServiceKey, pageNo, numOfRows, resultType=json, crno(법인등록번호) | corpNm(법인명)
 * 사용 필드: corpNm, crno, bzno, enpRprFnm(대표자), enpEstbDt(설립일), enpEmpeCnt(종업원수),
 *   enpBsadr/enpDtadr(주소), enpHmpgUrl, sicNm(업종), enpMainBizNm, smenpYn(중소기업),
 *   corpRegMrktDcdNm(상장시장), fstOpegDt/lastOpegDt(해당 행이 유효한 기간)
 *
 * ⚠️ 실측: 같은 회사가 **기간별로 여러 행**(대표자 변경 이력 등)으로 온다 → lastOpegDt 가 가장 최근인 행을 쓴다.
 */

const ENDPOINT =
  "https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2";

export interface FscCorpOutline {
  address: string | null;
  /** 이 행이 유효한 마지막 날(YYYY-MM-DD) — 데이터 기준일로 표시 */
  asOf: string | null;
  bizNo: string | null;
  /** 법인등록번호 13자리 */
  corpRegNo: string | null;
  employeeCount: number | null;
  foundedOn: string | null;
  homepage: string | null;
  industry: string | null;
  isSme: boolean | null;
  listedMarket: string | null;
  mainBusiness: string | null;
  name: string;
  representative: string | null;
}

export function parseFscRow(
  item: Record<string, unknown>
): FscCorpOutline | null {
  const name = str(item.corpNm);
  if (!name) {
    return null;
  }
  const base = str(item.enpBsadr);
  const detail = str(item.enpDtadr);
  const sme = str(item.smenpYn);
  return {
    address: base ? [base, detail].filter(Boolean).join(" ") : null,
    bizNo: normalizeBizNo(str(item.bzno)),
    corpRegNo: str(item.crno),
    employeeCount: num(item.enpEmpeCnt),
    asOf: ymd(item.lastOpegDt),
    foundedOn: ymd(item.enpEstbDt),
    homepage: str(item.enpHmpgUrl),
    industry: str(item.sicNm),
    isSme: sme === null ? null : sme === "Y",
    listedMarket: str(item.corpRegMrktDcdNm),
    mainBusiness: str(item.enpMainBizNm),
    name,
    representative: str(item.enpRprFnm),
  };
}

/**
 * 순수 파서 — 응답 → 후보 회사들(법인등록번호 단위로 최신 행 1개씩).
 * 사업자번호가 주어지면 그 번호와 일치하는 후보만 남긴다.
 */
export function parseFscOutline(
  body: unknown,
  bizNo: string | null = null
): FscCorpOutline[] {
  const { resultCode, items } = dataGoKrItems(body);
  if (resultCode !== "00") {
    return [];
  }
  const latest = new Map<string, FscCorpOutline>();
  for (const item of items) {
    const row = parseFscRow(item);
    if (!row) {
      continue;
    }
    if (bizNo && row.bizNo !== bizNo) {
      continue;
    }
    const key = row.corpRegNo ?? row.name;
    const prev = latest.get(key);
    if (!prev || (row.asOf ?? "") > (prev.asOf ?? "")) {
      // 최신 행에 빈 칸이 있으면 이전 행 값으로 메우지 않는다 — 「언제 값인지」가 섞이기 때문.
      latest.set(key, row);
    }
  }
  return [...latest.values()];
}

/** 법인명으로 조회 → 후보 목록. 키 없음 → null, HTTP 오류 → null. */
export async function fetchFscCorp(
  query: { name: string; businessNumber?: string | null },
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<FscCorpOutline[] | null> {
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  const corpNm = normalizeCorpName(query.name) ? query.name.trim() : "";
  if (!(key && corpNm)) {
    return null;
  }
  // 「(주)」가 붙은 행과 안 붙은 행이 섞여 있어(실측) 법인 표기를 뗀 이름으로 검색한다.
  const searchName =
    corpNm.replaceAll(/\(주\)|㈜|주식회사/g, "").trim() || corpNm;
  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: "1",
    numOfRows: "50",
    resultType: "json",
    corpNm: searchName,
  });
  const outcome = await fetchJson(
    "fsc-corp",
    `${ENDPOINT}?${params}`,
    { signal: options.signal },
    options.timeoutMs
  );
  if (!outcome.ok) {
    return null;
  }
  return parseFscOutline(outcome.body, normalizeBizNo(query.businessNumber));
}
