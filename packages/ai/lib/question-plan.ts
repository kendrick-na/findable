/**
 * 측정 질문 구성 규칙 — 순수 모듈(2026-10-13 · 단계2, 대표 승인).
 *
 * 왜 따로 두나: `prompt-suggestions.ts` 는 최상단에서 `models.ts` 를 타서 import 만으로 환경변수 오류가 난다.
 * 구성비·자동 검사·기본 질문은 LLM 과 무관한 **규칙**이라 이 파일에 모아 테스트하고,
 * 제안 모듈(LLM)·기본 질문(러너)·화면이 같은 규칙을 쓴다. (순수 모듈 `engine-names.ts` 외에는 import 하지 않는다.)
 *
 * 원칙(대표 승인 2026-10-12)
 *  - 질문 = 자동 제안 → 사람 승인 → 승인분만 측정. 이름 없는(비브랜드) 질문 중심, 소비자 말투.
 *  - 코드가 LLM 출력을 거른다: 이름 없는 유형에 우리 이름이 들어가면 버리고, 대표 상품 질문은
 *    사이트에 적힌 말만 쓴다(지어낸 사실 방지).
 */

import { findEngineName } from "./engine-names";

/** 질문 유형 5종(설계안 3절). */
export type QuestionType =
  | "alternative"
  | "brand"
  | "category"
  | "concern"
  | "representative";

/** 후보 20개 구성(8·4·3·2·3). 이름 없는 질문 17/20 = 85%. */
export const QUESTION_COMPOSITION: Record<QuestionType, number> = {
  category: 8,
  concern: 4,
  representative: 3,
  alternative: 2,
  brand: 3,
};

/** [추천 구성으로 담기] 우선순위 — 플랜 상한이 작으면 앞 유형부터 채운다. */
export const QUESTION_TYPE_PRIORITY: readonly QuestionType[] = [
  "category",
  "concern",
  "representative",
  "alternative",
  "brand",
];

export type QuestionLanguage = "en" | "ko";

/** 질문이 어떤 재료에서 나왔는지(생성 모델이 같은 호출에서 밝힌다). */
export type QuestionBasis = "brand" | "competitor" | "industry" | "site";

export interface PlanQuestion {
  /** 근거 재료. 대표 상품 질문은 `site` 여야 하고, `competitor` 는 등록 경쟁사가 있을 때만 쓸 수 있다. */
  basis?: QuestionBasis;
  language: QuestionLanguage;
  text: string;
  type: QuestionType;
}

/** 이름 없는 유형인가(우리 이름이 들어가면 안 된다). */
export function isNamelessType(type: QuestionType): boolean {
  return type !== "brand";
}

// ── 유형 → 저장 값 매핑 (DB 스키마 변경 없음) ─────────────────────────────
export type PlanTopic =
  | "alternative"
  | "best_in_category"
  | "buying_guide"
  | "problem_solving"
  | "recommendation";

const TYPE_TOPIC: Record<QuestionType, PlanTopic> = {
  category: "best_in_category",
  concern: "problem_solving",
  representative: "buying_guide",
  alternative: "alternative",
  brand: "recommendation",
};

/** 저장되는 `Prompt.category`(PromptCategory enum 값)로 쓸 주제. */
export function topicOfType(type: QuestionType): PlanTopic {
  return TYPE_TOPIC[type];
}

/** 측정 균형 축: 우리 이름을 넣어 묻는 질문 = brand, 나머지 = competitor(카테고리·경쟁 축). */
export function balanceAxisOfType(type: QuestionType): "brand" | "competitor" {
  return type === "brand" ? "brand" : "competitor";
}

// ── 시장 범위 → 언어 배분 ───────────────────────────────────────────────
export type PlanMarketScope = "both" | "global" | "korea";

/**
 * 후보 20개의 언어 배분. 한국=한국어만 / 해외=영어만 / 둘 다=한국어 7 : 영어 3(설계안 3절).
 * 유형별 개수를 반올림해 나누되 합계가 구성비와 같게 한다.
 */
export function targetCounts(
  scope: PlanMarketScope | null | undefined
): Record<QuestionType, Record<QuestionLanguage, number>> {
  const out = {} as Record<QuestionType, Record<QuestionLanguage, number>>;
  for (const type of QUESTION_TYPE_PRIORITY) {
    const total = QUESTION_COMPOSITION[type];
    if (scope === "global") {
      out[type] = { ko: 0, en: total };
    } else if (scope === "both") {
      const en = Math.round(total * 0.3);
      out[type] = { ko: total - en, en };
    } else {
      out[type] = { ko: total, en: 0 };
    }
  }
  return out;
}

