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
 * 국민연금공단_국민연금 가입 사업장 내역 (V2)
 * 문서: https://www.data.go.kr/data/3046071/openapi.do (페이지 내장 swagger 로 필드 확인, 2026-10-06)
 * 이용허락범위: 제한 없음
 * 제공 범위: 가입자 3인 이상 법인사업장, 10인 이상 개인사업장(2025.7. 이후) — 작은 회사는 안 나올 수 있다.
 *
 * Base: https://apis.data.go.kr/B552015/NpsBplcInfoInqireServiceV2
 *  ① getBassInfoSearchV2       — wkplNm(필수), bzowrRgstNo(앞 6자리) → seq, dataCrtYm(자료생성년월),
 *                                 wkplNm, bzowrRgstNo("119867****" 마스킹), wkplRoadNmDtlAddr, wkplJnngStcd(1등록/2탈퇴)
 *  ② getDetailInfoSearchV2     — seq → jnngpCnt(가입자수), adptDt(등록일), scsnDt(탈퇴일), vldtVlKrnNm(업종명), crrmmNtcAmt(당월고지금액)
 *  ③ getPdAcctoSttusInfoSearchV2 — seq(+dataCrtYm) → nwAcqzrCnt(월별 취업자수), lssJnngpCnt(월별 퇴직자수)
 *
 * ⚠️ 실측: seq 는 「사업장 고유번호」가 아니라 **월별 스냅샷 1행**의 번호다.
 *   같은 사업장이 dataCrtYm 마다 다른 seq 로 온다 → 월별 추이 = 최근 N개월 seq 각각 ②③ 호출.
 */

const BASE = "https://apis.data.go.kr/B552015/NpsBplcInfoInqireServiceV2";

export interface NpsSnapshotRow {
  address: string | null;
  bizNoPrefix: string | null;
  /** YYYYMM */
  month: string;
  name: string;
  registered: boolean;
  seq: string;
}

export interface NpsMonth {
  /** 해당 월 상실(퇴직) */
  lost: number | null;
  /** 가입자수(고지인원 포함) */
  members: number | null;
  /** YYYYMM */
  month: string;
  /** 해당 월 신규취득(취업) */
  newlyEnrolled: number | null;
}

export type GrowthSignal = "growing" | "flat" | "shrinking" | "unknown";

export interface NpsWorkplace {
  address: string | null;
  growth: {
    /** 비교 구간 첫 달 → 마지막 달 가입자 변화 */
    delta: number | null;
    signal: GrowthSignal;
  };
  industry: string | null;
  /** 최근 달이 위로 오도록 정렬 */
  months: NpsMonth[];
  name: string;
  registeredOn: string | null;
  /** 최신 달에 같은 이름·번호로 잡힌 사업장 수 — 2 이상이면 지점이 여러 개(첫 행만 사용) */
  workplacesInLatestMonth: number;
}

/** ① 순수 파서 — 이름·사업자번호 앞 6자리가 맞는 월별 스냅샷만. */
export function parseNpsSearch(
  body: unknown,
  query: { name: string; businessNumber?: string | null }
): NpsSnapshotRow[] {
  const { resultCode, items } = dataGoKrItems(body);
  if (resultCode !== "00") {
    return [];
  }
  const wantName = normalizeCorpName(query.name);
  const wantPrefix = normalizeBizNo(query.businessNumber)?.slice(0, 6) ?? null;
  const rows: NpsSnapshotRow[] = [];
  for (const item of items) {
    const name = str(item.wkplNm);
    const seq = str(item.seq);
    const month = str(item.dataCrtYm);
    if (!(name && seq && month)) {
      continue;
    }
    const prefix =
      str(item.bzowrRgstNo)?.replaceAll(/\D/g, "").slice(0, 6) ?? null;
    if (normalizeCorpName(name) !== wantName) {
      continue;
    }
    if (wantPrefix && prefix !== wantPrefix) {
      continue;
    }
    rows.push({
      address: str(item.wkplRoadNmDtlAddr),
      bizNoPrefix: prefix,
      month,
      name,
      registered: str(item.wkplJnngStcd) === "1",
      seq,
    });
  }
  return rows.sort((a, b) => b.month.localeCompare(a.month));
}

