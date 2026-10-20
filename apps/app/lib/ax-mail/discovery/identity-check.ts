import { type IdentityLevel, judgeIdentity } from "../sources/company-identity";
import type { FactInput, FactValue } from "./ingest";

/**
 * 동일성 대조 결과를 CompanyFact 한 줄(field "identity")로 저장·읽기.
 * DB 구조 변경 없음. 사업자번호는 끝 4자리만 저장한다(전체 번호 저장 금지).
 * 멱등 키 (companyId, field, source, asOf) — 같은 날 재확인은 갱신.
 */

export const IDENTITY_FIELD = "identity";
export const IDENTITY_SOURCE = "identity_check";

export type IdentityState =
  | "unchecked"
  | "confirmed"
  | "probable"
  | "name_only"
  | "mismatch";

export interface IdentityCheckResult {
  dartBizNoTail4: string | null;
  dartCorpCode: string;
  homepageBizNoTails: string[];
  homepageStatus: "ok" | "none" | "unavailable" | "refused";
  level: Exclude<IdentityState, "unchecked">;
  pagesRead: number;
  reasons: string[];
}

/** 사업자번호 → 끝 4자리. 값이 없거나 짧으면 null. */
export function tailOf(bizNo: string | null | undefined): string | null {
  const digits = (bizNo ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** 저장할 identity 사실 한 줄. 전체 사업자번호는 넣지 않는다. */
export function identityFactFor(
  result: IdentityCheckResult,
  checkedOn: string,
  fetchedAt: Date
): FactInput {
  const value: FactValue = {
    dartBizNoTail4: result.dartBizNoTail4,
    homepageBizNoTail4: result.homepageBizNoTails,
    homepageStatus: result.homepageStatus,
    level: result.level,
    pagesRead: result.pagesRead,
    reasons: result.reasons,
  };
  return {
    asOf: checkedOn,
    fetchedAt,
    field: IDENTITY_FIELD,
    source: IDENTITY_SOURCE,
    sourceRef: result.dartCorpCode,
    value,
  };
}

/** 저장된 identity 사실들 중 가장 최근 것의 등급. 없으면 unchecked(대조 전). */
export function identityStateOf(
  facts: readonly {
    field: string;
    source: string;
    asOf: string;
    value: unknown;
  }[]
): IdentityState {
  const mine = facts
    .filter((f) => f.field === IDENTITY_FIELD && f.source === IDENTITY_SOURCE)
    .sort((a, b) => b.asOf.localeCompare(a.asOf));
  const latest = mine[0];
  if (!latest) {
    return "unchecked";
  }
  const level = (latest.value as { level?: unknown } | null)?.level;
  return level === "confirmed" ||
    level === "probable" ||
    level === "name_only" ||
    level === "mismatch"
    ? level
    : "unchecked";
}

/** 화면 표시용 키 — 문구는 i18n 사전(salesDiscover.identity)에서 고른다. */
export function identityLabelKey(state: IdentityState): IdentityState {
  return state;
}

export interface HomepageRead {
  bizTails: string[];
  pagesRead: number;
  status: "ok" | "none" | "unavailable" | "refused";
}

/**
 * 회사 한 곳 대조 — 홈페이지 읽기·판정·저장을 주입받아 실행한다(외부 호출은 호출하는 쪽 책임).
 * 홈페이지에서 사업자번호를 찾으면 읽기를 멈춘다(readHomepage 가 stopWhen 으로 처리).
 */
export async function checkOneIdentity(deps: {
  checkedOn: string;
  dart: { bizNo: string | null; corpCode: string };
  fetchedAt: Date;
  judge: (homepageBizTails: string[]) => {
    level: IdentityCheckResult["level"];
    reasons: string[];
  };
  readHomepage: () => Promise<HomepageRead>;
  save: (fact: FactInput) => Promise<void>;
}): Promise<IdentityCheckResult> {
  const home = await deps.readHomepage();
  const verdict = deps.judge(home.bizTails);
  const result: IdentityCheckResult = {
    dartBizNoTail4: tailOf(deps.dart.bizNo),
    dartCorpCode: deps.dart.corpCode,
    homepageBizNoTails: home.bizTails,
    homepageStatus: home.status,
    level: verdict.level,
    pagesRead: home.pagesRead,
    reasons: verdict.reasons,
  };
  await deps.save(identityFactFor(result, deps.checkedOn, deps.fetchedAt));
  return result;
}

/** 홈페이지 읽기 결과(contact-email 의 상태)를 저장용 상태로 바꾼다. */
export function toHomepageStatus(
  status: "ok" | "blocked_by_robots" | "refused" | "unavailable" | "skipped"
): HomepageRead["status"] {
  if (status === "ok") {
    return "ok";
  }
  if (status === "refused" || status === "blocked_by_robots") {
    return "refused";
  }
  return "unavailable";
}

/** judgeIdentity 를 저장 모듈에서 부르는 얇은 래퍼(등급·사유만 돌려준다). */
function judgeIdentityLazy(input: {
  dartBizNo: string | null;
  expoName: string;
  homepageBizNos: readonly string[];
}): { level: IdentityLevel; reasons: string[] } {
  const v = judgeIdentity({
    dart: { bizNo: input.dartBizNo, name: input.expoName },
    expoName: input.expoName,
    homepageBizNos: input.homepageBizNos,
  });
  return { level: v.level, reasons: v.reasons };
}

export type CompanyIdentityOutcome =
  | { kind: "no_dart" }
  | { kind: "no_revenue" }
  | { kind: "ok"; level: IdentityCheckResult["level"]; pagesRead: number };

/**
 * 회사 한 곳 대조의 전체 흐름(순수 함수). 매출이 확인된 회사만, DART 고유번호가 있을 때만 대조한다.
 * 홈페이지 읽기(readHomepageNumbers)는 호출하는 쪽이 준다 — 번호는 전체로 읽되 저장은 끝 4자리만.
 */
export async function runCompanyIdentityCheck(input: {
  checkedOn: string;
  company: {
    businessNumber: string | null;
    dartCorpCode: string | null;
    legalName: string;
  };
  fetchedAt: Date;
  hasRevenue: boolean;
  readHomepageNumbers: () => Promise<{
    numbers: string[];
    pagesRead: number;
    status: HomepageRead["status"];
  }>;
  save: (fact: FactInput) => Promise<void>;
}): Promise<CompanyIdentityOutcome> {
  if (!input.company.dartCorpCode) {
    return { kind: "no_dart" };
  }
  if (!input.hasRevenue) {
    return { kind: "no_revenue" };
  }
  let fullNumbers: string[] = [];
  const result = await checkOneIdentity({
    checkedOn: input.checkedOn,
    dart: {
      bizNo: input.company.businessNumber,
      corpCode: input.company.dartCorpCode,
    },
    fetchedAt: input.fetchedAt,
    judge: () => {
      const v = judgeIdentityLazy({
        dartBizNo: input.company.businessNumber,
        expoName: input.company.legalName,
        homepageBizNos: fullNumbers,
      });
      return v;
    },
    readHomepage: async () => {
      const home = await input.readHomepageNumbers();
      fullNumbers = home.numbers;
      return {
        bizTails: home.numbers
          .map((n) => tailOf(n))
          .filter((t): t is string => t !== null),
        pagesRead: home.pagesRead,
        status: home.status,
      };
    },
    save: input.save,
  });
  return { kind: "ok", level: result.level, pagesRead: result.pagesRead };
}
