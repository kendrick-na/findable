import "server-only";

import { log } from "@repo/observability/log";
import { asRecord, fetchJson, str } from "./http";
import { unzipFirstEntry } from "./opendart";

/**
 * 감사보고서(외부감사 대상 비상장 법인) 원문에서 연매출 읽기.
 *
 * 왜: 사업보고서 API(fnlttSinglAcnt)는 외감 비상장에는 "데이터 없음(013)"이다 [실측: 비나우 2022~2025].
 *     이 회사들은 list.json 에 감사보고서(pblntf_ty=F)만 있고 매출은 원문(document.xml)의 손익계산서에 있다.
 * 원칙(추정 금지): 손익계산서 머리의 단위를 못 읽거나 계정명이 허용 목록에 없으면 null.
 *     당기(제N기) 열만 쓴다. 연결감사보고서가 있으면 연결, 없으면 별도.
 * 이용 범위: 금액·사업연도·접수번호만 저장·표시한다(원문 재배포 아님).
 */

const BASE = "https://opendart.fss.or.kr/api";
const DOC_TIMEOUT_MS = 30_000;
const MAX_REPORTS = 4;

export interface AuditRevenue {
  /** 원 단위 */
  amount: number;
  basis: "audit_report";
  fiscalYear: string;
  /** CFS 연결 / OFS 별도 */
  fsDiv: "CFS" | "OFS";
  /** dart.fss.or.kr/dsaf001/main.do?rcpNo= 로 원문 확인 */
  receiptNo: string;
}

export interface AuditReportItem {
  fiscalYear: string;
  fsDiv: "CFS" | "OFS";
  receiptNo: string;
  receivedAt: string;
}

/** 손익계산서에서 매출로 인정하는 계정명(그 외는 추정하지 않고 null). */
const REVENUE_LABELS = ["매출액", "영업수익", "수익(매출액)", "수익"];

const UNIT_FACTOR: Record<string, number> = {
  원: 1,
  천원: 1000,
  백만원: 1_000_000,
};

/** 3자리 콤마 금액만 인정 → 주석 번호("23", "9,24,26")를 금액으로 착각하지 않는다. */
const AMOUNT_RE = /^\(?-?\d{1,3}(?:,\d{3})+\)?$/;

function toText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** 손익계산서 구간: 제목 뒤에 '(단위 : …)' 와 '과목' 이 이어지는 곳만(목차·주석의 같은 말은 건너뜀). */
const STATEMENT_RE =
  /손\s*익\s*계\s*산\s*서[\s\S]{0,400}?\(\s*단위\s*:\s*(원|천원|백만원)\s*\)\s*과\s*목/g;
const FISCAL_YEAR_RE = /\((\d{4})\.\d{2}\)/;
const AMOUNT_CLEAN_RE = /[(),]/g;

