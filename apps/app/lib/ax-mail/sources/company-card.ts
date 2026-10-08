import "server-only";

import { type ContactEmailResult, findContactEmails } from "./contact-email";
import { type FscCorpOutline, fetchFscCorp } from "./fsc-corp";
import { normalizeBizNo } from "./http";
import { fetchMfdsCosmetics, type MfdsPage } from "./mfds-cosmetics";
import { fetchNpsWorkplace, type NpsWorkplace } from "./nps-workplace";
import { fetchNtsStatus, type NtsStatus } from "./nts-status";
import { type DartCompany, type DartResult, fetchDart } from "./opendart";

/**
 * 회사 카드 — 무료 공공 API 5종을 합쳐 「이 회사가 누구인지」 한 장으로.
 *
 * 원칙(대표 규칙 「사실 관계 — 절대 규칙」과 같은 결):
 *  - 모든 칸은 { value, source, fetchedAt, asOf } — **어디서 언제 가져왔는지** 없이 값만 두지 않는다.
 *  - 소스가 비면 칸도 null. 다른 칸으로 추정해서 채우지 않는다(예: 직원수로 매출 추정 금지).
 *  - 매출은 DART 사업보고서에서만, 사업연도·접수번호와 함께. 비상장 중소기업은 대부분 null 이 정상이다.
 *  - 「직원수」(금융위 종업원수)와 「국민연금 가입자수」는 뜻이 달라 칸을 나눈다.
 *  - 연락처(contacts)는 도메인이 있을 때만 — 회사 홈페이지에 **공개된** 문의·제휴 메일(`./contact-email.ts`).
 *    후보마다 찾은 페이지 주소·시각이 붙는다(수신 근거 ④ public_contact 에 그대로 남긴다).
 */

export type CardSource = "nts" | "fsc" | "nps" | "mfds" | "opendart" | "input";

export interface Fact<T> {
  /** 원천 자료의 기준일(있을 때만). fetchedAt 은 「우리가 가져온 시각」 */
  asOf: string | null;
  fetchedAt: string;
  source: CardSource;
  value: T;
}

/** unavailable = 키 없음/HTTP 오류/타임아웃, no_match = 정상 응답이지만 해당 회사 없음 */
export type SourceStatus =
  | "ok"
  | "no_match"
  | "ambiguous"
  | "unavailable"
  | "skipped";

export type MatchConfidence = "exact" | "name_only" | "none";

export interface CompanyCardQuery {
  businessNumber?: string | null;
  domain?: string | null;
  name: string;
}

/** 연락처 칸 — 공개 페이지에서 찾은 회사 메일 후보(순위순, 개인정보보호책임자는 맨 뒤). */
export interface CompanyContacts extends ContactEmailResult {
  fetchedAt: string;
  source: "website";
}

export interface CompanyCard {
  address: Fact<string> | null;
  /** 국세청 상태 (계속/휴업/폐업) */
  businessStatus: Fact<{
    label: string | null;
    state: NtsStatus["state"];
    closedOn: string | null;
  }> | null;
  /** 도메인 없으면 null */
  contacts: CompanyContacts | null;
  /** 식약처 화장품 업 등록(책임판매·제조) */
  cosmeticsLicenses: Fact<
    { kind: string | null; permittedOn: string | null; region: string | null }[]
  > | null;
  /** 금융위 기업기본정보 종업원수 */
  employeeCount: Fact<number> | null;
  foundedOn: Fact<string> | null;
  homepage: Fact<string> | null;
  industry: Fact<string> | null;
  legalName: Fact<string> | null;
  listing: Fact<string> | null;
  match: { confidence: MatchConfidence; reasons: string[] };
  /** 국민연금 가입자 추이 */
  pension: Fact<
    Pick<NpsWorkplace, "growth" | "months" | "workplacesInLatestMonth">
  > | null;
  query: { businessNumber: string | null; domain: string | null; name: string };
  representative: Fact<string> | null;
  revenue: Fact<{
    amount: number;
    currency: string | null;
    fiscalYear: string;
    fsDiv: string | null;
    receiptNo: string | null;
  }> | null;
  sources: Record<Exclude<CardSource, "input">, SourceStatus>;
  taxType: Fact<string> | null;
}

/** 소스별 원 결과 — undefined = 호출 안 함, null = 사용 불가 */
export interface SourceResults {
  /** 홈페이지 공개 메일 — 도메인 있을 때만 호출 */
  contacts?: ContactEmailResult | null;
  fsc?: FscCorpOutline[] | null;
  mfds?: MfdsPage | null;
  nps?: NpsWorkplace | null;
  nts?: NtsStatus | null;
  opendart?: DartResult | null;
}

const WWW_RE = /^www\./;
const PROTOCOL_RE = /^https?:\/\//;

export function normalizeDomain(
  value: string | null | undefined
): string | null {
  if (!value) {
    return null;
  }
  const host =
    value.trim().toLowerCase().replace(PROTOCOL_RE, "").split("/")[0] ?? "";
  const bare = host.replace(WWW_RE, "");
  return bare === "" ? null : bare;
}

