/**
 * 발굴 분류 체계 — 순수 함수만(외부 호출 없음).
 *
 *  1) 업종: KSIC(한국표준산업분류) 코드 / 원천 업종명 / 취급품목 → Findable `Industry` 11종
 *  2) 태그: 인증(venture·innobiz·mainbiz·tips·listed …) + 고객 유형(b2b·b2c·commerce)
 *  3) 규모: 직원수 → THE VC 식 구간(1-4 / 5-9 / 10-49 / 50-99 / 100-499 / 500+)
 *  4) 지역: 주소·국민연금 시도코드 → 시·도 약칭 17종
 *  5) 도메인: 홈페이지 원문 → 자체 사이트 도메인(입점몰 주소는 분리)
 *
 * ⚠️ 혁신의숲·THE VC·넥스트유니콘은 **분류 아이디어만** 참고했다(수집 금지 — 이용약관).
 * ⚠️ KSIC 매핑은 「대분류·중분류 코드」 기준의 규칙표다. 원천 업종이 실제 사업과 다를 수 있다
 *   (실측: 국민연금 업종명이 실제 업종과 다른 사례 — 설계안 §6). 화면에서 업종 근거(basis)를 같이 보여 줄 것.
 */

/** packages/database schema 의 enum Industry 와 같은 값(2026-10-07 기준 11종). */
export const INDUSTRIES = [
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
] as const;

export type IndustryId = (typeof INDUSTRIES)[number];

export type IndustryBasis = "ksic" | "name" | "products";

export interface IndustryVerdict {
  basis: IndustryBasis | null;
  industry: IndustryId | null;
}

// ── 1. KSIC 코드 → 업종 ──────────────────────────────────────────────────────

/**
 * 접두사 규칙 — **긴 접두사가 먼저** 이긴다. 코드는 KSIC 10·11차 공통 범위만 사용.
 * (예: 20423 화장품 제조업 → beauty, 나머지 20xxx 화학 → manufacturing)
 */
const KSIC_PREFIX_RULES: [prefix: string, industry: IndustryId][] = [
  // 뷰티
  ["20423", "beauty"], // 화장품 제조업
  ["46443", "beauty"], // 화장품 및 화장용품 도매업
  ["47813", "beauty"], // 화장품, 비누 및 방향제 소매업
  ["9611", "beauty"], // 미용 관련 서비스업
  // 패션
  ["13", "fashion"], // 섬유제품 제조업
  ["14", "fashion"], // 의복·의복액세서리·모피 제조업
  ["15", "fashion"], // 가죽·가방·신발 제조업
  ["4641", "fashion"], // 섬유·의복·신발 도매업
  ["4741", "fashion"], // 섬유·의복·신발 소매업
  ["4742", "fashion"],
  // 식품
  ["01", "food"],
  ["02", "food"],
  ["03", "food"],
  ["10", "food"], // 식료품 제조업
  ["11", "food"], // 음료 제조업
  ["4631", "food"], // 곡물·농산물 도매
  ["4632", "food"], // 음·식료품 도매
  ["472", "food"], // 음·식료품 소매
  ["56", "food"], // 음식점·주점업
  // 헬스케어
  ["21", "healthcare"], // 의약품 제조업
  ["271", "healthcare"], // 의료용 기기 제조업
  ["46441", "healthcare"], // 의약품 도매업
  ["86", "healthcare"], // 보건업
  // 콘텐츠·IP
  ["581", "content_ip"], // 서적·잡지 출판
  ["5821", "content_ip"], // 게임 소프트웨어 개발·공급
  ["59", "content_ip"], // 영상·오디오
  ["60", "content_ip"], // 방송
  ["90", "content_ip"], // 창작·예술
  // IT·SaaS
  ["582", "b2b_saas"], // 소프트웨어 개발·공급(게임 제외 — 위 5821 이 먼저)
  ["62", "b2b_saas"], // 프로그래밍·시스템 통합
  ["63", "b2b_saas"], // 정보서비스
  // 금융
  ["64", "finance"],
  ["65", "finance"],
  ["66", "finance"],
  // 교육
  ["85", "education"],
  // 유통
  ["45", "retail"],
  ["46", "retail"],
  ["47", "retail"],
];

/** 제조업 대분류(C) — 위 규칙에 안 걸린 10~34 */
const MANUFACTURING_RANGE = { from: 10, to: 34 };

const KSIC_RULES_SORTED = [...KSIC_PREFIX_RULES].sort(
  (a, b) => b[0].length - a[0].length
);

