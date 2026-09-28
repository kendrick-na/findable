// 공식 사이트에서 읽은 브랜드 표기 → 판정용 별칭 (2026-09-28)
//
// 문제: knowverse.net 의 og:site_name 이 "KNOWVERSE" 인데 brandVariants 가 비어
//   있었다. 그래서 영어 답변의 "KNOWVERSE" 는 언급 후보조차 되지 못했고, 영어
//   질문은 "What does 노우버스 offer" 처럼 한글 이름을 그대로 넣어 물었다.
// 원칙: **공식 사이트가 스스로 쓰는 표기 + 등록 도메인의 이름 부분**만 쓴다.
//   추측(번역·로마자 변환)은 하지 않는다. 사이트명·제목 조각은 도메인 이름과
//   글자가 같을 때만 채택한다 — "Home"·"We Create the Future" 같은 문구는 버린다.
//
// ⚠️ 이 파일은 순수 함수만 둔다. brand-identity.ts 는 import 시점에 모델 키를
//   읽는 ./models 를 끌어와 테스트에서 쓸 수 없다.

import { getDomain } from "tldts";

const PROTOCOL_RE = /^https?:\/\//;
const WWW_RE = /^www\./;
const TITLE_SEPARATOR_RE = /\s*[|·•—–:]\s*|\s+-\s+/;
const LATIN_NAME_RE = /^[A-Za-z][A-Za-z0-9 .&'+-]*$/;
const STEM_RE = /^[a-z][a-z0-9-]{4,}$/;
const MAX_ALIAS_LENGTH = 40;
const PATH_SPLIT_RE = /[/?#]/;
const UPPERCASE_RE = /[A-Z]/;
const NON_IDENTITY_CHAR_RE = /[^a-z0-9가-힣]/g;

function compact(value: string): string {
  return value.toLowerCase().replace(NON_IDENTITY_CHAR_RE, "");
}

/** 등록 도메인의 이름 부분(knowverse.net → knowverse). 너무 짧으면 null. */
export function domainStem(domain: string): string | null {
  const host = (
    domain
      .trim()
      .replace(PROTOCOL_RE, "")
      .replace(WWW_RE, "")
      .split(PATH_SPLIT_RE)[0] ?? ""
  ).toLowerCase();
  const registrable = getDomain(host, { allowPrivateDomains: true });
  const stem = registrable?.split(".")[0] ?? "";
  // 4글자 이하("toss", "kia")는 일반 단어·부분 문자열 오탐이 크다.
  return STEM_RE.test(stem) ? stem : null;
}

/**
 * 공식 사이트가 스스로 쓰는 표기 중 도메인 이름과 같은 것 + 도메인 이름 자체.
 * 반환 순서 = 표시용 표기 우선(대문자 포함 원문), 그다음 소문자 도메인 이름.
 * 대소문자만 다른 중복은 하나로 합친다(언급 탐지가 대소문자를 가리지 않는다).
 */
export function officialSiteAliases(
  domain: string,
  site: { siteName?: string | null; title?: string | null } | null | undefined
): string[] {
  const stem = domainStem(domain);
  if (!stem) {
    return [];
  }
  const target = compact(stem);
  const candidates = [
    site?.siteName ?? "",
    ...(site?.title ?? "").split(TITLE_SEPARATOR_RE),
  ]
    .map((value) => value.trim())
    .filter(
      (value) =>
        value.length > 0 &&
        value.length <= MAX_ALIAS_LENGTH &&
        compact(value) === target
    );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...candidates, stem]) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/**
 * 영어 질문에 넣을 이름. 대표명이 이미 로마자면 그대로, 아니면 로마자 별칭 중
 * 대문자가 들어간 표시용 표기를 우선한다. 없으면 대표명(기존 동작) 그대로.
 */
export function englishPromptName(
  brandName: string,
  variants: readonly string[]
): string {
  if (LATIN_NAME_RE.test(brandName.trim())) {
    return brandName;
  }
  const latin = variants
    .map((value) => value.trim())
    .filter((value) => LATIN_NAME_RE.test(value));
  return (
    latin.find((value) => UPPERCASE_RE.test(value)) ?? latin[0] ?? brandName
  );
}