function fact<T>(
  value: T | null | undefined,
  source: CardSource,
  fetchedAt: string,
  asOf: string | null = null
): Fact<T> | null {
  return value === null || value === undefined
    ? null
    : { asOf, fetchedAt, source, value };
}

/** 앞에서부터 처음 값이 있는 것 — 소스 우선순위 표현용 */
function first<T>(...facts: (Fact<T> | null)[]): Fact<T> | null {
  return facts.find((f) => f !== null) ?? null;
}

/** unavailable 주의: nps·nts 는 「못 찾음」도 null 로 와서 호출 실패와 구분되지 않는다 → unavailable 로 둔다. */
function statusOf(
  value: unknown,
  ok: boolean,
  ambiguous = false
): SourceStatus {
  if (value === undefined) {
    return "skipped";
  }
  if (value === null) {
    return "unavailable";
  }
  if (ambiguous) {
    return "ambiguous";
  }
  return ok ? "ok" : "no_match";
}

interface Resolved {
  dart: DartCompany | null;
  fsc: FscCorpOutline | null;
  mfdsCount: number;
  nps: NpsWorkplace | null;
  nts: NtsStatus | null;
}

function sourceStatuses(
  results: SourceResults,
  resolved: Resolved
): CompanyCard["sources"] {
  return {
    fsc: statusOf(
      results.fsc,
      resolved.fsc !== null,
      (results.fsc?.length ?? 0) > 1
    ),
    mfds: statusOf(results.mfds, resolved.mfdsCount > 0),
    nps: statusOf(results.nps, resolved.nps !== null),
    nts: statusOf(results.nts, resolved.nts !== null),
    opendart: statusOf(
      results.opendart,
      resolved.dart !== null,
      results.opendart?.ambiguous ?? false
    ),
  };
}

function idReasons(bizNo: string, r: Resolved): string[] {
  const reasons: string[] = [];
  if (r.fsc?.bizNo === bizNo) {
    reasons.push("금융위 기업기본정보 사업자번호 일치");
  }
  if (r.dart?.bizNo === bizNo) {
    reasons.push("DART 기업개황 사업자번호 일치");
  }
  if (r.nts) {
    reasons.push("국세청 상태조회 사업자번호 확인");
  }
  if (r.mfdsCount > 0) {
    reasons.push("식약처 화장품업 사업자번호 일치");
  }
  if (r.nps) {
    reasons.push("국민연금 사업장명 + 사업자번호 앞 6자리 일치");
  }
  return reasons;
}

function nameReasons(r: Resolved): string[] {
  const reasons: string[] = [];
  if (r.fsc) {
    reasons.push("금융위 기업기본정보 법인명 일치(단일 후보)");
  }
  if (r.dart) {
    reasons.push("DART 법인명 완전일치");
  }
  if (r.nps) {
    reasons.push("국민연금 사업장명 일치");
  }
  return reasons;
}

/**
 * 매칭 신뢰도 — exact = 사업자번호가 공공 원장(금융위·DART·식약처·국세청) 중 하나와 일치,
 * name_only = 이름만 맞음(동명 회사 가능), none = 근거 없음.
 * 국민연금은 사업자번호 앞 6자리만 보여 줘서 exact 근거로 쓰지 않는다.
 */
function matchConfidence(
  input: Resolved & { bizNo: string | null; domain: string | null }
): CompanyCard["match"] {
  const { bizNo, domain } = input;
  const reasons = bizNo ? idReasons(bizNo, input) : nameReasons(input);
  const homepageDomain = normalizeDomain(
    input.dart?.homepage ?? input.fsc?.homepage ?? null
  );
  if (domain && homepageDomain === domain) {
    reasons.push("공시 홈페이지 도메인 일치");
  }
  const strongIdMatch =
    bizNo !== null &&
    (input.fsc?.bizNo === bizNo ||
      input.dart?.bizNo === bizNo ||
      input.mfdsCount > 0 ||
      input.nts !== null);
  if (strongIdMatch) {
    return { confidence: "exact", reasons };
  }
  return { confidence: reasons.length > 0 ? "name_only" : "none", reasons };
}