const NON_DIGIT_RE = /\D/g;

export function industryFromKsic(
  code: string | null | undefined
): IndustryId | null {
  const digits = (code ?? "").replaceAll(NON_DIGIT_RE, "");
  if (digits.length < 2) {
    return null;
  }
  for (const [prefix, industry] of KSIC_RULES_SORTED) {
    if (digits.startsWith(prefix)) {
      return industry;
    }
  }
  const division = Number(digits.slice(0, 2));
  if (
    division >= MANUFACTURING_RANGE.from &&
    division <= MANUFACTURING_RANGE.to
  ) {
    return "manufacturing";
  }
  return "other";
}

// ── 2. 업종명·취급품목(한국어) → 업종 ────────────────────────────────────────

/** 순서가 곧 우선순위다(「화장품 제조업」은 manufacturing 보다 beauty 가 먼저). */
const NAME_RULES: [RegExp, IndustryId][] = [
  [/화장품|코스메틱|뷰티|미용|피부|네일|향수|방향제/, "beauty"],
  [
    /게임|영상|방송|출판|간행물|콘텐츠|컨텐츠|음악|음반|공연|엔터|애니메이션|웹툰|캐릭터/,
    "content_ip",
  ],
  [
    /식품|식료|음료|음식|농산|수산|축산|제과|제빵|커피|주류|외식|급식|건강\/식품/,
    "food",
  ],
  [
    /의류|의복|옷|패션|섬유|신발|가방|잡화|액세서리|직물|봉제|니트|모피|양말|모자/,
    "fashion",
  ],
  [/의약|의료|제약|바이오|병원|의원|헬스케어|진단|치과|한의/, "healthcare"],
  [
    /소프트웨어|S\/W|정보처리|정보\s*서비스|프로그래밍|시스템\s*통합|데이터베이스|클라우드|호스팅|포털|인공지능|플랫폼/,
    "b2b_saas",
  ],
  [/금융|보험|투자|증권|은행|자산운용|신탁|대부/, "finance"],
  [/교육|학원|강의|훈련|교습|도서|영어|어학|코딩/, "education"],
  [
    /소매|도매|도소매|전자상거래|통신판매|쇼핑몰|종합몰|유통|상품\s*중개/,
    "retail",
  ],
  [
    /제조|가공|부품|기계|금속|소재|반도체|전자|화학|장비|설비|플라스틱|조립/,
    "manufacturing",
  ],
  // Findable 주 타깃이 아닌 업종 — 「미분류」와 구분해 other 로 둔다(필터에서 빼기 쉽게).
  [
    /부동산|임대업|건설|공사업|토목|운송|운수|물류|해운|항공|창고|숙박|청소|경비|인력\s*공급|사업\s*지원|협회|단체|공공\s*행정|종교/,
    "other",
  ],
];

export function industryFromName(
  name: string | null | undefined
): IndustryId | null {
  const text = (name ?? "").trim();
  if (!text) {
    return null;
  }
  for (const [re, industry] of NAME_RULES) {
    if (re.test(text)) {
      return industry;
    }
  }
  return null;
}

/**
 * 공정위 통신판매 「취급품목」(여러 개가 공백으로 이어짐: "의류/패션/잡화/뷰티 건강/식품").
 * 한 갈래만 있으면 그 업종, 둘 이상이거나 「종합몰」이면 retail(종합 쇼핑몰).
 */
const FTC_CATEGORY_RULES: [RegExp, IndustryId][] = [
  [/의류\/패션\/잡화\/뷰티/, "fashion"],
  [/건강\/식품/, "food"],
  [/교육\/도서\/완구\/오락/, "education"],
  [/레저\/여행\/공연/, "content_ip"],
  [/가전|컴퓨터\/사무용품|가구\/수납용품|자동차\/자동차용품/, "retail"],
];

export function industryFromProducts(
  products: string | null | undefined
): IndustryId | null {
  const text = (products ?? "").trim();
  if (!text) {
    return null;
  }
  if (text.includes("종합몰")) {
    return "retail";
  }
  const hits = new Set<IndustryId>();
  for (const [re, industry] of FTC_CATEGORY_RULES) {
    if (re.test(text)) {
      hits.add(industry);
    }
  }
  if (hits.size === 1) {
    return [...hits][0] ?? null;
  }
  if (hits.size > 1) {
    return "retail";
  }
  // 자유 서술(이노비즈 주생산품 「플라스틱 화장품 용기」 등) — 이름 규칙으로
  return industryFromName(text);
}

