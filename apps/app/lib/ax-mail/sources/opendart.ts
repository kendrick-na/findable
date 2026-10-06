import "server-only";

import { inflateRawSync } from "node:zlib";
import { log } from "@repo/observability/log";
import {
  asRecord,
  fetchJson,
  normalizeBizNo,
  normalizeCorpName,
  num,
  str,
  ymd,
} from "./http";

/**
 * OpenDART (금융감독원 전자공시) — 고유번호 / 기업개황 / 단일회사 주요계정
 * 문서(2026-10-06 확인):
 *  - 고유번호  corpCode.xml : https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019018
 *      crtfc_key → Zip(CORPCODE.xml 1개). <list><corp_code/><corp_name/><corp_eng_name/><stock_code/><modify_date/></list>
 *  - 기업개황  company.json : https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002
 *      corp_name, ceo_nm, corp_cls(Y유가/K코스닥/N코넥스/E기타), jurir_no, bizr_no, adres, hm_url, est_dt, induty_code, acc_mt
 *  - 단일회사 주요계정 fnlttSinglAcnt.json : https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS003&apiId=2019016
 *      bsns_year(2015~), reprt_code(11011 사업보고서) → list[]: fs_div(CFS연결/OFS개별), sj_div(BS/IS),
 *      account_nm, thstrm_amount("1,234" 문자열), bsns_year, rcept_no, currency
 *  - status: 000 정상, 013 조회된 데이터 없음, 020 요청 제한 초과 …
 * 이용 조건: OpenDART 이용약관 제16조(저작권은 금융감독원), 공공데이터법 준수 — 설계안 문서 참조.
 *
 * ⚠️ DART 에는 **공시대상 회사만** 있다(상장사·외감법인 등). 비상장 중소기업은 대부분 없다 → null 이 정상.
 * ⚠️ 이름 부분일치 금지 — "바이오센서연구소"로 찾으면 "에스디바이오센서"가 걸린다(실측). 정규화 후 완전일치만.
 */

const BASE = "https://opendart.fss.or.kr/api";
/** corpCode.xml 은 압축 3.6MB / 해제 30MB(실측) — 하루 1번만 받는다. */
const CORP_CODE_TTL_MS = 24 * 60 * 60 * 1000;

export interface DartCorpCode {
  corpCode: string;
  corpName: string;
  stockCode: string | null;
}

export interface DartCompany {
  address: string | null;
  bizNo: string | null;
  ceo: string | null;
  /** Y유가 / K코스닥 / N코넥스 / E기타 */
  corpClass: string | null;
  corpCode: string;
  corpRegNo: string | null;
  foundedOn: string | null;
  homepage: string | null;
  name: string;
  stockCode: string | null;
}

export interface DartRevenue {
  /** 원 단위 */
  amount: number;
  currency: string | null;
  /** 사업연도 */
  fiscalYear: string;
  /** CFS 연결 / OFS 개별 */
  fsDiv: string | null;
  /** 원천 공시 접수번호 — dart.fss.or.kr/dsaf001/main.do?rcpNo= 로 원문 확인 */
  receiptNo: string | null;
}

// ── 고유번호 ZIP 해제 (새 의존성 없이 node:zlib) ─────────────────────────────

const EOCD_SIG = 0x06_05_4b_50;
const CEN_SIG = 0x02_01_4b_50;
const LOC_SIG = 0x04_03_4b_50;

/**
 * 단일 파일 ZIP 의 첫 항목을 꺼낸다. 중앙 디렉터리에서 크기를 읽으므로
 * 로컬 헤더에 크기가 0인(data descriptor) 경우도 처리된다. 실패 시 null.
 */
export function unzipFirstEntry(zip: Buffer): Buffer | null {
  const minEocd = 22;
  for (
    let i = zip.length - minEocd;
    i >= Math.max(0, zip.length - 65_557);
    i--
  ) {
    if (zip.readUInt32LE(i) !== EOCD_SIG) {
      continue;
    }
    const cenOffset = zip.readUInt32LE(i + 16);
    if (zip.readUInt32LE(cenOffset) !== CEN_SIG) {
      return null;
    }
    const method = zip.readUInt16LE(cenOffset + 10);
    const compressedSize = zip.readUInt32LE(cenOffset + 20);
    const localOffset = zip.readUInt32LE(cenOffset + 42);
    if (zip.readUInt32LE(localOffset) !== LOC_SIG) {
      return null;
    }
    const nameLen = zip.readUInt16LE(localOffset + 26);
    const extraLen = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + nameLen + extraLen;
    const data = zip.subarray(start, start + compressedSize);
    if (method === 0) {
      return Buffer.from(data);
    }
    if (method === 8) {
      try {
        return inflateRawSync(data);
      } catch {
        return null;
      }
    }
    return null;
  }
  return null;
}

