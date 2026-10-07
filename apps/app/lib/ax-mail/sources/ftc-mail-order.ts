import "server-only";

import { regionFromText } from "../discovery/taxonomy";
import {
  type DiscoveredCompany,
  type DiscoveryPage,
  emptyDiscovered,
} from "../discovery/types";
import { csvRecords, pick } from "./csv";
import {
  asRecord,
  dataGoKrItems,
  fetchJson,
  normalizeBizNo,
  num,
  str,
  ymd,
} from "./http";

/**
 * 공정거래위원회 통신판매사업자 — 커머스(온라인 판매) 회사 발굴의 주 원천. (2026-10-07 확인)
 *
 * ① 오픈API(활용신청 필요, 이용허락범위 제한 없음, 실시간)
 *   - 등록현황 https://www.data.go.kr/data/15126311/openapi.do
 *       GET https://apis.data.go.kr/1130000/MllBs_2Service/getMllBsInfo_2
 *       serviceKey, pageNo, numOfRows, resultType=json, ctpvNm(시도명), dclrInstNm(신고기관 "서울특별시 강동구"),
 *       operSttusCdNm(운영상태 "정상영업"), bzmnNm(상호), brno(사업자번호), fromYmd/toYmd(신고일자 YYYYMMDD), prmmiMnno
 *       → item: prmmiMnno(통신판매번호), bzmnNm, brno, crno, ctpvNm, dclrInstNm, operSttusCdNm, lctnAddr, rnAddr, dclrDate …
 *       ⭐ 지역·신고일자·상태로 **목록 조회(bulk)** 가 된다 → 「이번 달 새로 신고한 서울 쇼핑몰」 같은 세그먼트.
 *   - 등록상세 https://www.data.go.kr/data/15126315/openapi.do
 *       GET https://apis.data.go.kr/1130000/MllBsDtl_3Service/getMllBsInfoDetail_3  (opnSn | prmmiMnno | brno — 모두 선택)
 *       → 위 + ntslMthdNm(판매방식), trtmntPrdlstNm(취급품목), **domnCn(인터넷도메인)**, corpYnNm(법인여부) …
 *   ⚠️ 2026-10-07 실측: 현재 DATA_GO_KR_SERVICE_KEY 로 두 API 모두 403 SERVICE_KEY_IS_NOT_REGISTERED
 *     → data.go.kr 에서 **활용신청(자동승인)** 이 필요하다. 응답 필드는 페이지 swagger 기준이며 실응답 미확인.
 *     swagger 의 응답은 header/body 껍데기 없이 최상위에 resultCode·items 가 오도록 적혀 있어 두 모양을 모두 받는다.
 *
 * ② 파일(공정위 누리집, 로그인 불필요, 매주 일요일 갱신, 이용허락범위 제한 없음)
 *   - https://www.data.go.kr/data/15083251/fileData.do → https://www.ftc.go.kr/www/selectBizCommOpenList.do?key=255
 *   - 시군구별 CSV(CP949): /www/downloadBizComm.do?atchFileUrl=dataopen&atchFileNm=통신판매사업자_{시도}_{시군구}.csv
 *     (서울 강남구 1개 파일 ≈ 22MB, 전국 ≈ 180만 행)
 *   - 열: 통신판매번호, 신고기관명, 상호, 사업자등록번호(000-00-00000), 법인여부, 대표자명, 전화번호, 전자우편, 신고일자,
 *         사업장소재지, 사업장소재지(도로명), 업소상태, 신고기관 대표연락처, 판매방식, 취급품목, 인터넷도메인, 호스트서버소재지
 *   - 빈 값이 문자열 "null", 주소 안 쉼표가 "^" 로 바뀌어 있다. 개인사업자 전화·메일은 공정위가 비식별화(***)해서 준다.
 *
 * 🔴 대표자 이름·전화·전자우편은 **담지 않는다**(개인정보 — 보관 여부 대표 결정 대기). 회사명·사업자번호·도메인·취급품목만.
 */