/** 우선순위: KSIC 코드 → 업종명 → 취급품목/주생산품. */
export function classifyIndustry(input: {
  industryCode?: string | null;
  industryName?: string | null;
  products?: string | null;
}): IndustryVerdict {
  const byCode = industryFromKsic(input.industryCode);
  if (byCode) {
    return { basis: "ksic", industry: byCode };
  }
  const byName = industryFromName(input.industryName);
  if (byName) {
    return { basis: "name", industry: byName };
  }
  const byProducts = industryFromProducts(input.products);
  if (byProducts) {
    return { basis: "products", industry: byProducts };
  }
  return { basis: null, industry: null };
}

// ── 3. 태그 ─────────────────────────────────────────────────────────────────

/** 자유 태그 사전 — 화면 필터 칩의 기본 목록. 사람이 추가한 임의 태그도 허용한다. */
export const KNOWN_TAGS = [
  "b2b",
  "b2c",
  "commerce",
  "venture",
  "vc_invested",
  "innobiz",
  "mainbiz",
  "tips",
  "listed",
  "mfds_cosmetics",
] as const;

const RETAIL_NAME_RE = /소매/;
const WHOLESALE_NAME_RE = /도매/;
const COMMERCE_NAME_RE = /전자상거래|통신판매|온라인\s*쇼핑|쇼핑몰|무점포/;
const B2C_INDUSTRIES = new Set<IndustryId>([
  "beauty",
  "fashion",
  "food",
  "content_ip",
  "education",
]);

/**
 * 고객 유형 태그 — **[AI가설] 규칙 기반 추정**이다(원천에 B2B/B2C 칸은 없다).
 *  - commerce: 통신판매 신고 사업자 · KSIC 4791(무점포 소매) · 업종명에 전자상거래/통신판매
 *  - b2c: KSIC 47(소매)·56(음식점)·85(교육)·96(개인서비스) 또는 commerce, 또는 소비재 업종 + 소매 신호
 *  - b2b: KSIC 46(도매) · 제조업(소비재 제외) · IT(게임 제외)
 */
export function audienceTags(input: {
  industry: IndustryId | null;
  industryCode?: string | null;
  industryName?: string | null;
  isMailOrderSeller?: boolean;
}): ("b2b" | "b2c" | "commerce")[] {
  const code = (input.industryCode ?? "").replaceAll(NON_DIGIT_RE, "");
  const name = input.industryName ?? "";
  const tags = new Set<"b2b" | "b2c" | "commerce">();
  if (
    input.isMailOrderSeller ||
    code.startsWith("4791") ||
    COMMERCE_NAME_RE.test(name)
  ) {
    tags.add("commerce");
    tags.add("b2c");
  }
  if (["47", "56", "85", "96"].some((p) => code.startsWith(p))) {
    tags.add("b2c");
  }
  if (
    RETAIL_NAME_RE.test(name) &&
    input.industry &&
    B2C_INDUSTRIES.has(input.industry)
  ) {
    tags.add("b2c");
  }
  if (code.startsWith("46") || WHOLESALE_NAME_RE.test(name)) {
    tags.add("b2b");
  }
  if (input.industry === "manufacturing" || input.industry === "b2b_saas") {
    tags.add("b2b");
  }
  return [...tags].sort();
}

/** 태그 정규화 — 소문자·공백 제거·중복 제거·정렬 */
export function normalizeTags(tags: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const tag of tags) {
    const t = tag.trim().toLowerCase().replaceAll(/\s+/g, "_");
    if (t) {
      out.add(t);
    }
  }
  return [...out].sort();
}

// ── 4. 규모 ─────────────────────────────────────────────────────────────────

export const SIZE_BUCKETS = [
  "1-4",
  "5-9",
  "10-49",
  "50-99",
  "100-499",
  "500+",
] as const;

export type SizeBucket = (typeof SIZE_BUCKETS)[number];

/** [min, maxExclusive) — 500+ 는 상한 없음 */
export const SIZE_BUCKET_RANGES: Record<
  SizeBucket,
  { max: number | null; min: number }
> = {
  "1-4": { min: 1, max: 5 },
  "5-9": { min: 5, max: 10 },
  "10-49": { min: 10, max: 50 },
  "50-99": { min: 50, max: 100 },
  "100-499": { min: 100, max: 500 },
  "500+": { min: 500, max: null },
};

export function sizeBucket(
  employees: number | null | undefined
): SizeBucket | null {
  if (employees === null || employees === undefined || employees < 1) {
    return null;
  }
  for (const bucket of SIZE_BUCKETS) {
    const { min, max } = SIZE_BUCKET_RANGES[bucket];
    if (employees >= min && (max === null || employees < max)) {
      return bucket;
    }
  }
  return null;
}