const LIST_RE = /<list>([\s\S]*?)<\/list>/g;
const TAG_RES = {
  corpCode: /<corp_code>([^<]*)<\/corp_code>/,
  corpName: /<corp_name>([^<]*)<\/corp_name>/,
  stockCode: /<stock_code>([^<]*)<\/stock_code>/,
} as const;

function decodeXml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/** 순수 파서 — CORPCODE.xml 문자열 → 목록 */
export function parseCorpCodeXml(xml: string): DartCorpCode[] {
  const out: DartCorpCode[] = [];
  for (const match of xml.matchAll(LIST_RE)) {
    const block = match[1] ?? "";
    const corpCode = TAG_RES.corpCode.exec(block)?.[1]?.trim();
    const corpName = TAG_RES.corpName.exec(block)?.[1]?.trim();
    if (!(corpCode && corpName)) {
      continue;
    }
    out.push({
      corpCode,
      corpName: decodeXml(corpName),
      stockCode: TAG_RES.stockCode.exec(block)?.[1]?.trim() || null,
    });
  }
  return out;
}

/** 정규화 이름 → 후보들 */
export type CorpCodeIndex = Map<string, DartCorpCode[]>;

export function buildCorpCodeIndex(list: DartCorpCode[]): CorpCodeIndex {
  const index: CorpCodeIndex = new Map();
  for (const corp of list) {
    const key = normalizeCorpName(corp.corpName);
    const bucket = index.get(key);
    if (bucket) {
      bucket.push(corp);
    } else {
      index.set(key, [corp]);
    }
  }
  return index;
}

let corpCodeCache: { at: number; index: Promise<CorpCodeIndex | null> } | null =
  null;

