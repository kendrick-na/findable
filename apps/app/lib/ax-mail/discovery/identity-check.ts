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
