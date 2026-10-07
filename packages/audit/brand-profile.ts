// 브랜드 프로필 — 측정 질문의 재료 (2026-10-07, 질문 체계 v2 A1 · 대표 결정)
//
// 왜: 측정 질문은 「이 브랜드가 실제로 파는 것」 위에 서야 한다. 화장품만이 아니라 **어느 업종이든**
//   공식 사이트에서 상품·서비스·카테고리를 읽어 프로필로 만들고, 그 낱말로 검색 키워드를 거른다.
//
// 출처 우선순위(앞에서 찾으면 뒤로 가지 않는다 — 대표 결정 2026-10-07)
//   1. 공식 사이트 — 쇼핑몰 상품 목록(brand-catalog) + 서비스·B2B 사이트 구조(메뉴·서비스 페이지·제목)
//   2. 사이트를 못 읽으면 — 고객이 입력한 상품 + 등록 업종(Findable 11개 업종)
//   3. 그래도 없으면 — 공식 사이트 문구(제목·설명 조각)
//   4. 아무것도 없으면 — 이름 없는 질문 0개(측정 맥락에 사유를 남긴다)
// 고객이 입력한 상호·사업자번호는 값이 아니라 **출처만** 프로필에 남긴다(공개 결과에 값 중복 저장 금지).
//
// 이 파일은 순수 함수만 둔다(네트워크는 brand-profile-live.ts).

import {
  compactTerm,
  isOtherSenseTerm,
  isQualifierTerm,
  offeringTokens,
  type ProfileTerms,
  profileTermsFromNames,
} from "./keyword-relevance";

/** Findable 등록 업종(Prisma `Industry`) — 패키지 의존 없이 문자열로 받는다. */
export type BrandIndustry =
  | "beauty"
  | "fashion"
  | "food"
  | "b2b_saas"
  | "content_ip"
  | "retail"
  | "finance"
  | "healthcare"
  | "education"
  | "manufacturing"
  | "other";

export const BRAND_INDUSTRIES: readonly BrandIndustry[] = [
  "beauty",
  "fashion",
  "food",
  "b2b_saas",
  "content_ip",
  "retail",
  "finance",
  "healthcare",
  "education",
  "manufacturing",
  "other",
];

/** 상품을 사고파는 업종(질문 말투가 「제품」 쪽). 나머지는 「서비스·업체」 쪽. */
const COMMERCE_INDUSTRIES = new Set<BrandIndustry>([
  "beauty",
  "fashion",
  "food",
  "retail",
]);

/**
 * 사이트를 못 읽었을 때만 쓰는 업종 대표 카테고리(검색량 조회 씨앗).
 * 업종 「이름」일 뿐 성분·제형 사전이 아니다. other 는 없다(지어내지 않는다).
 */
const INDUSTRY_SEED: Record<BrandIndustry, { en: string[]; ko: string[] }> = {
  beauty: { ko: ["스킨케어 화장품"], en: ["skincare products"] },
  fashion: { ko: ["여성 의류", "남성 의류"], en: ["clothing brand"] },
  food: { ko: ["건강 식품"], en: ["food brand"] },
  b2b_saas: { ko: ["업무 솔루션", "B2B 솔루션"], en: ["B2B software"] },
  content_ip: { ko: ["콘텐츠 제작"], en: ["content production"] },
  retail: { ko: ["온라인 쇼핑몰"], en: ["online store"] },
  finance: { ko: ["금융 서비스"], en: ["financial services"] },
  healthcare: { ko: ["병원 진료"], en: ["medical clinic"] },
  education: { ko: ["온라인 교육"], en: ["online course"] },
  manufacturing: { ko: ["부품 제조"], en: ["parts manufacturing"] },
  other: { ko: [], en: [] },
};

export type OfferingSource =
  | "catalog"
  | "service_page"
  | "site_heading"
  | "site_title"
  | "site_nav"
  | "customer"
  | "industry"
  | "site_text";

export interface ProfileOffering {
  /** 「en」 = 사이트 영어 페이지에서 읽은 이름(미국 질문 재료). */
  lang: "ko" | "en";
  /** 원문 이름(브랜드 이름 포함 가능 — 질문에 쓰기 전 반드시 걸러진다). */
  name: string;
  price?: number | null;
  source: OfferingSource;
  url?: string;
}

export type ProfileLevel = "site" | "customer_industry" | "site_text" | "none";