async function downloadCorpCodeIndex(
  key: string,
  timeoutMs: number
): Promise<CorpCodeIndex | null> {
  let response: Response;
  try {
    response = await fetch(
      `${BASE}/corpCode.xml?crtfc_key=${encodeURIComponent(key)}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
  } catch {
    log.warn("[ax-mail:opendart-corpcode] request failed");
    return null;
  }
  if (!response.ok) {
    log.warn("[ax-mail:opendart-corpcode] http error", {
      status: response.status,
    });
    return null;
  }
  const xml = unzipFirstEntry(Buffer.from(await response.arrayBuffer()));
  if (!xml) {
    // 키 오류면 ZIP 대신 XML 오류(status)가 온다 — 본문은 남기지 않는다.
    log.warn("[ax-mail:opendart-corpcode] not a zip");
    return null;
  }
  return buildCorpCodeIndex(parseCorpCodeXml(xml.toString("utf8")));
}

/** 프로세스 메모리 캐시(24h). 실패하면 캐시하지 않아 다음 호출이 재시도한다. */
export function loadCorpCodeIndex(
  timeoutMs = 60_000
): Promise<CorpCodeIndex | null> {
  const key = process.env.OPENDART_API_KEY;
  if (!key) {
    return Promise.resolve(null);
  }
  const now = Date.now();
  if (corpCodeCache && now - corpCodeCache.at < CORP_CODE_TTL_MS) {
    return corpCodeCache.index;
  }
  const index = downloadCorpCodeIndex(key, timeoutMs);
  corpCodeCache = { at: now, index };
  index.then((value) => {
    if (!value) {
      corpCodeCache = null;
    }
  });
  return index;
}

/** 정규화 완전일치 후보 */
export function lookupCorpCodes(
  index: CorpCodeIndex,
  name: string
): DartCorpCode[] {
  return index.get(normalizeCorpName(name)) ?? [];
}

// ── 기업개황 ────────────────────────────────────────────────────────────────

export function parseDartCompany(body: unknown): DartCompany | null {
  const root = asRecord(body);
  const corpCode = str(root?.corp_code);
  const name = str(root?.corp_name);
  if (str(root?.status) !== "000" || !(corpCode && name)) {
    return null;
  }
  return {
    address: str(root?.adres),
    bizNo: normalizeBizNo(str(root?.bizr_no)),
    ceo: str(root?.ceo_nm),
    corpClass: str(root?.corp_cls),
    corpCode,
    corpRegNo: str(root?.jurir_no),
    foundedOn: ymd(root?.est_dt),
    homepage: str(root?.hm_url),
    name,
    stockCode: str(root?.stock_code),
  };
}

// ── 매출(단일회사 주요계정) ─────────────────────────────────────────────────

/** 손익계산서 매출 계정명 — 회사마다 표기가 다르다. */
const REVENUE_ACCOUNTS = new Set([
  "매출액",
  "수익(매출액)",
  "영업수익",
  "매출",
]);

/** 연결(CFS) 우선, 없으면 개별(OFS). 매출 계정이 없으면 null — 다른 계정으로 대신하지 않는다. */
export function parseDartRevenue(body: unknown): DartRevenue | null {
  const root = asRecord(body);
  if (str(root?.status) !== "000" || !Array.isArray(root?.list)) {
    return null;
  }
  const rows = root.list
    .map((row) => asRecord(row))
    .filter(
      (row): row is Record<string, unknown> =>
        row !== null &&
        str(row.sj_div) === "IS" &&
        REVENUE_ACCOUNTS.has(str(row.account_nm) ?? "")
    );
  const row =
    rows.find((r) => str(r.fs_div) === "CFS") ??
    rows.find((r) => str(r.fs_div) === "OFS");
  const amount = row ? num(row.thstrm_amount) : null;
  const fiscalYear = row ? str(row.bsns_year) : null;
  if (!(row && amount !== null && fiscalYear)) {
    return null;
  }
  return {
    amount,
    currency: str(row.currency),
    fiscalYear,
    fsDiv: str(row.fs_div),
    receiptNo: str(row.rcept_no),
  };
}

export interface DartResult {
  /** 이름 완전일치 후보가 여럿이고 사업자번호로도 못 좁혔을 때 true */
  ambiguous: boolean;
  company: DartCompany | null;
  revenue: DartRevenue | null;
}

/**
 * 이름(+사업자번호) → 기업개황 + 최근 사업보고서 매출.
 * 키 없음 → null. DART 미등록 회사 → { company: null }.
 */
export async function fetchDart(
  query: { name: string; businessNumber?: string | null },
  options: { now?: Date; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<DartResult | null> {
  const key = process.env.OPENDART_API_KEY;
  if (!key) {
    return null;
  }
  const index = await loadCorpCodeIndex();
  if (!index) {
    return null;
  }
  const candidates = lookupCorpCodes(index, query.name).slice(0, 5);
  if (candidates.length === 0) {
    return { ambiguous: false, company: null, revenue: null };
  }
  const get = (path: string, params: Record<string, string>) =>
    fetchJson(
      `opendart-${path}`,
      `${BASE}/${path}?${new URLSearchParams({ crtfc_key: key, ...params })}`,
      { signal: options.signal },
      options.timeoutMs
    );

  const companies: DartCompany[] = [];
  for (const candidate of candidates) {
    const res = await get("company.json", { corp_code: candidate.corpCode });
    const company = res.ok ? parseDartCompany(res.body) : null;
    if (company) {
      companies.push(company);
    }
  }
  const bizNo = normalizeBizNo(query.businessNumber);
  const matched = bizNo
    ? companies.filter((c) => c.bizNo === bizNo)
    : companies;
  const company = matched.length === 1 ? (matched[0] ?? null) : null;
  const ambiguous =
    matched.length > 1 || (matched.length === 0 && companies.length > 1);
  if (!company) {
    return { ambiguous, company: null, revenue: null };
  }

  // 사업보고서는 결산 후 3월 말 제출 → 작년 → 재작년 순으로 시도
  const year = (options.now ?? new Date()).getFullYear();
  let revenue: DartRevenue | null = null;
  for (const bsnsYear of [year - 1, year - 2]) {
    const res = await get("fnlttSinglAcnt.json", {
      corp_code: company.corpCode,
      bsns_year: String(bsnsYear),
      reprt_code: "11011",
    });
    revenue = res.ok ? parseDartRevenue(res.body) : null;
    if (revenue) {
      break;
    }
  }
  return { ambiguous: false, company, revenue };
}
