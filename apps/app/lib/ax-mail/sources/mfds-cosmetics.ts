import "server-only";

import { dataGoKrItems, fetchJson, normalizeBizNo, str, ymd } from "./http";

/**
 * 식품의약품안전처_화장품 관련 정보 — 화장품 제조(판매)업 정보조회
 * 문서: https://www.data.go.kr/data/15020628/openapi.do (페이지 내장 swagger 로 필드 확인, 2026-10-06)
 * 이용허락범위: 제한 없음
 *
 * GET https://apis.data.go.kr/1471000/CsmtcsMfcrtrInfoService02/getCsmtcsMfcrtrInfoList02
 *   serviceKey, pageNo, numOfRows, type=json, entp_name(업체명), entp_permit_date(허가일자), bizrno(사업자등록번호)
 * 응답 item: INDUTY(업종), ENTP_SEQ(업체번호), ENTP_NAME(업체명), ENTP_PERMIT_DATE(허가일자),
 *   FACTORY_ADDR(본사주소 — 시·구까지만), BIZRNO(사업자등록번호)
 *
 * ⚠️ 문서상 별도 「책임판매업」 오퍼레이션은 없다. 이 한 오퍼레이션이 제조·책임판매를 함께 주고
 *   INDUTY 값으로 구분한다 — 실측 값: "화장품제조", "화장품책임판매".
 * ⚠️ 응답 껍데기가 { header, body: { items: [...] } } 로 금융위·국민연금과 다르다(실측).
 * ⚠️ 업종 필터 파라미터가 없어 책임판매만 서버에서 거를 수 없다 → 받아온 페이지에서 거른다.
 */

const ENDPOINT =
  "https://apis.data.go.kr/1471000/CsmtcsMfcrtrInfoService02/getCsmtcsMfcrtrInfoList02";

export const MFDS_RESPONSIBLE_SELLER = "화장품책임판매";
export const MFDS_MANUFACTURER = "화장품제조";

export interface MfdsCosmeticsBusiness {
  bizNo: string | null;
  /** 업체번호 */
  entpSeq: string | null;
  /** 원문 업종 (화장품책임판매 / 화장품제조) */
  kind: string | null;
  name: string;
  permittedOn: string | null;
  /** 시·구 수준 주소 */
  region: string | null;
}

export interface MfdsPage {
  items: MfdsCosmeticsBusiness[];
  totalCount: number | null;
}

export function parseMfdsList(body: unknown): MfdsPage | null {
  const { resultCode, totalCount, items } = dataGoKrItems(body);
  if (resultCode !== "00") {
    return null;
  }
  const parsed: MfdsCosmeticsBusiness[] = [];
  for (const item of items) {
    const name = str(item.ENTP_NAME);
    if (!name) {
      continue;
    }
    parsed.push({
      bizNo: normalizeBizNo(str(item.BIZRNO)),
      entpSeq: str(item.ENTP_SEQ),
      kind: str(item.INDUTY),
      name,
      permittedOn: ymd(item.ENTP_PERMIT_DATE),
      region: str(item.FACTORY_ADDR),
    });
  }
  return { items: parsed, totalCount };
}

/**
 * 세그먼트 발굴용 — 한 페이지 조회. kind 로 책임판매/제조 거르기.
 * 키 없음·HTTP 오류 → null.
 */
export async function fetchMfdsCosmetics(
  query: {
    businessNumber?: string | null;
    kind?: typeof MFDS_RESPONSIBLE_SELLER | typeof MFDS_MANUFACTURER | null;
    name?: string | null;
    numOfRows?: number;
    pageNo?: number;
    permitDate?: string | null;
  } = {},
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<MfdsPage | null> {
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!key) {
    return null;
  }
  const params = new URLSearchParams({
    serviceKey: key,
    type: "json",
    pageNo: String(query.pageNo ?? 1),
    numOfRows: String(Math.min(query.numOfRows ?? 100, 100)),
  });
  if (query.name) {
    params.set("entp_name", query.name);
  }
  const bizNo = normalizeBizNo(query.businessNumber);
  if (bizNo) {
    params.set("bizrno", bizNo);
  }
  if (query.permitDate) {
    params.set("entp_permit_date", query.permitDate);
  }
  const outcome = await fetchJson(
    "mfds-cosmetics",
    `${ENDPOINT}?${params}`,
    { signal: options.signal },
    options.timeoutMs
  );
  if (!outcome.ok) {
    return null;
  }
  const page = parseMfdsList(outcome.body);
  if (!(page && query.kind)) {
    return page;
  }
  return {
    ...page,
    items: page.items.filter((item) => item.kind === query.kind),
  };
}
