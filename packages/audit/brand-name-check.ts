/**
 * 입력 브랜드명 ↔ 공식 사이트 표기 대조 (2026-09-29).
 *
 * 🔴 실측: 00e40b02·39a89fdb 는 브랜드명 「Findable OAuth Verification」 으로 측정됐다.
 *   사이트 이름은 「Findable」 이다. AI 에게 「Findable OAuth Verification 은 어떤
 *   브랜드야?」 라고 물으면 당연히 모른다 → 「AI 가 우리를 모른다」 는 **가짜 결론**이
 *   공개 리포트에 실린다. 측정 대상 이름이 틀리면 뒤의 숫자는 전부 무의미하다.
 *
 * 판정(추측하지 않는다 — 증명 가능한 불일치만 경고):
 *   match    — 입력 이름이 사이트 제목·사이트명·H1·설명 어딘가에 그대로 있다.
 *   mismatch — 사이트가 스스로 쓰는 이름이 입력 이름의 **일부**다(이름에 단어가 붙었다),
 *              또는 둘 다 로마자인데 사이트 어디에도 입력 이름이 없다.
 *   unknown  — 한글 이름 vs 영문 사이트처럼 글자 체계가 달라 대조할 수 없다.
 *              (「인디고차일드」 ↔ 「Indigochild」 — 음역을 추측하지 않는다)
 */

import { officialSiteAliases } from "@repo/ai/lib/brand-aliases";

export interface SiteIdentityLike {
  description?: string | null;
  h1?: string | null;
  siteName?: string | null;
  title?: string | null;
}

export type BrandNameCheckStatus = "match" | "mismatch" | "unknown";

export interface BrandNameCheck {
  inputName: string;
  /** 사이트가 스스로 쓰는 이름(사이트명·제목 조각 중 도메인과 같은 것). */
  siteNames: string[];
  status: BrandNameCheckStatus;
}

const NON_IDENTITY_CHAR_RE = /[^a-z0-9가-힣]/g;
const LATIN_RE = /^[a-z0-9]+$/;

function compact(value: string): string {
  return value.toLowerCase().replace(NON_IDENTITY_CHAR_RE, "");
}

export function checkBrandNameAgainstSite(
  inputName: string,
  domain: string,
  site: SiteIdentityLike | null | undefined
): BrandNameCheck {
  const name = compact(inputName);
  // 표시용: 사이트명 원문 + 도메인과 같은 표기(대소문자 중복은 한 번만).
  const seen = new Set<string>();
  const siteNames: string[] = [];
  for (const value of [
    site?.siteName ?? "",
    ...officialSiteAliases(domain, site ?? null),
  ]) {
    const trimmed = value.trim();
    if (trimmed && !seen.has(trimmed.toLowerCase())) {
      seen.add(trimmed.toLowerCase());
      siteNames.push(trimmed);
    }
  }
  const base: Omit<BrandNameCheck, "status"> = { inputName, siteNames };
  if (!(name && site)) {
    return { ...base, status: "unknown" };
  }
  const siteText = compact(
    [site.title, site.siteName, site.h1, site.description]
      .filter(Boolean)
      .join(" ")
  );
  if (siteText.includes(name)) {
    return { ...base, status: "match" };
  }
  const aliasKeys = [
    ...new Set(
      [site.siteName ?? "", ...officialSiteAliases(domain, site)]
        .map(compact)
        .filter((key) => key.length >= 2)
    ),
  ];
  // 도메인 이름과 같은 이름(oliveyoung.co.kr ↔ "Olive Young")은 사이트 본문에 없어도 일치.
  if (aliasKeys.includes(name)) {
    return { ...base, status: "match" };
  }
  // 사이트 이름이 입력 이름 안에 들어 있고 입력 이름이 더 길다 = 단어가 덧붙었다.
  if (aliasKeys.some((key) => key !== name && name.includes(key))) {
    return { ...base, status: "mismatch" };
  }
  // 둘 다 로마자인데 사이트 어디에도 없다 = 다른 이름으로 측정했다.
  if (LATIN_RE.test(name) && aliasKeys.some((key) => LATIN_RE.test(key))) {
    return { ...base, status: "mismatch" };
  }
  return { ...base, status: "unknown" };
}
