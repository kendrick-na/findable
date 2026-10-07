import "server-only";

import { regionFromSidoCode, regionFromText } from "../discovery/taxonomy";
import {
  type DiscoveredCompany,
  type DiscoveryPage,
  emptyDiscovered,
} from "../discovery/types";
import { csvRecords, pick } from "./csv";
import { dataGoKrItems, fetchJson, num, str, ymd } from "./http";

/**
 * 국민연금 가입 사업장 — **전 업종** 발굴 원천(업종명·가입자수·월별 취득/상실). 2026-10-07 확인.
 *
 * ① 오픈API(V2) https://www.data.go.kr/data/3046071/openapi.do — 이용허락범위 제한 없음
 *    getBassInfoSearchV2 는 사업장명 없이 **지역 코드만으로 목록 조회가 된다**(실측: ldongAddrMgplDgCd=11 → totalCount 1,592,776,
 *    여러 달 스냅샷이 섞인 수). 목록 행에는 업종·가입자수가 없어 행마다 getDetailInfoSearchV2(seq) 1회가 더 든다.
 *    상세: wkplIntpCd(업종코드 6자리) · vldtVlKrnNm(업종명) · jnngpCnt(가입자수) · adptDt(적용일)
 *    ⚠️ wkplIntpCd 는 KSIC 가 아니다(실측 "281104" = 육상 금속 골조 구조재 제조업 — 국세청 업종코드 체계로 보임 [확인필요]).
 *      → industryCode 에 넣지 않고 업종명으로 분류한다.
 * ② 월별 전체 파일 https://www.data.go.kr/data/15083277/fileData.do — 이용허락범위 제한 없음 · 월간(차기 2026-10-26)
 *    CSV(CP949) ≈ 115MB · 열: 자료생성년월, 사업장명, 사업자등록번호(앞 6자리), 사업장가입상태코드 1 등록 2 탈퇴, 우편번호,
 *    사업장지번상세주소, 사업장도로명상세주소, 고객법정동주소코드, 고객행정동주소코드, 법정동주소광역시도코드,
 *    법정동주소광역시시군구코드, 법정동주소광역시시군구읍면동코드, 사업장형태구분코드 1 법인 2 개인, 사업장업종코드,
 *    사업장업종코드명, 적용일자, 재등록일자, 탈퇴일자, 가입자수, 당월고지금액, 신규취득자수, 상실가입자수
 *    → 전국 적재는 API 160만 회 대신 **이 파일을 월 1회 받아 파싱**하는 게 맞다(다운로드는 data.go.kr 로그인 불필요).
 *
 * 제공 범위: 가입자 3인 이상 법인 / 10인 이상 개인(2025.7.~). 사업자번호는 앞 6자리만 공개 → 적재 시 이름+지역+앞6자리로 묶는다.
 */

const BASE = "https://apis.data.go.kr/B552015/NpsBplcInfoInqireServiceV2";

/** 건설 일용 현장 등 「사업장 = 공사 현장」 행 — 회사 발굴 대상이 아니다(실측: "(주)포유이엔지/일용/…철골공사"). */
const SIDO_CODE_RE = /^\d{2}$/;
const SITE_ROW_RE = /일용|공사현장|신축공사|\/현장|현장\)/;

export function isSiteRow(name: string): boolean {
  return SITE_ROW_RE.test(name);
}

function workplaceType(code: string | null): string | null {
  if (code === "1") {
    return "corporation";
  }
  if (code === "2") {
    return "individual";
  }
  return null;
}