/** ② 순수 파서 */
export function parseNpsDetail(body: unknown): {
  industry: string | null;
  members: number | null;
  registeredOn: string | null;
} | null {
  const { resultCode, items } = dataGoKrItems(body);
  const item = items[0];
  if (resultCode !== "00" || !item) {
    return null;
  }
  return {
    industry: str(item.vldtVlKrnNm),
    members: num(item.jnngpCnt),
    registeredOn: ymd(item.adptDt),
  };
}

/** ③ 순수 파서 */
export function parseNpsPeriod(
  body: unknown
): { lost: number | null; newlyEnrolled: number | null } | null {
  const { resultCode, items } = dataGoKrItems(body);
  const item = items[0];
  if (resultCode !== "00" || !item) {
    return null;
  }
  return { lost: num(item.lssJnngpCnt), newlyEnrolled: num(item.nwAcqzrCnt) };
}

/** 성장 신호 — 비교 구간 가입자 변화율 ±10% 를 경계로. 2개월 미만이면 판단하지 않는다. */
export function growthSignal(months: NpsMonth[]): NpsWorkplace["growth"] {
  const counted = months.filter((m) => m.members !== null);
  if (counted.length < 2) {
    return { delta: null, signal: "unknown" };
  }
  const latest = counted[0]?.members ?? 0;
  const earliest = counted.at(-1)?.members ?? 0;
  const delta = latest - earliest;
  if (earliest <= 0) {
    return { delta, signal: delta > 0 ? "growing" : "unknown" };
  }
  const rate = delta / earliest;
  if (rate >= 0.1) {
    return { delta, signal: "growing" };
  }
  if (rate <= -0.1) {
    return { delta, signal: "shrinking" };
  }
  return { delta, signal: "flat" };
}

/** 사업장 이름 → 최근 N개월 가입자 추이. 키 없음·결과 없음·HTTP 오류 → null. */
export async function fetchNpsWorkplace(
  query: { name: string; businessNumber?: string | null },
  options: { months?: number; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<NpsWorkplace | null> {
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  const searchName = query.name
    .replaceAll(/\(주\)|㈜|（주）|주식회사/g, "")
    .trim();
  if (!(key && searchName)) {
    return null;
  }
  const call = (op: string, params: Record<string, string>) =>
    fetchJson(
      `nps-${op}`,
      `${BASE}/${op}?${new URLSearchParams({ serviceKey: key, dataType: "json", ...params })}`,
      { signal: options.signal },
      options.timeoutMs
    );

  const searchParams: Record<string, string> = {
    wkplNm: searchName,
    pageNo: "1",
    numOfRows: "100",
  };
  const bizNo = normalizeBizNo(query.businessNumber);
  if (bizNo) {
    searchParams.bzowrRgstNo = bizNo.slice(0, 6);
  }
  const search = await call("getBassInfoSearchV2", searchParams);
  if (!search.ok) {
    return null;
  }
  const rows = parseNpsSearch(search.body, query);
  const latest = rows[0];
  if (!latest) {
    return null;
  }

  // 달마다 첫 행 1개(지점이 여러 개면 첫 행) — 최근 N개월
  const byMonth = new Map<string, NpsSnapshotRow>();
  for (const row of rows) {
    if (!byMonth.has(row.month)) {
      byMonth.set(row.month, row);
    }
  }
  const picked = [...byMonth.values()].slice(0, options.months ?? 6);

  const details = await Promise.all(
    picked.map(async (row) => {
      const [detail, period] = await Promise.all([
        call("getDetailInfoSearchV2", { seq: row.seq }),
        call("getPdAcctoSttusInfoSearchV2", {
          seq: row.seq,
          dataCrtYm: row.month,
        }),
      ]);
      return {
        detail: detail.ok ? parseNpsDetail(detail.body) : null,
        period: period.ok ? parseNpsPeriod(period.body) : null,
        row,
      };
    })
  );
  const months: NpsMonth[] = details.map(({ detail, period, row }) => ({
    lost: period?.lost ?? null,
    members: detail?.members ?? null,
    month: row.month,
    newlyEnrolled: period?.newlyEnrolled ?? null,
  }));
  const head = details[0]?.detail ?? null;
  return {
    address: latest.address,
    growth: growthSignal(months),
    industry: head?.industry ?? null,
    months,
    name: latest.name,
    registeredOn: head?.registeredOn ?? null,
    workplacesInLatestMonth: rows.filter((r) => r.month === latest.month)
      .length,
  };
}