/** 순수 함수 — 소스 결과를 카드로 합친다. 테스트 대상. */
export function mergeCompanyCard(
  query: CompanyCardQuery,
  results: SourceResults,
  fetchedAt: string
): CompanyCard {
  const bizNo = normalizeBizNo(query.businessNumber);
  const domain = normalizeDomain(query.domain);

  // ── 소스별 상태 + 이 회사로 확정된 행 ──
  const fscRows = results.fsc;
  const fsc = fscRows && fscRows.length === 1 ? (fscRows[0] ?? null) : null;
  const dart = results.opendart?.company ?? null;
  const nts = results.nts ?? null;
  const nps = results.nps ?? null;
  const mfdsItems = (results.mfds?.items ?? []).filter((item) =>
    bizNo ? item.bizNo === bizNo : true
  );

  const sources = sourceStatuses(results, {
    dart,
    fsc,
    mfdsCount: mfdsItems.length,
    nps,
    nts,
  });
  const match = matchConfidence({
    bizNo,
    dart,
    domain,
    fsc,
    mfdsCount: mfdsItems.length,
    nps,
    nts,
  });

  const fscAsOf = fsc?.asOf ?? null;
  const latestNpsMonth = nps?.months[0]?.month ?? null;
  const npsAsOf = latestNpsMonth
    ? `${latestNpsMonth.slice(0, 4)}-${latestNpsMonth.slice(4, 6)}`
    : null;
  const revenue = results.opendart?.revenue ?? null;

  return {
    address: first(
      fact(dart?.address, "opendart", fetchedAt),
      fact(fsc?.address, "fsc", fetchedAt, fscAsOf),
      fact(nps?.address, "nps", fetchedAt, npsAsOf)
    ),
    contacts:
      domain && results.contacts !== undefined
        ? {
            ...(results.contacts ?? {
              candidates: [],
              checkedUrls: [],
              skippedReason: "unavailable",
              status: "unavailable" as const,
            }),
            fetchedAt,
            source: "website",
          }
        : null,
    businessStatus: nts
      ? fact(
          { closedOn: nts.closedOn, label: nts.stateLabel, state: nts.state },
          "nts",
          fetchedAt
        )
      : null,
    cosmeticsLicenses:
      mfdsItems.length > 0
        ? fact(
            mfdsItems.map((item) => ({
              kind: item.kind,
              permittedOn: item.permittedOn,
              region: item.region,
            })),
            "mfds",
            fetchedAt
          )
        : null,
    employeeCount: fact(fsc?.employeeCount, "fsc", fetchedAt, fscAsOf),
    foundedOn: first(
      fact(dart?.foundedOn, "opendart", fetchedAt),
      fact(fsc?.foundedOn, "fsc", fetchedAt, fscAsOf)
    ),
    homepage: first(
      fact(dart?.homepage, "opendart", fetchedAt),
      fact(fsc?.homepage, "fsc", fetchedAt, fscAsOf),
      fact(domain, "input", fetchedAt)
    ),
    industry: first(
      fact(fsc?.industry, "fsc", fetchedAt, fscAsOf),
      fact(nps?.industry, "nps", fetchedAt, npsAsOf)
    ),
    legalName: first(
      fact(dart?.name, "opendart", fetchedAt),
      fact(fsc?.name, "fsc", fetchedAt, fscAsOf),
      fact(mfdsItems[0]?.name, "mfds", fetchedAt),
      fact(nps?.name, "nps", fetchedAt, npsAsOf)
    ),
    listing: first(
      fact(dart?.corpClass, "opendart", fetchedAt),
      fact(fsc?.listedMarket, "fsc", fetchedAt, fscAsOf)
    ),
    match,
    pension: nps
      ? fact(
          {
            growth: nps.growth,
            months: nps.months,
            workplacesInLatestMonth: nps.workplacesInLatestMonth,
          },
          "nps",
          fetchedAt,
          npsAsOf
        )
      : null,
    query: { businessNumber: bizNo, domain, name: query.name.trim() },
    representative: first(
      fact(dart?.ceo, "opendart", fetchedAt),
      fact(fsc?.representative, "fsc", fetchedAt, fscAsOf)
    ),
    revenue: revenue
      ? fact(
          {
            amount: revenue.amount,
            currency: revenue.currency,
            fiscalYear: revenue.fiscalYear,
            fsDiv: revenue.fsDiv,
            receiptNo: revenue.receiptNo,
          },
          "opendart",
          fetchedAt,
          revenue.fiscalYear
        )
      : null,
    sources,
    taxType: fact(nts?.taxType, "nts", fetchedAt),
  };
}

/** 회사 카드 생성 — 소스를 병렬로 부르고, 하나가 실패해도 나머지로 채운다. */
export async function buildCompanyCard(
  query: CompanyCardQuery,
  options: { now?: Date; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<CompanyCard> {
  const now = options.now ?? new Date();
  const bizNo = normalizeBizNo(query.businessNumber);
  const domain = normalizeDomain(query.domain);
  const common = { signal: options.signal, timeoutMs: options.timeoutMs };
  const [nts, fsc, nps, mfds, opendart, contacts] = await Promise.all([
    bizNo ? fetchNtsStatus(bizNo, common) : Promise.resolve(undefined),
    fetchFscCorp({ businessNumber: bizNo, name: query.name }, common),
    fetchNpsWorkplace({ businessNumber: bizNo, name: query.name }, common),
    // 식약처는 사업자번호가 있을 때만 — 이름 검색은 동명 업체가 많다.
    bizNo
      ? fetchMfdsCosmetics({ businessNumber: bizNo }, common)
      : Promise.resolve(undefined),
    fetchDart({ businessNumber: bizNo, name: query.name }, { ...common, now }),
    domain
      ? findContactEmails({
          brandNames: [query.name],
          domain,
          signal: options.signal,
        })
      : Promise.resolve(undefined),
  ]);
  return mergeCompanyCard(
    query,
    { contacts, fsc, mfds, nps, nts, opendart },
    now.toISOString()
  );
}
