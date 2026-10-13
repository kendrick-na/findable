/**
 * 측정 질문 구성 규칙 — 순수 모듈(2026-10-13 · 단계2, 대표 승인).
 *
 * 왜 따로 두나: `prompt-suggestions.ts` 는 최상단에서 `models.ts` 를 타서 import 만으로 환경변수 오류가 난다.
 * 구성비·자동 검사·기본 질문은 LLM 과 무관한 **규칙**이라 이 파일에 모아 테스트하고,
 * 제안 모듈(LLM)·기본 질문(러너)·화면이 같은 규칙을 쓴다. (이 파일은 아무것도 import 하지 않는다.)
 *
 * 원칙(대표 승인 2026-10-12)
 *  - 질문 = 자동 제안 → 사람 승인 → 승인분만 측정. 이름 없는(비브랜드) 질문 중심, 소비자 말투.
 *  - 코드가 LLM 출력을 거른다: 이름 없는 유형에 우리 이름이 들어가면 버리고, 대표 상품 질문은
 *    사이트에 적힌 말만 쓴다(지어낸 사실 방지).
 */

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

export interface PlanQuestion {
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
  /** 공식 사이트가 스스로 쓴 문구(제목·설명·H1·사이트명) 이어 붙인 것. 없으면 대표 상품 질문은 모두 버린다. */
  siteText: string;
}

export type DropReason =
  | "brand_missing"
  | "duplicate"
  | "length"
  | "name_in_nameless"
  | "no_site_evidence";

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

/** 질문 1개를 유형 규칙에 비춰 검사한다. 통과면 null, 아니면 버리는 이유. */
export function checkQuestion(
  q: PlanQuestion,
  ctx: PlanGuardContext
): DropReason | null {
  const text = q.text.trim();
  if (text.length < MIN_QUESTION_LENGTH || text.length > MAX_QUESTION_LENGTH) {
    return "length";
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