// ── 업종 분야 표기 ───────────────────────────────────────────────────────
/**
 * 업종 enum → 질문에 쓰는 일반 분야 표기. 회사 사실이 아니라 고객이 고른 분류의 이름이다.
 * `other` 는 뜻이 없어 넣지 않는다(지어내지 않는다).
 */
export const INDUSTRY_QUESTION_LABEL: Record<
  string,
  { en: string; ko: string }
> = {
  beauty: { ko: "화장품·뷰티", en: "beauty and skincare" },
  fashion: { ko: "패션", en: "fashion" },
  food: { ko: "식품", en: "food" },
  b2b_saas: { ko: "B2B 소프트웨어", en: "B2B software" },
  content_ip: { ko: "콘텐츠", en: "content" },
  retail: { ko: "온라인 쇼핑", en: "online shopping" },
  finance: { ko: "금융 서비스", en: "financial services" },
  healthcare: { ko: "병원·의료 서비스", en: "healthcare" },
  education: { ko: "교육 서비스", en: "education" },
  manufacturing: { ko: "제조·부품", en: "manufacturing and components" },
};

export function industryLabel(
  industry: string | null | undefined
): { en: string; ko: string } | null {
  return industry ? (INDUSTRY_QUESTION_LABEL[industry] ?? null) : null;
}

// ── 기본 질문(저장 질문이 없을 때 러너가 쓰는 4개) ──────────────────────────
export interface DefaultConsumerQuestion {
  language: QuestionLanguage;
  /** 이름 없는 질문이면 true. */
  nameless: boolean;
  text: string;
}

/**
 * 소비자 말투 기본 질문 — 한국어 4개(이름 없는 3 + 이름 1) · 영어 4개 같은 구성.
 * 업종을 모르거나 `other` 면 null(지어내지 않는다 → 호출부가 예전 4개를 쓴다).
 */
export function defaultConsumerQuestions(input: {
  englishName: string;
  industry: string | null | undefined;
  koreanName: string;
  language: "both" | "en" | "ko";
}): DefaultConsumerQuestion[] | null {
  const label = industryLabel(input.industry);
  if (!label) {
    return null;
  }
  const ko: DefaultConsumerQuestion[] = [
    { nameless: true, language: "ko", text: `${label.ko} 추천해줘` },
    { nameless: true, language: "ko", text: `${label.ko} 뭐가 좋아?` },
    {
      nameless: true,
      language: "ko",
      text: `${label.ko} 처음 고를 때 뭘 봐야 해?`,
    },
    {
      nameless: false,
      language: "ko",
      text: `${input.koreanName} 후기 어때?`,
    },
  ];
  const en: DefaultConsumerQuestion[] = [
    {
      nameless: true,
      language: "en",
      text: `Can you recommend ${label.en} companies?`,
    },
    {
      nameless: true,
      language: "en",
      text: `What are the best ${label.en} options?`,
    },
    {
      nameless: true,
      language: "en",
      text: `What should I look for when choosing ${label.en}?`,
    },
    {
      nameless: false,
      language: "en",
      text: `What do people say about ${input.englishName}?`,
    },
  ];
  if (input.language === "ko") {
    return ko;
  }
  if (input.language === "en") {
    return en;
  }
  // both: 한국어 3(이름 없는 2 + 이름 1) + 영어 이름 없는 1 — 한국어 중심, 4개 유지.
  return [ko[0], ko[1], ko[3], en[0]] as DefaultConsumerQuestion[];
}

