import "server-only";

import { normalizeBizNo, normalizeCorpName } from "./http";

/**
 * 회사 동일성 대조 — 「목록·엑스포에 나온 그 회사」 = 「DART가 확정한 그 회사」인가.
 *
 * 왜: 이름이 같은 다른 회사에 매출을 붙이면 영업 메일에 틀린 숫자가 들어간다(사실 규칙).
 *     DART 조회는 이름 글자 일치만 쓰므로, 근거를 따로 모아 등급을 정한다.
 * 근거(약 → 강): 이름 일치 → 소재지 일치 → **홈페이지에 적힌 사업자등록번호 = DART 사업자번호**.
 * 등급: confirmed(홈페이지 번호 일치) · probable(이름+소재지, 홈페이지 번호 없음) ·
 *       name_only(이름만 / 소재지 충돌) · mismatch(번호 충돌·이름 불일치).
 * 규칙: 영업 문서에 매출 숫자를 쓰는 것은 confirmed 뿐(`revenueAllowed`). 나머지는 「확인 필요」.
 */

export type IdentityLevel = "confirmed" | "probable" | "name_only" | "mismatch";

export type IdentityReason =
  | "name_match"
  | "name_conflict"
  | "region_match"
  | "region_conflict"
  | "homepage_biz_no_match"
  | "homepage_biz_no_conflict";

export interface IdentityVerdict {
  level: IdentityLevel;
  reasons: IdentityReason[];
}

/** 사업자등록번호 라벨 옆의 번호만 읽는다. 전화번호·통신판매업 번호·우편번호는 읽지 않는다. */
const BIZ_LABEL_RE =
  /(?:사업자\s*등록\s*번호|사업자\s*번호|business\s*registration\s*(?:no\.?|number)|biz\.?\s*reg\.?\s*no\.?)\s*[:：]?\s*(\d{3})[\s.-]?(\d{2})[\s.-]?(\d{5})(?!\d)/gi;

export function extractBizNumbers(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(BIZ_LABEL_RE)) {
    const bizNo = normalizeBizNo(`${match[1]}${match[2]}${match[3]}`);
    if (bizNo) {
      found.add(bizNo);
    }
  }
  return [...found];
}

const REGION_WORD_RE = /[가-힣]{2,}(?:특별시|광역시|특별자치시|시|군|구)?/g;
const REGION_SUFFIX_RE = /(특별시|광역시|특별자치시|시|군|구)$/;

/** 지역 비교용 — 「청주시」「청주」「충청북도 청주시 흥덕구」를 같은 시·군 토큰으로 본다. */
function regionTokens(value: string): string[] {
  return (value.match(REGION_WORD_RE) ?? [])
    .map((token) => token.replace(REGION_SUFFIX_RE, ""))
    .filter((token) => token.length >= 2);
}

/** 목록에 「미확인」 같은 자리표시자가 들어와도 소재지로 읽지 않는다(가짜 충돌 방지). */
const NO_REGION_RE = /^(?:미확인|확인\s*필요|없음|해당\s*없음|n\/a|-|—)$/i;

function regionMatches(expo: string, address: string): boolean | null {
  if (NO_REGION_RE.test(expo.trim())) {
    return null;
  }
  const a = regionTokens(expo);
  const b = new Set(regionTokens(address));
  if (a.length === 0 || b.size === 0) {
    return null;
  }
  return a.some((token) => b.has(token));
}

export function judgeIdentity(input: {
  dart: { address?: string | null; bizNo: string | null; name: string };
  expoName: string;
  /** 목록에 적힌 소재지(확인분만, 없으면 생략) */
  expoRegion?: string | null;
  /** 공식 홈페이지에서 읽은 사업자등록번호들(못 읽었으면 빈 배열) */
  homepageBizNos: readonly string[];
}): IdentityVerdict {
  const reasons: IdentityReason[] = [];
  if (
    normalizeCorpName(input.expoName) !== normalizeCorpName(input.dart.name)
  ) {
    return { level: "mismatch", reasons: ["name_conflict"] };
  }
  reasons.push("name_match");

  const dartBiz = normalizeBizNo(input.dart.bizNo);
  if (dartBiz && input.homepageBizNos.length > 0) {
    if (input.homepageBizNos.includes(dartBiz)) {
      return {
        level: "confirmed",
        reasons: [...reasons, "homepage_biz_no_match"],
      };
    }
    return {
      level: "mismatch",
      reasons: [...reasons, "homepage_biz_no_conflict"],
    };
  }

  const region = input.expoRegion
    ? regionMatches(input.expoRegion, input.dart.address ?? "")
    : null;
  if (region === true) {
    return { level: "probable", reasons: [...reasons, "region_match"] };
  }
  if (region === false) {
    return { level: "name_only", reasons: [...reasons, "region_conflict"] };
  }
  return { level: "name_only", reasons };
}

/** 영업 문서(메일·리포트)에 매출 숫자를 써도 되는 등급인가. */
export function revenueAllowed(level: IdentityLevel): boolean {
  return level === "confirmed";
}