/** 계정명 뒤 첫 금액(주석 번호는 AMOUNT_RE 에서 걸러짐) = 당기. */
function firstRevenueAmount(tokens: string[]): number | null {
  // 계정명이 두 토큰으로 나뉘는 경우("매 출 액")는 허용하지 않는다(추정 금지).
  const at = tokens.findIndex((t) => REVENUE_LABELS.includes(t));
  if (at < 0) {
    return null;
  }
  const token = tokens.slice(at + 1, at + 6).find((t) => AMOUNT_RE.test(t));
  const raw = token ? Number(token.replace(AMOUNT_CLEAN_RE, "")) : Number.NaN;
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * 감사보고서 원문(XML/HTML 문자열) → 당기 매출(원). 못 읽으면 null.
 * 단위는 손익계산서 머리 "(단위 : 원|천원|백만원)" 을 읽어 환산한다.
 */
export function parseAuditRevenueAmount(markup: string): number | null {
  const text = toText(markup);
  for (const head of text.matchAll(STATEMENT_RE)) {
    const factor = UNIT_FACTOR[head[1] ?? ""];
    const from = (head.index ?? 0) + head[0].length;
    const raw = factor
      ? firstRevenueAmount(text.slice(from, from + 600).split(" "))
      : null;
    if (factor && raw !== null) {
      return raw * factor;
    }
  }
  return null;
}

function fsRank(fsDiv: "CFS" | "OFS"): number {
  return fsDiv === "CFS" ? 0 : 1;
}

/** list.json 응답 → 감사보고서 목록(최신 사업연도 → 연결 우선 → 접수일 최신). */
export function parseAuditReportList(body: unknown): AuditReportItem[] {
  const root = asRecord(body);
  if (str(root?.status) !== "000" || !Array.isArray(root?.list)) {
    return [];
  }
  const items: AuditReportItem[] = [];
  for (const raw of root.list) {
    const row = asRecord(raw);
    const name = str(row?.report_nm) ?? "";
    const receiptNo = str(row?.rcept_no);
    // 사업연도는 이름의 (YYYY.MM) 에서 읽는다. 못 읽으면 제외.
    const year = FISCAL_YEAR_RE.exec(name)?.[1];
    if (row && receiptNo && year && name.includes("감사보고서")) {
      items.push({
        fiscalYear: year,
        fsDiv: name.includes("연결") ? "CFS" : "OFS",
        receiptNo,
        receivedAt: str(row.rcept_dt) ?? "",
      });
    }
  }
  return items.sort(
    (a, b) =>
      b.fiscalYear.localeCompare(a.fiscalYear) ||
      fsRank(a.fsDiv) - fsRank(b.fsDiv) ||
      b.receivedAt.localeCompare(a.receivedAt)
  );
}

async function fetchDocument(
  key: string,
  receiptNo: string,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const url = `${BASE}/document.xml?${new URLSearchParams({ crtfc_key: key, rcept_no: receiptNo })}`;
    const timeout = AbortSignal.timeout(DOC_TIMEOUT_MS);
    const response = await fetch(url, {
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      log.warn("[ax-mail:opendart-audit] document http error", {
        status: response.status,
      });
      return null;
    }
    const entry = unzipFirstEntry(Buffer.from(await response.arrayBuffer()));
    return entry ? entry.toString("utf8") : null;
  } catch {
    log.warn("[ax-mail:opendart-audit] document failed");
    return null;
  }
}

/**
 * 고유번호 → 가장 최근 사업연도 감사보고서의 당기 매출. 없거나 못 읽으면 null.
 * 연결 우선: 같은 사업연도에 연결이 있으면 연결을 먼저 시도하고, 그 값을 못 읽을 때만 별도로 내려간다.
 */
export async function fetchAuditRevenue(
  corpCode: string,
  options: { now?: Date; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<AuditRevenue | null> {
  const key = process.env.OPENDART_API_KEY;
  if (!key) {
    return null;
  }
  const now = options.now ?? new Date();
  const begin = `${now.getFullYear() - 3}0101`;
  const end = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const res = await fetchJson(
    "opendart-audit-list",
    `${BASE}/list.json?${new URLSearchParams({
      bgn_de: begin,
      corp_code: corpCode,
      crtfc_key: key,
      end_de: end,
      page_count: "100",
      pblntf_ty: "F",
    })}`,
    { signal: options.signal },
    options.timeoutMs
  );
  if (!res.ok) {
    return null;
  }
  const reports = parseAuditReportList(res.body).slice(0, MAX_REPORTS);
  for (const report of reports) {
    const markup = await fetchDocument(key, report.receiptNo, options.signal);
    const amount = markup ? parseAuditRevenueAmount(markup) : null;
    if (amount !== null) {
      return {
        amount,
        basis: "audit_report",
        fiscalYear: report.fiscalYear,
        fsDiv: report.fsDiv,
        receiptNo: report.receiptNo,
      };
    }
  }
  return null;
}