/** YYYYMM | YYYY-MM → YYYY-MM */
function month(value: string | null): string | null {
  const digits = (value ?? "").replaceAll(/\D/g, "");
  return digits.length >= 6
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}`
    : null;
}

// ── ① API ──────────────────────────────────────────────────────────────────

export interface NpsListRow {
  address: string | null;
  bizNoPrefix: string | null;
  month: string | null;
  name: string;
  region: string | null;
  seq: string;
  type: string | null;
}

/** 목록 순수 파서 — 등록(1) 사업장만, 현장 행 제외 */
export function parseNpsList(body: unknown): {
  rows: NpsListRow[];
  totalCount: number | null;
} | null {
  const { resultCode, items, totalCount } = dataGoKrItems(body);
  if (resultCode !== "00") {
    return null;
  }
  const rows: NpsListRow[] = [];
  for (const item of items) {
    const name = str(item.wkplNm);
    const seq = str(item.seq);
    if (!(name && seq) || str(item.wkplJnngStcd) !== "1" || isSiteRow(name)) {
      continue;
    }
    const prefix =
      str(item.bzowrRgstNo)?.replaceAll(/\D/g, "").slice(0, 6) ?? null;
    const address = str(item.wkplRoadNmDtlAddr);
    rows.push({
      address,
      bizNoPrefix: prefix && prefix.length === 6 ? prefix : null,
      month: month(str(item.dataCrtYm)),
      name,
      region:
        regionFromSidoCode(str(item.ldongAddrMgplDgCd)) ??
        regionFromText(address),
      seq,
      type: workplaceType(str(item.wkplStylDvcd)),
    });
  }
  return { rows, totalCount };
}

export interface NpsDetailRow {
  industryName: string | null;
  members: number | null;
  npsIndustryCode: string | null;
  registeredOn: string | null;
}

export function parseNpsListDetail(body: unknown): NpsDetailRow | null {
  const { resultCode, items } = dataGoKrItems(body);
  const item = items[0];
  if (resultCode !== "00" || !item) {
    return null;
  }
  return {
    industryName: str(item.vldtVlKrnNm),
    members: num(item.jnngpCnt),
    npsIndustryCode: str(item.wkplIntpCd),
    registeredOn: ymd(item.adptDt),
  };
}

export function npsRowToDiscovered(
  row: NpsListRow,
  detail: NpsDetailRow | null
): DiscoveredCompany {
  const company = emptyDiscovered("nps", row.name);
  company.address = row.address;
  company.asOf = row.month;
  company.bizNoPrefix = row.bizNoPrefix;
  company.employees = detail?.members ?? null;
  company.industryName = detail?.industryName ?? null;
  company.region = row.region;
  company.sourceRef = row.seq;
  company.extra = {
    month: row.month,
    npsIndustryCode: detail?.npsIndustryCode ?? null,
    registeredOn: detail?.registeredOn ?? null,
    workplaceType: row.type,
  };
  return company;
}

/**
 * 지역별 목록 1페이지(+선택: 행마다 상세 1회). 키 없음·HTTP 오류 → null.
 * 한 페이지 안에서 같은 사업장(앞6자리+이름)이 여러 달로 오면 최신 달 1개만 남긴다.
 */
export async function listNpsWorkplaces(
  query: {
    /** 법정동 시도코드 2자리(서울 11, 경기 41 …) */
    sidoCode: string;
    /** 법정동 시군구코드 3자리(선택) */
    sigunguCode?: string | null;
    numOfRows?: number;
    pageNo?: number;
    withDetail?: boolean;
  },
  options: {
    concurrency?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<DiscoveryPage | null> {
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!(key && SIDO_CODE_RE.test(query.sidoCode))) {
    return null;
  }
  const pageNo = query.pageNo ?? 1;
  const params: Record<string, string> = {
    serviceKey: key,
    dataType: "json",
    pageNo: String(pageNo),
    numOfRows: String(Math.min(query.numOfRows ?? 100, 100)),
    ldongAddrMgplDgCd: query.sidoCode,
  };
  if (query.sigunguCode) {
    params.ldongAddrMgplSgguCd = query.sigunguCode;
  }
  const outcome = await fetchJson(
    "nps-list",
    `${BASE}/getBassInfoSearchV2?${new URLSearchParams(params)}`,
    { signal: options.signal },
    options.timeoutMs
  );
  if (!outcome.ok) {
    return null;
  }
  const parsed = parseNpsList(outcome.body);
  if (!parsed) {
    return null;
  }
  const latest = new Map<string, NpsListRow>();
  for (const row of parsed.rows) {
    const k = `${row.bizNoPrefix ?? ""}|${row.name}`;
    const prev = latest.get(k);
    if (!prev || (row.month ?? "") > (prev.month ?? "")) {
      latest.set(k, row);
    }
  }
  const rows = [...latest.values()];
  const details = new Map<string, NpsDetailRow | null>();
  if (query.withDetail) {
    const limit = Math.max(1, options.concurrency ?? 5);
    for (let i = 0; i < rows.length; i += limit) {
      await Promise.all(
        rows.slice(i, i + limit).map(async (row) => {
          const res = await fetchJson(
            "nps-list-detail",
            `${BASE}/getDetailInfoSearchV2?${new URLSearchParams({ serviceKey: key, dataType: "json", seq: row.seq })}`,
            { signal: options.signal },
            options.timeoutMs
          );
          details.set(row.seq, res.ok ? parseNpsListDetail(res.body) : null);
        })
      );
    }
  }
  return {
    items: rows.map((row) =>
      npsRowToDiscovered(row, details.get(row.seq) ?? null)
    ),
    pageNo,
    totalCount: parsed.totalCount,
  };
}

// ── ② 월별 파일(CSV) ────────────────────────────────────────────────────────

/** 월별 전체 파일 → 발굴 회사. 기본은 등록(1) 사업장만, 현장 행 제외. */
export function parseNpsMonthlyCsv(
  text: string,
  options: { includeWithdrawn?: boolean } = {}
): DiscoveredCompany[] {
  const out: DiscoveredCompany[] = [];
  for (const record of csvRecords(text)) {
    const name = pick(record, "사업장명");
    const state = pick(record, "사업장가입상태코드 1 등록 2 탈퇴");
    if (
      !name ||
      isSiteRow(name) ||
      (!options.includeWithdrawn && state !== "1")
    ) {
      continue;
    }
    const prefix = (pick(record, "사업자등록번호") ?? "").replaceAll(/\D/g, "");
    const address =
      pick(record, "사업장도로명상세주소") ??
      pick(record, "사업장지번상세주소");
    const m = month(pick(record, "자료생성년월"));
    const company = emptyDiscovered("nps", name);
    company.address = address;
    company.asOf = m;
    company.bizNoPrefix = prefix.length >= 6 ? prefix.slice(0, 6) : null;
    company.employees = num(pick(record, "가입자수"));
    company.industryName = pick(record, "사업장업종코드명");
    company.region =
      regionFromSidoCode(pick(record, "법정동주소광역시도코드")) ??
      regionFromText(address);
    company.extra = {
      lost: num(pick(record, "상실가입자수")),
      month: m,
      newlyEnrolled: num(pick(record, "신규취득자수")),
      npsIndustryCode: pick(record, "사업장업종코드"),
      registeredOn: pick(record, "적용일자"),
      withdrawnOn: pick(record, "탈퇴일자"),
      workplaceType: workplaceType(
        pick(record, "사업장형태구분코드 1 법인 2 개인")
      ),
    };
    out.push(company);
  }
  return out;
}