// ── 5. 지역 ─────────────────────────────────────────────────────────────────

export const REGIONS = [
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "세종",
  "경기",
  "강원",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
  "제주",
] as const;

export type Region = (typeof REGIONS)[number];

const REGION_PREFIXES: [RegExp, Region][] = [
  [/^서울/, "서울"],
  [/^부산/, "부산"],
  [/^대구/, "대구"],
  [/^인천/, "인천"],
  [/^광주/, "광주"],
  [/^대전/, "대전"],
  [/^울산/, "울산"],
  [/^세종/, "세종"],
  [/^경기/, "경기"],
  [/^강원/, "강원"],
  [/^(충청북도|충북)/, "충북"],
  [/^(충청남도|충남)/, "충남"],
  [/^(전라북도|전북)/, "전북"],
  [/^(전라남도|전남)/, "전남"],
  [/^(경상북도|경북)/, "경북"],
  [/^(경상남도|경남)/, "경남"],
  [/^제주/, "제주"],
];

/** 주소 또는 지역명 원문 → 시·도 약칭. 모르면 null. */
export function regionFromText(text: string | null | undefined): Region | null {
  const t = (text ?? "").trim();
  for (const [re, region] of REGION_PREFIXES) {
    if (re.test(t)) {
      return region;
    }
  }
  return null;
}

/** 법정동 시도코드(국민연금 ldongAddrMgplDgCd) → 약칭. 강원·전북은 특별자치도 전환 뒤 코드(51·52)도 받는다. */
const LDONG_SIDO: Record<string, Region> = {
  "11": "서울",
  "26": "부산",
  "27": "대구",
  "28": "인천",
  "29": "광주",
  "30": "대전",
  "31": "울산",
  "36": "세종",
  "41": "경기",
  "42": "강원",
  "51": "강원",
  "43": "충북",
  "44": "충남",
  "45": "전북",
  "52": "전북",
  "46": "전남",
  "47": "경북",
  "48": "경남",
  "50": "제주",
};

export function regionFromSidoCode(
  code: string | null | undefined
): Region | null {
  return LDONG_SIDO[(code ?? "").trim()] ?? null;
}

// ── 6. 도메인 ───────────────────────────────────────────────────────────────

/** 입점몰·SNS·블로그 — 회사 자체 사이트가 아니다(도메인 칸에 넣지 않음). */
const MARKETPLACE_HOSTS = [
  "smartstore.naver.com",
  "brand.naver.com",
  "shopping.naver.com",
  "blog.naver.com",
  "cafe.naver.com",
  "naver.com",
  "coupang.com",
  "11st.co.kr",
  "gmarket.co.kr",
  "auction.co.kr",
  "ssg.com",
  "lotteon.com",
  "wemakeprice.com",
  "tmon.co.kr",
  "interpark.com",
  "kakao.com",
  "instagram.com",
  "facebook.com",
  "youtube.com",
  "tistory.com",
  "musinsa.com",
  "29cm.co.kr",
  "idus.com",
  "oliveyoung.co.kr",
  "kurly.com",
  "amazon.com",
  "linktr.ee",
];

export interface DomainVerdict {
  /** 자체 사이트 도메인(www 제거, 소문자) */
  domain: string | null;
  /** 입점몰·SNS 주소면 원문 URL */
  storeUrl: string | null;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const WWW_PREFIX_RE = /^www\d?\./;
const TRAILING_DOT_RE = /\.$/;
const HOST_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function isMarketplaceHost(host: string): boolean {
  const h = host.toLowerCase();
  return MARKETPLACE_HOSTS.some((m) => h === m || h.endsWith(`.${m}`));
}

export function normalizeHomepage(
  raw: string | null | undefined
): DomainVerdict {
  const text = (raw ?? "").trim();
  if (!text || text.toLowerCase() === "null" || text === "-") {
    return { domain: null, storeUrl: null };
  }
  const withScheme = SCHEME_RE.test(text) ? text : `http://${text}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return { domain: null, storeUrl: null };
  }
  host = host.replace(WWW_PREFIX_RE, "").replace(TRAILING_DOT_RE, "");
  if (!HOST_RE.test(host)) {
    return { domain: null, storeUrl: null };
  }
  if (isMarketplaceHost(host)) {
    return { domain: null, storeUrl: withScheme };
  }
  return { domain: host, storeUrl: null };
}