export interface BrandProfile {
  /** commerce = 상품 질문 말투, service = 업체·서비스 말투. */
  businessType: "commerce" | "service";
  /** 고객 입력·푸터에서 상호/사업자번호를 확인했는지(값은 저장하지 않는다). */
  identity: {
    businessNumber: "customer" | "footer" | null;
    legalName: "customer" | "footer" | null;
  };
  industry: BrandIndustry | null;
  level: ProfileLevel;
  offerings: ProfileOffering[];
  /** 실제로 재료를 준 출처(진단·측정 맥락 기록용). */
  sources: OfferingSource[];
  version: 1;
}

export interface ProfileInputs {
  catalog: ReadonlyArray<{
    name: string;
    price?: number | null;
    url?: string;
  }>;
  customerIdentity?: {
    businessNumber?: string | null;
    legalName?: string | null;
  } | null;
  customerProducts?: readonly string[];
  footerIdentity?: {
    businessNumber?: string | null;
    legalName?: string | null;
  } | null;
  industry?: string | null;
  siteOfferings: readonly ProfileOffering[];
  /** 공식 사이트 문구에서 읽은 카테고리 조각(`siteCategoryTerms`). */
  siteTextTerms: readonly string[];
}

export function normalizeIndustry(
  value: string | null | undefined
): BrandIndustry | null {
  return BRAND_INDUSTRIES.includes(value as BrandIndustry)
    ? (value as BrandIndustry)
    : null;
}

const MIN_COMMERCE_PRODUCTS = 3;
const HANGUL_RE = /[가-힣]/;
const LATIN_ONLY_RE = /^[a-z0-9]+$/;