const LIST_ENDPOINT =
  "https://apis.data.go.kr/1130000/MllBs_2Service/getMllBsInfo_2";
const DETAIL_ENDPOINT =
  "https://apis.data.go.kr/1130000/MllBsDtl_3Service/getMllBsInfoDetail_3";

export const FTC_ACTIVE = "정상영업";

/** swagger(최상위 resultCode) · data.go.kr 표준(response.header) 두 모양 모두 */
export function ftcItems(body: unknown): {
  items: Record<string, unknown>[];
  ok: boolean;
  totalCount: number | null;
} {
  const standard = dataGoKrItems(body);
  if (standard.resultCode !== null) {
    return {
      items: standard.items,
      ok: standard.resultCode === "00",
      totalCount: standard.totalCount,
    };
  }
  const root = asRecord(body);
  const code = str(root?.resultCode);
  if (code === null) {
    return { items: [], ok: false, totalCount: null };
  }
  const itemsField = root?.items;
  const raw = asRecord(itemsField)?.item ?? itemsField;
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (asRecord(raw)) {
    list = [raw];
  }
  return {
    items: list
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => item !== null),
    ok: code === "00",
    totalCount: num(root?.totalCount),
  };
}

/** API item → 발굴 회사(목록·상세 공통, 상세 전용 칸은 있으면 채움) */
export function ftcItemToDiscovered(
  item: Record<string, unknown>
): DiscoveredCompany | null {
  const name = str(item.bzmnNm);
  if (!name) {
    return null;
  }
  const company = emptyDiscovered("ftc_mail_order", name);
  const roadAddr = str(item.rnAddr) ?? str(item.lctnRnAddr);
  company.address =
    (roadAddr ?? str(item.lctnAddr))?.replaceAll("^", ",") ?? null;
  company.asOf = ymd(item.dclrDate);
  company.businessNumber = normalizeBizNo(str(item.brno));
  company.corpRegNo = str(item.crno);
  company.homepage = str(item.domnCn);
  company.products = str(item.trtmntPrdlstNm);
  company.region =
    regionFromText(str(item.ctpvNm)) ?? regionFromText(company.address);
  company.sourceRef = str(item.prmmiMnno) ?? str(item.opnSn);
  company.tags = ["commerce"];
  company.extra = {
    corporation: str(item.corpYnNm),
    registeredOn: ymd(item.dclrDate),
    salesMethod: str(item.ntslMthdNm),
    status: str(item.operSttusCdNm),
  };
  return company;
}

export function parseFtcList(
  body: unknown,
  pageNo: number
): DiscoveryPage | null {
  const { items, ok, totalCount } = ftcItems(body);
  if (!ok) {
    return null;
  }
  return {
    items: items
      .map((item) => ftcItemToDiscovered(item))
      .filter((c): c is DiscoveredCompany => c !== null),
    pageNo,
    totalCount,
  };
}

export interface FtcListQuery {
  /** 신고기관 지역명(예: "서울특별시 강남구") */
  district?: string | null;
  /** 신고일자 YYYYMMDD */
  fromYmd?: string | null;
  numOfRows?: number;
  pageNo?: number;
  /** 시도명(예: "서울특별시") */
  province?: string | null;
  /** 기본 "정상영업" — null 이면 상태 무관 */
  status?: string | null;
  toYmd?: string | null;
}

