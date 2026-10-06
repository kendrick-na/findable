import "server-only";

import { asRecord, fetchJson, normalizeBizNo, str, ymd } from "./http";

/**
 * 국세청_사업자등록정보 진위확인 및 상태조회 서비스 — 상태조회(/status)
 * 문서: https://www.data.go.kr/data/15081808/openapi.do
 *  (스펙: https://infuser.odcloud.kr/api/stages/28493/api-docs — BusinessStatus 정의)
 * 이용허락범위: 제한 없음 (페이지 표기, 2026-10-06 확인)
 *
 * POST https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=..
 *   body { b_no: ["10자리"] }  (1회 최대 100건)
 * 응답 data[] 필드: b_no, b_stt(계속사업자/휴업자/폐업자), b_stt_cd(01/02/03),
 *   tax_type, tax_type_cd, end_dt(폐업일), utcc_yn, tax_type_change_dt, invoice_apply_dt,
 *   rbf_tax_type, rbf_tax_type_cd
 */

const ENDPOINT = "https://api.odcloud.kr/api/nts-businessman/v1/status";

export type NtsBusinessState = "active" | "suspended" | "closed" | "unknown";

export interface NtsStatus {
  bizNo: string;
  /** 폐업일(YYYY-MM-DD) — 폐업자일 때만 */
  closedOn: string | null;
  state: NtsBusinessState;
  /** 국세청 원문 상태명 (예: 계속사업자) */
  stateLabel: string | null;
  /** 과세유형 원문 (예: 부가가치세 일반과세자). 미등록이면 안내 문구가 그대로 온다. */
  taxType: string | null;
  taxTypeCode: string | null;
}

const STATE_BY_CODE: Record<string, NtsBusinessState> = {
  "01": "active",
  "02": "suspended",
  "03": "closed",
};

/** 순수 파서 — /status 응답 본문에서 해당 사업자번호 1건을 꺼낸다. */
export function parseNtsStatus(body: unknown, bizNo: string): NtsStatus | null {
  const root = asRecord(body);
  if (str(root?.status_code) !== "OK" || !Array.isArray(root?.data)) {
    return null;
  }
  const row = root.data
    .map((item) => asRecord(item))
    .find((item) => item && normalizeBizNo(str(item.b_no)) === bizNo);
  if (!row) {
    return null;
  }
  const code = str(row.b_stt_cd);
  return {
    bizNo,
    closedOn: ymd(row.end_dt),
    state: (code && STATE_BY_CODE[code]) || "unknown",
    stateLabel: str(row.b_stt),
    taxType: str(row.tax_type),
    taxTypeCode: str(row.tax_type_cd),
  };
}

/** 키 없음·번호 형식 오류 → null. HTTP 오류(현재 503/504 빈발)도 null — throw 하지 않는다. */
export async function fetchNtsStatus(
  businessNumber: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<NtsStatus | null> {
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  const bizNo = normalizeBizNo(businessNumber);
  if (!(key && bizNo)) {
    return null;
  }
  const outcome = await fetchJson(
    "nts-status",
    `${ENDPOINT}?serviceKey=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ b_no: [bizNo] }),
      signal: options.signal,
    },
    options.timeoutMs
  );
  return outcome.ok ? parseNtsStatus(outcome.body, bizNo) : null;
}