// ── 자동 검사 ────────────────────────────────────────────────────────────
const NON_IDENTITY_CHAR_RE = /[^a-z0-9가-힣]/g;
const LIST_MARKER_RE = /^\s*[-*\d.)\s]+/;
const QUOTE_RE = /["'`]/g;
const TOKEN_SPLIT_RE = /[^a-z0-9가-힣]+/;
const MIN_QUESTION_LENGTH = 3;
const MAX_QUESTION_LENGTH = 200;
const MIN_NAME_KEY_LENGTH = 2;
const MIN_ENGLISH_TOKEN_LENGTH = 3;
const MIN_HANGUL_TOKEN_LENGTH = 2;
const HANGUL_RE = /[가-힣]/;

function compact(value: string): string {
  return value.toLowerCase().replace(NON_IDENTITY_CHAR_RE, "");
}

export function cleanQuestionLine(raw: string): string {
  return raw.replace(LIST_MARKER_RE, "").replace(QUOTE_RE, "").trim();
}

/** 질문 틀에 쓰이는 말(재료가 아닌 말) — 사이트 문구 대조에서 뺀다. */
const GENERIC_TOKENS = new Set([
  "추천",
  "추천해줘",
  "추천해",
  "뭐가",
  "뭐야",
  "좋아",
  "좋은",
  "있어",
  "알려줘",
  "어떻게",
  "어디",
  "어디가",
  "어디서",
  "어때",
  "대신",
  "말고",
  "the",
  "best",
  "for",
  "what",
  "which",
  "can",
  "you",
  "recommend",
  "good",
  "are",
  "any",
  "how",
  "and",
  "with",
]);

export interface PlanGuardContext {
  /** 우리 이름·별칭·사이트명·도메인 이름(질문에 들어가면 이름 없는 질문이 아니다). */
  brandNames: readonly string[];
  /** 승인·등록된 경쟁사 이름(있으면 비교·대안 질문에 쓸 수 있다). */
  competitors?: readonly string[];
  /** 업종 enum 값 — 업종별 금지 질문 틀을 고른다(없으면 중립 틀). */
  industry?: string | null;
  /** true 면 대표 상품 질문은 근거(`basis: "site"`)를 밝히지 않으면 버린다(질문 제안 경로가 켠다). */
  requireBasis?: boolean;
  /** 공식 사이트가 스스로 쓴 문구(제목·설명·H1·사이트명) 이어 붙인 것. 없으면 대표 상품 질문은 모두 버린다. */
  siteText: string;
}

export type DropReason =
  | "brand_missing"
  | "duplicate"
  | "engine_name"
  | "industry_banned"
  | "length"
  | "name_in_nameless"
  | "no_basis"
  | "no_site_evidence"
  | "presupposition"
  | "unknown_proper_noun";

function containsAnyName(text: string, names: readonly string[]): boolean {
  const key = compact(text);
  return names
    .map(compact)
    .filter((n) => n.length >= MIN_NAME_KEY_LENGTH)
    .some((n) => key.includes(n));
}

function hasSiteEvidence(text: string, siteText: string): boolean {
  const site = compact(siteText);
  if (!site) {
    return false;
  }
  return text
    .toLowerCase()
    .split(TOKEN_SPLIT_RE)
    .filter(
      (token) =>
        !GENERIC_TOKENS.has(token) &&
        token.length >=
          (HANGUL_RE.test(token)
            ? MIN_HANGUL_TOKEN_LENGTH
            : MIN_ENGLISH_TOKEN_LENGTH)
    )
    .some((token) => site.includes(token));
}

// ── 업종별 질문 틀 (2026-10-14 · 대표 확인용 표는 docs 에 같이 제출) ─────────────
/**
 * 업종마다 소비자가 묻는 틀이 다르다. 예전엔 모든 업종에 "소비자가 반말로" + "{브랜드} 어디서 사?" 예시를 썼다
 * (B2B SaaS 자사에 "Findable은 어디서 사는 거야?"가 나온 원인). 제안 프롬프트와 후처리가 이 표 하나를 같이 쓴다.
 * ⚠️ 제안 경로 전용이다 — 기본 질문 폴백(`defaultConsumerQuestions`)은 이 표를 쓰지 않는다.
 */
export interface IndustryFrame {
  /** 대안(다른 선택지) 고정 문형 — 등록 경쟁사가 없을 때 모델 대신 쓴다. `{분야}` 는 업종 분야 이름. */
  alternativeForms: { en: readonly string[]; ko: readonly string[] };
  /** 이 업종에서 맞지 않는 질문 패턴(걸리면 버린다). */
  banned: readonly RegExp[];
  /** 브랜드를 직접 묻는 질문 예시 — `{브랜드}` 자리에 이름을 넣는다. */
  brandExamples: readonly string[];
  /** 이 업종 고객이 궁금해하는 것. */
  focus: string;
  /** 질문하는 사람. */
  persona: string;
}

const PURCHASE_RE =
  /(어디서|어디에서)\s*(사|살|구매|구입)|구매처|구입처|배송|택배|매장/;

const BUSINESS_ALTERNATIVES = {
  ko: [
    "{분야} 도입 전에 비교해 볼 만한 다른 선택지는 뭐가 있어?",
    "{분야} 대안으로 많이 쓰는 곳 알려줘",
  ],
  en: [
    "What other {분야} options are worth comparing before adopting one?",
    "Which alternatives to consider for {분야}?",
  ],
} as const;

const GOODS_ALTERNATIVES = {
  ko: ["{분야} 다른 선택지는 뭐가 있어?", "{분야} 비슷한 곳 더 알려줘"],
  en: [
    "What other {분야} options are there?",
    "Are there other {분야} brands worth considering?",
  ],
} as const;

const GOODS: IndustryFrame = {
  persona: "소비자",
  focus: "구매·후기·성분/소재·가격대·구매처",
  brandExamples: [
    "{브랜드} 후기 어때?",
    "{브랜드} 어디서 사?",
    "{브랜드}는 어떤 곳이야?",
  ],
  banned: [],
  alternativeForms: GOODS_ALTERNATIVES,
};

const NEUTRAL: IndustryFrame = {
  persona: "고객",
  focus: "일반적인 궁금증(구매를 전제하지 않는다)",
  brandExamples: ["{브랜드}는 어떤 곳이야?", "{브랜드} 평판 어때?"],
  banned: [PURCHASE_RE],
  alternativeForms: GOODS_ALTERNATIVES,
};

export const INDUSTRY_FRAMES: Record<string, IndustryFrame> = {
  beauty: GOODS,
  fashion: GOODS,
  food: GOODS,
  retail: GOODS,
  b2b_saas: {
    persona: "서비스 도입을 검토하는 담당자",
    focus: "도입·비교·가격·연동·보안·후기",
    brandExamples: [
      "{브랜드}는 어떤 서비스야?",
      "{브랜드} 가격은 어때?",
      "{브랜드} 다른 도구랑 연동돼?",
      "{브랜드} 써 본 사람 후기 어때?",
    ],
    banned: [PURCHASE_RE],
    alternativeForms: BUSINESS_ALTERNATIVES,
  },
  manufacturing: {
    persona: "부품·소재 거래처를 찾는 담당자",
    focus: "납품·인증·소재·견적·거래처",
    brandExamples: [
      "{브랜드}는 어떤 부품을 만들어?",
      "{브랜드} 인증은 뭐가 있어?",
      "{브랜드} 견적 받을 수 있어?",
    ],
    banned: [PURCHASE_RE],
    alternativeForms: BUSINESS_ALTERNATIVES,
  },
  finance: {
    persona: "금융 서비스를 고르는 고객",
    focus: "가입·수수료·금리·안전성·후기",
    brandExamples: [
      "{브랜드} 수수료 어때?",
      "{브랜드} 안전해?",
      "{브랜드} 가입 후기 어때?",
    ],
    banned: [PURCHASE_RE],
    alternativeForms: BUSINESS_ALTERNATIVES,
  },
  healthcare: {
    persona: "병원·의료 서비스를 찾는 환자",
    focus: "진료·예약·비용·후기·위치",
    brandExamples: [
      "{브랜드}는 어떤 진료를 해?",
      "{브랜드} 예약은 어떻게 해?",
      "{브랜드} 후기 어때?",
    ],
    banned: [PURCHASE_RE],
    alternativeForms: GOODS_ALTERNATIVES,
  },
  education: {
    persona: "수강할 곳을 고르는 학습자",
    focus: "수강·커리큘럼·비용·후기·수료",
    brandExamples: [
      "{브랜드}는 어떤 과정이 있어?",
      "{브랜드} 수강 후기 어때?",
      "{브랜드} 비용은 얼마야?",
    ],
    banned: [PURCHASE_RE],
    alternativeForms: GOODS_ALTERNATIVES,
  },
  content_ip: {
    persona: "콘텐츠를 찾는 이용자",
    focus: "어디서 보나·구독·장르·후기",
    brandExamples: [
      "{브랜드}는 어떤 콘텐츠야?",
      "{브랜드} 어디서 볼 수 있어?",
      "{브랜드} 후기 어때?",
    ],
    banned: [],
    alternativeForms: GOODS_ALTERNATIVES,
  },
};

export function industryFrame(
  industry: string | null | undefined
): IndustryFrame {
  return (industry ? INDUSTRY_FRAMES[industry] : undefined) ?? NEUTRAL;
}

/**
 * 등록 경쟁사가 없을 때의 대안 질문 — 모델이 쓰지 않고 코드의 고정 문형을 쓴다(2026-10-14).
 * 모델이 "센드버드·인터콤" 같은 무관한 서비스 이름을 끌어오는 경로를 구조로 막는다. 분야를 모르면 만들지 않는다.
 */
export function fixedAlternativeQuestions(
  industry: string | null | undefined,
  scope: PlanMarketScope | null | undefined
): PlanQuestion[] {
  const label = industryLabel(industry);
  if (!label) {
    return [];
  }
  const forms = industryFrame(industry).alternativeForms;
  const targets = targetCounts(scope).alternative;
  return (["ko", "en"] as const).flatMap((language) =>
    forms[language].slice(0, targets[language]).map((form) => ({
      language,
      type: "alternative" as const,
      text: form.replace("{분야}", label[language]),
    }))
  );
}

// ── 질문 속 고유명사·전제 검사 ───────────────────────────────────────────
const PRESUPPOSITION_RE =
  /(라고|다고)\s*(했|하던|들었|봤|써\s*있)|했던데|라던데|다던데|들었는데|봤는데|\b(i heard|they say|it is said|you said|i read that)\b/i;
const ACRONYMS = new Set([
  "ai",
  "api",
  "b2b",
  "b2c",
  "cpa",
  "crm",
  "erp",
  "esg",
  "geo",
  "isms",
  "it",
  "kpi",
  "llm",
  "ok",
  "pc",
  "roi",
  "saas",
  "seo",
  "sns",
  "sso",
  "tv",
  "ui",
  "ux",
  "vip",
]);
const CAPITALIZED_RE = /^[A-Z]/;
const WHITESPACE_RE = /\s+/;
const LATIN_TOKEN_RE = /[A-Za-z][A-Za-z0-9&.-]{2,}/g;
const LIST_PATTERN_RE =
  /([가-힣A-Za-z0-9]{2,})(?:이나|나|이랑|랑|과|와|,|·)\s*([가-힣A-Za-z0-9]{2,})\s*(?:같은|처럼)/g;

/** 질문에 써도 되는 이름의 키 모음: 우리 이름·별칭·경쟁사·사이트 문구·업종 분야 이름. */
function allowedKeys(ctx: PlanGuardContext): { names: string[]; site: string } {
  const label = industryLabel(ctx.industry);
  const names = [
    ...ctx.brandNames,
    ...(ctx.competitors ?? []),
    label?.ko ?? "",
    label?.en ?? "",
  ]
    .map(compact)
    .filter((k) => k.length >= MIN_NAME_KEY_LENGTH);
  return { names, site: compact(ctx.siteText) };
}

function isAllowedName(candidate: string, ctx: PlanGuardContext): boolean {
  const key = compact(candidate);
  if (key.length < MIN_NAME_KEY_LENGTH || ACRONYMS.has(key)) {
    return true;
  }
  const { names, site } = allowedKeys(ctx);
  return (
    names.some((n) => n.includes(key) || key.includes(n)) ||
    (site.length > 0 && site.includes(key))
  );
}

/**
 * 입력(우리 이름·경쟁사·사이트 문구·업종)에 없는 고유명사로 보이는 말을 찾는다. 없으면 null.
 * 한국어 질문의 영문 단어 · 영어 질문의 문장 중간 대문자 단어 · "X나 Y 같은" 목록 패턴을 본다.
 * ⚠️ 한국어 고유명사를 완전히 가리지는 못한다 — 허용 목록 방식이라 모르면 버리는 쪽으로 기운다.
 */
export function findUnknownProperNoun(
  text: string,
  ctx: PlanGuardContext
): string | null {
  const hasHangul = HANGUL_RE.test(text);
  const tokens = text.match(LATIN_TOKEN_RE) ?? [];
  const firstWord = text.trim().split(WHITESPACE_RE)[0] ?? "";
  for (const token of tokens) {
    const candidate = hasHangul
      ? true
      : CAPITALIZED_RE.test(token) && token !== firstWord;
    if (candidate && !isAllowedName(token, ctx)) {
      return token;
    }
  }
  if (hasHangul) {
    for (const match of text.matchAll(LIST_PATTERN_RE)) {
      for (const name of [match[1], match[2]]) {
        if (name && !isAllowedName(name, ctx)) {
          return name;
        }
      }
    }
  }
  return null;
}

/** 질문 1개를 유형 규칙에 비춰 검사한다. 통과면 null, 아니면 버리는 이유. */
export function checkQuestion(
  q: PlanQuestion,
  ctx: PlanGuardContext
): DropReason | null {
  const text = q.text.trim();
  if (text.length < MIN_QUESTION_LENGTH || text.length > MAX_QUESTION_LENGTH) {
    return "length";
  }
  if (findEngineName(text)) {
    return "engine_name";
  }
  if (PRESUPPOSITION_RE.test(text)) {
    return "presupposition";
  }
  if (industryFrame(ctx.industry).banned.some((re) => re.test(text))) {
    return "industry_banned";
  }
  if (findUnknownProperNoun(text, ctx)) {
    return "unknown_proper_noun";
  }
  if (
    (q.type === "representative" &&
      q.basis !== "site" &&
      (q.basis !== undefined || ctx.requireBasis === true)) ||
    (q.basis === "competitor" && (ctx.competitors?.length ?? 0) === 0)
  ) {
    return "no_basis";
  }
  const hasName = containsAnyName(text, ctx.brandNames);
  if (q.type === "brand") {
    return hasName ? null : "brand_missing";
  }
  if (hasName) {
    return "name_in_nameless";
  }
  if (q.type === "representative" && !hasSiteEvidence(text, ctx.siteText)) {
    return "no_site_evidence";
  }
  return null;
}

export interface GuardResult {
  dropped: { reason: DropReason; text: string; type: QuestionType }[];
  kept: PlanQuestion[];
}

/** LLM 이 만든 질문 목록을 거른다(정리·검사·중복 제거). 순서는 유지한다. */
export function guardQuestions(
  items: readonly PlanQuestion[],
  ctx: PlanGuardContext
): GuardResult {
  const seen = new Set<string>();
  const kept: PlanQuestion[] = [];
  const dropped: GuardResult["dropped"] = [];
  for (const item of items) {
    const q = { ...item, text: cleanQuestionLine(item.text ?? "") };
    const reason = checkQuestion(q, ctx);
    const key = q.text.toLowerCase();
    if (reason) {
      dropped.push({ reason, text: q.text, type: q.type });
    } else if (seen.has(key)) {
      dropped.push({ reason: "duplicate", text: q.text, type: q.type });
    } else {
      seen.add(key);
      kept.push(q);
    }
  }
  return { dropped, kept };
}

/**
 * 유형·언어별 목표 개수만큼 잘라 구성비에 맞춘다. 모자란 칸은 채우지 않는다(지어내지 않는다).
 * 반환 순서는 유형 우선순위 → 언어(ko 먼저).
 */
export function composeQuestions(
  kept: readonly PlanQuestion[],
  scope: PlanMarketScope | null | undefined
): PlanQuestion[] {
  const targets = targetCounts(scope);
  const out: PlanQuestion[] = [];
  for (const type of QUESTION_TYPE_PRIORITY) {
    for (const language of ["ko", "en"] as const) {
      out.push(
        ...kept
          .filter((q) => q.type === type && q.language === language)
          .slice(0, targets[type][language])
      );
    }
  }
  return out;
}

/**
 * [추천 구성으로 담기] — 플랜 상한 안에서 유형 우선순위대로 한 개씩 번갈아 고른다.
 * 반환은 입력 배열의 **인덱스**(화면이 체크 상태로 쓴다).
 */
export function recommendedBundle(
  questions: readonly PlanQuestion[],
  limit: number
): number[] {
  const byType = new Map<QuestionType, number[]>();
  questions.forEach((q, index) => {
    byType.set(q.type, [...(byType.get(q.type) ?? []), index]);
  });
  const picked: number[] = [];
  let progressed = true;
  while (picked.length < limit && progressed) {
    progressed = false;
    for (const type of QUESTION_TYPE_PRIORITY) {
      const next = byType.get(type)?.shift();
      if (next !== undefined && picked.length < limit) {
        picked.push(next);
        progressed = true;
      }
    }
  }
  return picked.sort((a, b) => a - b);
}