function dedupeOfferings(list: ProfileOffering[]): ProfileOffering[] {
  const seen = new Set<string>();
  return list.filter((o) => {
    const key = `${o.lang}|${o.name.toLowerCase().replace(/\s+/g, "")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** 출처 우선순위대로 프로필을 정한다(앞에서 찾으면 뒤로 가지 않는다). */
export function buildBrandProfile(input: ProfileInputs): BrandProfile {
  const industry = normalizeIndustry(input.industry);
  const catalog: ProfileOffering[] = input.catalog.map((p) => ({
    name: p.name,
    lang: "ko",
    source: "catalog",
    ...(p.price === undefined ? {} : { price: p.price }),
    ...(p.url ? { url: p.url } : {}),
  }));
  // 쇼핑몰(상품 3개 이상)은 상품 목록이 1차 재료다. 사이트 구조에서는 메뉴의 카테고리 이름만 더한다
  //   (쇼핑몰 템플릿의 소제목·안내 페이지는 상품 이름이 아니다).
  const siteExtra =
    catalog.length >= MIN_COMMERCE_PRODUCTS
      ? input.siteOfferings.filter((o) => o.source === "site_nav")
      : input.siteOfferings;
  const site = dedupeOfferings([...catalog, ...siteExtra]);
  let level: ProfileLevel = "none";
  let offerings: ProfileOffering[] = [];
  if (site.length > 0) {
    level = "site";
    offerings = site;
  } else {
    const customer: ProfileOffering[] = (input.customerProducts ?? [])
      .map((name) => name.trim())
      .filter((name) => name.length >= 2)
      .map((name) => ({ name, lang: "ko", source: "customer" }));
    const seeds = industry ? INDUSTRY_SEED[industry] : { ko: [], en: [] };
    const fromIndustry: ProfileOffering[] = [
      ...seeds.ko.map((name) => ({
        name,
        lang: "ko" as const,
        source: "industry" as const,
      })),
      ...seeds.en.map((name) => ({
        name,
        lang: "en" as const,
        source: "industry" as const,
      })),
    ];
    if (customer.length + fromIndustry.length > 0) {
      level = "customer_industry";
      offerings = dedupeOfferings([...customer, ...fromIndustry]);
    } else if (input.siteTextTerms.length > 0) {
      level = "site_text";
      offerings = dedupeOfferings(
        input.siteTextTerms.map((name) => ({
          name,
          lang: HANGUL_RE.test(name) ? ("ko" as const) : ("en" as const),
          source: "site_text" as const,
        }))
      );
    }
  }
  const commerceByCatalog = catalog.length >= MIN_COMMERCE_PRODUCTS;
  const commerceByIndustry =
    industry !== null &&
    COMMERCE_INDUSTRIES.has(industry) &&
    !offerings.some((o) => o.source === "service_page");
  const pick = (
    customer: string | null | undefined,
    footer: string | null | undefined
  ): "customer" | "footer" | null => {
    if (customer?.trim()) {
      return "customer";
    }
    return footer?.trim() ? "footer" : null;
  };
  return {
    version: 1,
    industry,
    level,
    businessType:
      commerceByCatalog || commerceByIndustry ? "commerce" : "service",
    offerings,
    sources: [...new Set(offerings.map((o) => o.source))],
    identity: {
      legalName: pick(
        input.customerIdentity?.legalName,
        input.footerIdentity?.legalName
      ),
      businessNumber: pick(
        input.customerIdentity?.businessNumber,
        input.footerIdentity?.businessNumber
      ),
    },
  };
}

/** 시장별 프로필 낱말. 미국 질문은 영어 이름 + 영문 낱말만 재료로 쓴다(번역하지 않는다). */
export function profileTermsFor(
  profile: BrandProfile,
  lang: "ko" | "en",
  brandNames: readonly string[]
): ProfileTerms {
  const namesIn = (l: "ko" | "en") =>
    profile.offerings.filter((o) => o.lang === l).map((o) => o.name);
  if (lang === "ko") {
    return profileTermsFromNames(namesIn("ko"), brandNames);
  }
  // 영어: 영어 페이지 이름 + 한글 이름 속 영문 낱말(PDRN·EGF·CTO·TechDD)만. 번역하지 않는다.
  const terms = profileTermsFromNames(namesIn("en"), brandNames);
  for (const name of namesIn("ko")) {
    const tokens = offeringTokens(name, brandNames);
    for (const t of [
      ...tokens.modifiers,
      ...tokens.aliases,
      ...(tokens.head ? [tokens.head] : []),
    ]) {
      if (LATIN_ONLY_RE.test(t.compact) && !terms.modifiers.has(t.compact)) {
        terms.modifiers.set(t.compact, { display: t.display });
      }
    }
  }
  return {
    ...terms,
    profileText: [terms.profileText, ...namesIn("ko").map(compactTerm)].join(
      "|"
    ),
  };
}

const WORD_RE = /\s+/;
const LATIN_WORD_RE = /^[a-z][a-z-]{3,}$/;
const LATIN_TOKEN_RE = /^[a-z0-9]+$/;
// 영어 head 가 아닌 낱말(의도·수식·과학 용어). 업종 사전이 아니라 영어 검색어의 공통 꼬리다.
const EN_NON_HEAD = new Set([
  "best",
  "top",
  "good",
  "for",
  "the",
  "and",
  "with",
  "benefits",
  "benefit",
  "review",
  "reviews",
  "price",
  "pricing",
  "cost",
  "cheap",
  "near",
  "korean",
  "results",
  "online",
  "free",
  "guide",
  "meaning",
  "factor",
  "factors",
  "growth",
  "receptor",
  "level",
  "levels",
  "test",
  "services",
  "service",
  "company",
  "companies",
  "salary",
  "jobs",
  "course",
  "courses",
  "certification",
  "tool",
  "tools",
  "chat",
  "chatbot",
  "generator",
  "app",
  "apps",
  "software",
  "officer",
  "officers",
  "role",
  "roles",
  "responsibilities",
  "definition",
  "treatment",
  "treatments",
]);
/** 영어 head 후보로 인정하는 최소 출현 수(서로 다른 키워드). */
const EN_HEAD_MIN = 2;
/** head 를 찾는 데 쓰는 영문 낱말의 최소 길이 — 「ai」「it」처럼 짧은 낱말은 아무 말과 붙어 나온다. */
const EN_HEAD_ANCHOR_MIN = 3;

/**
 * 영어 head 를 **검색 데이터에서** 찾는다(번역 사전 없음).
 * 프로필 영문 낱말(3자 이상, 「pdrn」「egf」) **바로 뒤의 끝 낱말**이 서로 다른 키워드 2개 이상에서
 * 반복되면 head 로 본다(「pdrn serum」「best pdrn serum」 → serum). 「for …」 앞까지만 본다.
 */
export function discoverEnglishHeads(
  terms: ProfileTerms,
  keywords: readonly string[]
): ProfileTerms {
  const anchors = [...terms.modifiers.keys()].filter(
    (k) => LATIN_TOKEN_RE.test(k) && k.length >= EN_HEAD_ANCHOR_MIN
  );
  if (anchors.length === 0) {
    return terms;
  }
  const counts = new Map<string, Set<string>>();
  for (const keyword of keywords) {
    const all = keyword.toLowerCase().split(WORD_RE).filter(Boolean);
    const forAt = all.indexOf("for");
    const words = forAt > 0 ? all.slice(0, forAt) : all;
    // 끝 낱말만 본다(「pdrn salmon dna」의 salmon 은 상품 이름이 아니다).
    const i = words.length - 2;
    if (i >= 0) {
      const next = words[i + 1] as string;
      if (
        anchors.includes(words[i] as string) &&
        LATIN_WORD_RE.test(next) &&
        !EN_NON_HEAD.has(next) &&
        !isOtherSenseTerm(next) &&
        !isQualifierTerm(next) &&
        !anchors.includes(next)
      ) {
        const seen = counts.get(next) ?? new Set<string>();
        seen.add(keyword.toLowerCase());
        counts.set(next, seen);
      }
    }
  }
  const heads = new Map(terms.heads);
  for (const [word, seen] of counts) {
    if (seen.size >= EN_HEAD_MIN && !heads.has(word)) {
      heads.set(word, { count: seen.size, display: word });
    }
  }
  return { ...terms, heads };
}

const KR_SEED_LIMIT = 15;
const US_SEED_LIMIT = 10;
const MAX_SEED_WORDS = 3;

/**
 * 검색량 조회 씨앗(네이버는 공백 없는 힌트만 받는다).
 *   ① 메뉴 카테고리 이름(쇼핑몰이 직접 고른 분류)  ② 짧은 상품·서비스 이름(3낱말 이하) 그대로
 *   ③ 긴 이름은 수식어 하나 + head 쌍(「펩타이드패치」「EGF앰플」)  ④ head 단독(「앰플」)
 * 미국은 영어 페이지 이름 + 영문 낱말(3자 이상). 마지막에 브랜드 이름(참고값)을 덧붙인다.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: seed order (menu → short names → pairs → heads) is one readable pass.
export function profileSeedKeywords(
  profile: BrandProfile,
  brandNames: { en?: string | null; ko: string; variants?: readonly string[] }
): { KR: string[]; US: string[] } {
  const allNames = [
    brandNames.ko,
    brandNames.en ?? "",
    ...(brandNames.variants ?? []),
  ].filter((n) => n.trim().length >= 2);
  const kr: string[] = [];
  const us: string[] = [];
  const push = (list: string[], value: string, limit: number) => {
    const v = value.trim();
    if (v.length >= 2 && !list.includes(v) && list.length < limit) {
      list.push(v);
    }
  };
  const ordered = [
    ...profile.offerings.filter((o) => o.source === "site_nav"),
    ...profile.offerings.filter((o) => o.source !== "site_nav"),
  ];
  const pairs: string[] = [];
  const headCounts = new Map<string, number>();
  for (const offering of ordered) {
    const tokens = offeringTokens(offering.name, allNames);
    if (!tokens.head) {
      continue;
    }
    const words = [
      ...tokens.modifiers.map((m) => m.display),
      tokens.head.display,
    ];
    if (offering.lang === "ko") {
      if (words.length <= MAX_SEED_WORDS) {
        push(kr, words.join(""), KR_SEED_LIMIT);
      }
      for (const m of tokens.modifiers) {
        pairs.push(`${m.display}${tokens.head.display}`);
      }
      headCounts.set(
        tokens.head.display,
        (headCounts.get(tokens.head.display) ?? 0) + 1
      );
      for (const t of [...tokens.modifiers, ...tokens.aliases, tokens.head]) {
        if (LATIN_TOKEN_RE.test(t.compact) && t.compact.length >= 3) {
          push(us, t.compact, US_SEED_LIMIT);
        }
      }
    } else if (words.length <= MAX_SEED_WORDS + 1) {
      push(us, words.join(" ").toLowerCase(), US_SEED_LIMIT);
    }
  }
  for (const pair of pairs) {
    push(kr, pair, KR_SEED_LIMIT);
  }
  for (const [head] of [...headCounts].sort((a, b) => b[1] - a[1])) {
    push(kr, head, KR_SEED_LIMIT);
  }
  if (brandNames.ko) {
    kr.push(brandNames.ko.replace(/\s+/g, ""));
  }
  if (brandNames.en) {
    us.push(brandNames.en.toLowerCase());
  }
  return { KR: kr, US: us };
}