/** 등록현황 목록 1페이지. 키 없음·HTTP 오류·미신청(403) → null. */
export async function listFtcMailOrderSellers(
  query: FtcListQuery = {},
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<DiscoveryPage | null> {
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!key) {
    return null;
  }
  const pageNo = query.pageNo ?? 1;
  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: String(pageNo),
    numOfRows: String(Math.min(query.numOfRows ?? 100, 100)),
    resultType: "json",
  });
  const status = query.status === undefined ? FTC_ACTIVE : query.status;
  if (status) {
    params.set("operSttusCdNm", status);
  }
  if (query.province) {
    params.set("ctpvNm", query.province);
  }
  if (query.district) {
    params.set("dclrInstNm", query.district);
  }
  if (query.fromYmd) {
    params.set("fromYmd", query.fromYmd);
  }
  if (query.toYmd) {
    params.set("toYmd", query.toYmd);
  }
  const outcome = await fetchJson(
    "ftc-mail-order-list",
    `${LIST_ENDPOINT}?${params}`,
    { signal: options.signal },
    options.timeoutMs
  );
  return outcome.ok ? parseFtcList(outcome.body, pageNo) : null;
}

/** 등록상세(도메인·취급품목) — 사업자번호로 1건. 키 없음·오류·결과 없음 → null. */
export async function fetchFtcMailOrderDetail(
  businessNumber: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<DiscoveredCompany | null> {
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  const brno = normalizeBizNo(businessNumber);
  if (!(key && brno)) {
    return null;
  }
  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: "1",
    numOfRows: "10",
    resultType: "json",
    brno,
  });
  const outcome = await fetchJson(
    "ftc-mail-order-detail",
    `${DETAIL_ENDPOINT}?${params}`,
    { signal: options.signal },
    options.timeoutMs
  );
  if (!outcome.ok) {
    return null;
  }
  const page = parseFtcList(outcome.body, 1);
  // 같은 사업자번호로 여러 신고(지점·재신고)가 있으면 정상영업 · 최근 신고 순
  const sorted = [...(page?.items ?? [])].sort((a, b) => {
    const activeA = a.extra.status === FTC_ACTIVE ? 1 : 0;
    const activeB = b.extra.status === FTC_ACTIVE ? 1 : 0;
    return activeB - activeA || (b.asOf ?? "").localeCompare(a.asOf ?? "");
  });
  return sorted[0] ?? null;
}

// ── 파일(CSV) ───────────────────────────────────────────────────────────────

const CARET_RE = /\^/g;

/**
 * 공정위 시군구별 CSV → 발굴 회사. 기본은 정상영업만(activeOnly).
 * 개인정보 열(대표자명·전화번호·전자우편)은 읽지 않는다.
 */
export function parseFtcMailOrderCsv(
  text: string,
  options: { activeOnly?: boolean } = {}
): DiscoveredCompany[] {
  const activeOnly = options.activeOnly ?? true;
  const out: DiscoveredCompany[] = [];
  for (const record of csvRecords(text)) {
    const name = pick(record, "상호");
    const status = pick(record, "업소상태");
    if (!name || (activeOnly && status !== FTC_ACTIVE)) {
      continue;
    }
    const company = emptyDiscovered("ftc_mail_order", name);
    const road = pick(record, "사업장소재지(도로명)");
    const lot = pick(record, "사업장소재지");
    company.address = (road ?? lot)?.replace(CARET_RE, ",") ?? null;
    company.asOf = ymd(pick(record, "신고일자"));
    company.businessNumber = normalizeBizNo(pick(record, "사업자등록번호"));
    company.homepage = pick(record, "인터넷도메인");
    company.products = pick(record, "취급품목");
    company.region =
      regionFromText(pick(record, "신고기관명")) ??
      regionFromText(company.address);
    company.sourceRef = pick(record, "통신판매번호");
    company.tags = ["commerce"];
    company.extra = {
      corporation: pick(record, "법인여부"),
      registeredOn: ymd(pick(record, "신고일자")),
      salesMethod: pick(record, "판매방식"),
      status,
    };
    out.push(company);
  }
  return out;
}

/** 공정위 시군구 파일 다운로드 URL(수동/크론 단계에서 사용). */
export function ftcDistrictFileUrl(province: string, district: string): string {
  const fileName = `통신판매사업자_${province}_${district}.csv`;
  return `https://www.ftc.go.kr/www/downloadBizComm.do?atchFileUrl=dataopen&atchFileNm=${encodeURIComponent(fileName)}`;
}
