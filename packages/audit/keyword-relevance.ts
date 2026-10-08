// 검색 키워드 ↔ 브랜드 프로필 관련성 — 업종 공통 순수 함수 (2026-10-07, 질문 체계 v2 A1)
//
// 왜: 예전 관련성 판정(`demand-prompts.ts` v1)은 **K-뷰티 성분·제형 사전**으로 키워드를 쪼갰다.
//   화장품이 아니면 사전이 비어 질문이 0개였다(노우버스 「AI 컨설팅」 → 0개).
//   → 사전 대신 **이 브랜드 프로필**(공식몰 상품명·서비스명·카테고리)에서 뽑은 낱말로 판정한다.
//
// 규칙(결정적 — LLM 없음)
//   1. 프로필 낱말 = 상품·서비스 이름의 **끝 낱말(head, 「앰플」「컨설팅」)** + 앞 낱말(modifier,
//      「PDRN」「AI」「CTO」). 키워드는 head 가 있어야 한다(「PDRN」「AI」 단독 = 너무 넓음·의료 검색 섞임).
//   2. head 만 있으면(「앰플추천」) head 가 이 브랜드의 **대표 head**(상품 3개 이상)일 때만 쓴다
//      (「컨설팅추천」처럼 다른 뜻이 섞이는 넓은 낱말을 막는다).
//   3. 브랜드 자신의 이름·다른 브랜드 이름이 들어가면 버린다.
//   4. 의료·채용·주식 같은 **다른 뜻 낱말**이 있으면 버린다 — 단 그 낱말이 프로필에 있으면
//      (예: 시술을 파는 병원) 이 업종의 뜻이므로 쓴다.
//   5. 사전에 없는 조각(leftover)은 한글 4글자까지만 허용한다(「주름」「국비지원」).
//      영어 조각은 다른 브랜드일 가능성이 커 버린다(「medicube pdrn serum」). 단 「for …」 뒤는
//      용도(「pdrn serum for wrinkles」)로 본다.
//
// ⚠️ 알려진 한계: 이름 목록에 없는 한글 브랜드(4글자 이하)는 조각으로 통과할 수 있다.
//   그래서 러너는 등록 경쟁사 + 지난 회차 AI 답변에서 뽑은 브랜드 이름을 함께 넘긴다.

export type KeywordIntent = "rec" | "price" | "use" | "eff" | "compare";

type EntryKind = "head" | "modifier" | "qualifier" | "negative";

interface DictEntry {
  display: string;
  /** qualifier 중 질문 문장에 남기지 않는 낱말(「좋은」). */
  drop?: boolean;
  intent?: KeywordIntent;
  kind: EntryKind;
  /** 「에좋은」「for」 — 앞/뒤 조각을 용도로 읽는다. */
  purposeMarker?: "before" | "after";
}

export interface ProfileTerms {
  /** 대표 head — 단독(+의도 낱말)으로도 카테고리 질문이 된다. */
  coreHeads: Set<string>;
  /** compact → 표시형·출현 수. */
  heads: Map<string, { count: number; display: string }>;
  modifiers: Map<string, { display: string }>;
  /** 프로필 원문(compact) — 「다른 뜻 낱말」 예외 판정용. */
  profileText: string;
}

const COMPACT_RE = /[\s\-_./·,|:+&]+/g;
const NON_WORD_RE = /[^0-9a-z가-힣%]/g;
const LATIN_RE = /^[a-z0-9]+$/;
const LATIN_CHAR_RE = /[a-z0-9]/;
const HANGUL_RE = /[가-힣]/;
const WHITESPACE_RE = /\s+/;

/** 비교용 정규형 — 소문자, 공백·구두점 제거. */
export function compactTerm(value: string): string {
  return value.toLowerCase().replace(COMPACT_RE, "").replace(NON_WORD_RE, "");
}

// ── 업종 공통 낱말(의도·한정어) ───────────────────────────────────────
// 어느 업종에나 쓰는 질문 의도 낱말이다. 성분·제형 같은 업종 사전이 아니다.
const KO_QUALIFIERS: Record<string, KeywordIntent | null> = {
  추천: "rec",
  순위: "rec",
  랭킹: "rec",
  인기: "rec",
  베스트: "rec",
  후기: "rec",
  리뷰: "rec",
  종류: "rec",
  브랜드: "rec",
  업체: "rec",
  회사: "rec",
  기관: "rec",
  전문: "rec",
  전문업체: "rec",
  잘하는곳: "rec",
  사이트: "rec",
  가격: "price",
  가성비: "price",
  저렴한: "price",
  비용: "price",
  견적: "price",
  요금: "price",
  단가: "price",
  무료: "price",
  사용법: "use",
  방법: "use",
  하는법: "use",
  하는방법: "use",
  바르는법: "use",
  바르는순서: "use",
  사용순서: "use",
  순서: "use",
  루틴: "use",
  활용: "use",
  활용법: "use",
  효과: "eff",
  효능: "eff",
  장점: "eff",
  단점: "eff",
  부작용: "eff",
  비교: "compare",
  차이: "compare",
  차이점: "compare",
  vs: "compare",
  기업: null,
  기업용: null,
  중소기업: null,
  스타트업: null,
  온라인: null,
  여자: null,
  남자: null,
  남성: null,
  여성: null,
  직장인: null,
  초보: null,
  입문: null,
  제품: null,
  서비스: null,
  프로그램: null,
  과정: null,
  피부: null,
  얼굴: null,
  데일리: null,
  도입: null,
};
const KO_DROPPED = new Set(["좋은", "잘하는"]);
const EN_QUALIFIERS: Record<string, KeywordIntent | null> = {
  best: "rec",
  top: "rec",
  good: "rec",
  recommended: "rec",
  review: "rec",
  reviews: "rec",
  brand: "rec",
  brands: "rec",
  company: "rec",
  companies: "rec",
  agency: "rec",
  agencies: "rec",
  provider: "rec",
  providers: "rec",
  cheap: "price",
  affordable: "price",
  budget: "price",
  price: "price",
  pricing: "price",
  cost: "price",
  free: "price",
  how: "use",
  use: "use",
  apply: "use",
  routine: "use",
  guide: "use",
  benefits: "eff",
  benefit: "eff",
  results: "eff",
  work: "eff",
  vs: "compare",
  versus: "compare",
  compare: "compare",
  comparison: "compare",
  alternative: "compare",
  alternatives: "compare",
  korean: null,
  online: null,
  enterprise: null,
  business: null,
  startup: null,
  services: null,
  service: null,
  face: null,
  skin: null,
};
const EN_DROPPED = new Set([
  "the",
  "a",
  "an",
  "to",
  "for",
  "with",
  "and",
  "in",
  "of",
  "my",
  "is",
  "what",
  "does",
]);

// 다른 뜻(의료·연구·채용·주식·연예) 낱말 — 프로필에 같은 낱말이 있으면 예외.
const KO_NEGATIVE = [
  "주가",
  "주식",
  "채용",
  "연봉",
  "알바",
  "뜻",
  "영어로",
  "다운로드",
  "영화",
  "드라마",
  "노래",
  "가사",
  "게임",
  "위키",
  "자격증",
  "시험",
  "학과",
  "대학원",
  "논문",
  "주사",
  "시술",
  "병원",
  "피부과",
  "수술",
  "약국",
  "처방",
  "중고",
];
const EN_NEGATIVE = [
  "receptor",
  "protein",
  "gene",
  "genes",
  "cancer",
  "injection",
  "injections",
  "inhibitor",
  "pathway",
  "mutation",
  "stock",
  "stocks",
  "jobs",
  "job",
  "salary",
  "meaning",
  "definition",
  "lyrics",
  "movie",
  "band",
  "wiki",
  "certification",
  "exam",
  "degree",
  "university",
  "surgery",
  "prescription",
  "dosage",
  "therapy",
];

// ── 상품·서비스 이름 → 프로필 낱말 ────────────────────────────────────
const BRACKET_RE = /\(([^)]*)\)|\[([^\]]*)\]/g;
const TOKEN_SPLIT_RE = /[\s/,·|:+&_]+/;
const SIZE_TOKEN_RE =
  /^\d+(?:\.\d+)?(?:ml|g|kg|mg|l|매|매입|개|개입|회|회분|회분량|ea|p|pcs|종|호|cm|mm|oz|일|주|개월|분)?$/;
const LEADING_DIGITS_RE = /^\d+(?=[가-힣])/;
const PERCENT_RE = /^\d+(?:\.\d+)?%$/;
const PROMO_TOKENS = new Set([
  "new",
  "set",
  "sale",
  "event",
  "gift",
  "mini",
  "best",
  "hot",
  "only",
  "기획",
  "세트",
  "증정",
  "단품",
  "리필",
  "대용량",
  "사이즈",
  "size",
  "본품",
  "정품",
  "한정",
  "신제품",
  "특가",
  "1+1",
  "및",
  "the",
  "and",
  "for",
  "of",
]);
const DIGIT_RE = /\d/;
const LATIN_ALIAS_RE = /^[A-Za-z][A-Za-z0-9 .+-]{1,20}$/;
const REGEX_SPECIAL_RE = /[.*+?^${}()|[\]\\]/g;

function stripNames(text: string, brandNames: readonly string[]): string {
  let out = text;
  for (const name of [...brandNames].sort((a, b) => b.length - a.length)) {
    if (name.trim().length >= 2) {
      out = out.replace(
        new RegExp(name.trim().replace(REGEX_SPECIAL_RE, "\\$&"), "gi"),
        " "
      );
    }
  }
  return out;
}

export interface OfferingTokens {
  /** 괄호 속 영문 별칭(「TechDD」) — 키워드 대조에만 쓰고 질문·씨앗 문장에는 넣지 않는다. */
  aliases: Array<{ compact: string; display: string }>;
  /** 프로필 낱말이 아닌 사양(「10%」) — 대표 상품 설명에만 쓴다. */
  features: string[];
  head: { compact: string; display: string } | null;
  modifiers: Array<{ compact: string; display: string }>;
}

/** 이름 하나 → head·modifier·사양. 괄호 속 영문 별칭(「(TechDD)」)은 modifier, 그 밖 괄호는 버린다. */
export function offeringTokens(
  name: string,
  brandNames: readonly string[]
): OfferingTokens {
  const aliases: string[] = [];
  const withoutBrackets = name.replace(
    BRACKET_RE,
    (_m, round: string | undefined, square: string | undefined) => {
      const inner = (round ?? square ?? "").trim();
      if (LATIN_ALIAS_RE.test(inner) && !DIGIT_RE.test(inner)) {
        aliases.push(inner);
      }
      return " ";
    }
  );
  const text = stripNames(withoutBrackets, brandNames);
  const kept: Array<{ compact: string; display: string }> = [];
  const features: string[] = [];
  for (const raw of text.split(TOKEN_SPLIT_RE)) {
    const display = raw.trim();
    const lower = display.toLowerCase();
    if (!display) {
      continue;
    }
    if (PERCENT_RE.test(lower)) {
      features.push(display);
      continue;
    }
    if (SIZE_TOKEN_RE.test(lower) || PROMO_TOKENS.has(lower)) {
      continue;
    }
    const cleaned = display.replace(LEADING_DIGITS_RE, "");
    const compact = compactTerm(cleaned);
    if (
      compact.length < 2 ||
      KO_QUALIFIERS[compact] !== undefined ||
      EN_QUALIFIERS[compact] !== undefined ||
      EN_DROPPED.has(compact)
    ) {
      continue;
    }
    kept.push({ compact, display: cleaned });
  }
  const head = kept.at(-1) ?? null;
  const modifiers = kept.slice(0, -1);
  const aliasTokens = aliases
    .map((alias) => ({ compact: compactTerm(alias), display: alias }))
    .filter(
      (a) =>
        a.compact.length >= 2 &&
        !modifiers.some((m) => m.compact === a.compact) &&
        a.compact !== head?.compact &&
        // 「[FRANZ]」처럼 괄호 속 브랜드 이름은 별칭이 아니다.
        !brandNames.some((n) => {
          const key = compactTerm(n);
          return (
            key.length >= 2 &&
            (a.compact.includes(key) || key.includes(a.compact))
          );
        })
    );
  return { aliases: aliasTokens, head, modifiers, features };
}

/** 대표 head 기준 — 이 수 이상의 상품·서비스 이름이 같은 head 로 끝난다. */
export const CORE_HEAD_MIN_OFFERINGS = 3;

export function profileTermsFromNames(
  names: readonly string[],
  brandNames: readonly string[]
): ProfileTerms {
  const heads = new Map<string, { count: number; display: string }>();
  const modifiers = new Map<string, { display: string }>();
  for (const name of names) {
    const tokens = offeringTokens(name, brandNames);
    if (tokens.head) {
      const entry = heads.get(tokens.head.compact) ?? {
        count: 0,
        display: tokens.head.display,
      };
      entry.count += 1;
      heads.set(tokens.head.compact, entry);
    }
    for (const m of [...tokens.modifiers, ...tokens.aliases]) {
      if (!modifiers.has(m.compact)) {
        modifiers.set(m.compact, { display: m.display });
      }
    }
  }
  const coreHeads = new Set(
    [...heads.entries()]
      .filter(([, v]) => v.count >= CORE_HEAD_MIN_OFFERINGS)
      .map(([k]) => k)
  );
  return {
    heads,
    modifiers,
    coreHeads,
    profileText: names.map(compactTerm).join("|"),
  };
}

// ── 키워드 분해 ──────────────────────────────────────────────────────
interface Segment {
  display: string;
  entry: DictEntry | null;
  text: string;
}

function buildDictionary(terms: ProfileTerms): Map<string, DictEntry> {
  const dict = new Map<string, DictEntry>();
  const add = (key: string, entry: DictEntry) => {
    if (key.length >= 2 && !dict.has(key)) {
      dict.set(key, entry);
    }
  };
  for (const [key, v] of terms.heads) {
    add(key, { kind: "head", display: v.display });
  }
  for (const [key, v] of terms.modifiers) {
    add(key, { kind: "modifier", display: v.display });
  }
  for (const [form, intent] of Object.entries(KO_QUALIFIERS)) {
    add(form, {
      kind: "qualifier",
      display: form,
      ...(intent ? { intent } : {}),
    });
  }
  for (const form of KO_DROPPED) {
    add(form, { kind: "qualifier", display: form, drop: true });
  }
  add("에좋은", {
    kind: "qualifier",
    display: "에좋은",
    drop: true,
    purposeMarker: "before",
  });
  for (const [form, intent] of Object.entries(EN_QUALIFIERS)) {
    add(form, {
      kind: "qualifier",
      display: form,
      ...(intent ? { intent } : {}),
    });
  }
  for (const form of EN_DROPPED) {
    dict.set(form, {
      kind: "qualifier",
      display: form,
      drop: true,
      ...(form === "for" ? { purposeMarker: "after" as const } : {}),
    });
  }
  for (const form of [...KO_NEGATIVE, ...EN_NEGATIVE]) {
    if (!terms.profileText.includes(form)) {
      add(form, { kind: "negative", display: form });
    }
  }
  return dict;
}

/** 원문 키워드 → 소문자 정규형 + 낱말 경계(공백이 있던 자리). */
function normalizeKeyword(keyword: string): {
  boundaries: Set<number>;
  text: string;
} {
  const boundaries = new Set<number>();
  let text = "";
  for (const word of keyword.toLowerCase().split(WHITESPACE_RE)) {
    const compact = word.replace(COMPACT_RE, "").replace(NON_WORD_RE, "");
    if (compact) {
      boundaries.add(text.length);
      text += compact;
    }
  }
  boundaries.add(text.length);
  return { boundaries, text };
}

const isLatinChar = (c: string | undefined) =>
  c !== undefined && LATIN_CHAR_RE.test(c);

function latinBoundaryOk(
  text: string,
  start: number,
  end: number,
  boundaries: Set<number>
): boolean {
  const word = text.slice(start, end);
  if (!LATIN_RE.test(word)) {
    return true;
  }
  const leftOk = boundaries.has(start) || !isLatinChar(text[start - 1]);
  const rightOk = boundaries.has(end) || !isLatinChar(text[end]);
  return leftOk && rightOk;
}

/** 조각(사전에 없는 글자) 수가 가장 적고, 그다음 낱말 수가 가장 적은 분해. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a single dynamic-programming pass plus its back-trace.
function segmentKeyword(
  keyword: string,
  dict: Map<string, DictEntry>
): Segment[] {
  const { text, boundaries } = normalizeKeyword(keyword);
  const n = text.length;
  const maxLen = Math.min(30, n);
  const best: Array<{
    entry: DictEntry | null;
    leftover: number;
    prev: number;
    tokens: number;
  }> = Array.from({ length: n + 1 }, () => ({
    entry: null,
    leftover: Number.POSITIVE_INFINITY,
    prev: -1,
    tokens: Number.POSITIVE_INFINITY,
  }));
  best[0] = { entry: null, leftover: 0, prev: -1, tokens: 0 };
  const better = (
    a: { leftover: number; tokens: number },
    b: { leftover: number; tokens: number }
  ) =>
    a.leftover < b.leftover ||
    (a.leftover === b.leftover && a.tokens < b.tokens);
  for (let i = 1; i <= n; i += 1) {
    const target = best[i] as (typeof best)[number];
    for (let j = Math.max(0, i - maxLen); j < i; j += 1) {
      const from = best[j] as (typeof best)[number];
      if (from.leftover === Number.POSITIVE_INFINITY) {
        continue;
      }
      const word = text.slice(j, i);
      const entry = dict.get(word);
      if (entry && latinBoundaryOk(text, j, i, boundaries)) {
        const candidate = {
          leftover: from.leftover,
          tokens: from.tokens + 1,
        };
        if (better(candidate, target)) {
          best[i] = { ...candidate, entry, prev: j };
        }
      }
    }
    const prevStep = best[i - 1] as (typeof best)[number];
    const leftoverCandidate = {
      leftover: prevStep.leftover + 1,
      tokens: prevStep.tokens + 1,
    };
    if (better(leftoverCandidate, best[i] as (typeof best)[number])) {
      best[i] = { ...leftoverCandidate, entry: null, prev: i - 1 };
    }
  }
  const raw: Array<{ end: number; entry: DictEntry | null; start: number }> =
    [];
  let i = n;
  while (i > 0) {
    const step = best[i] as (typeof best)[number];
    raw.unshift({ start: step.prev, end: i, entry: step.entry });
    i = step.prev;
  }
  // 이웃한 조각 글자를 하나로 합친다(공백 경계·문자 종류가 바뀌면 끊는다).
  const segments: Segment[] = [];
  for (const piece of raw) {
    const pieceText = text.slice(piece.start, piece.end);
    const last = segments.at(-1);
    if (
      piece.entry === null &&
      last &&
      last.entry === null &&
      !boundaries.has(piece.start) &&
      isLatinChar(pieceText) === isLatinChar(last.text.at(-1))
    ) {
      last.text += pieceText;
      last.display += pieceText;
      continue;
    }
    segments.push({
      text: pieceText,
      display: piece.entry?.display ?? pieceText,
      entry: piece.entry,
    });
  }
  return segments;
}

export type RelevanceReason =
  | "brand"
  | "brandExact"
  | "otherBrand"
  | "unrelated"
  | "unmatched";

export interface RelevantKeyword {
  /** 질문에 넣는 핵심 표현(의도 낱말 제외, 「PDRN 앰플」「AI 교육」). */
  core: string;
  /** 어순·표기 차이를 합치는 키. */
  coreKey: string;
  hasModifier: boolean;
  head: string;
  intents: KeywordIntent[];
  /** 사전에 없던 조각(검토용). */
  leftover: string[];
  ok: true;
  /** 「주름에 좋은」「for wrinkles」의 용도 표현. */
  purpose: string | null;
  /** 0 = 프로필 낱말만 · 1 = 프로필 낱말 + 조각 · 2 = 대표 head + 조각/의도(검색량보다 먼저 본다). */
  tier: 0 | 1 | 2;
}

export type RelevanceVerdict =
  | RelevantKeyword
  | { ok: false; reason: RelevanceReason };

export interface RelevanceContext {
  /** 상품(commerce) 브랜드만 「대표 head + 의도/조각」(「앰플추천」「주름앰플」)을 받는다. */
  allowHeadOnly: boolean;
  brandKeys: string[];
  dict: Map<string, DictEntry>;
  otherKeys: string[];
  terms: ProfileTerms;
}

export function relevanceContext(
  terms: ProfileTerms,
  brandNames: readonly string[],
  otherBrandNames: readonly string[] = [],
  options: { allowHeadOnly?: boolean } = {}
): RelevanceContext {
  const keys = (names: readonly string[]) =>
    [...new Set(names.map(compactTerm).filter((k) => k.length >= 2))].sort(
      (a, b) => b.length - a.length
    );
  return {
    allowHeadOnly: options.allowHeadOnly ?? true,
    terms,
    dict: buildDictionary(terms),
    brandKeys: keys(brandNames),
    otherKeys: keys(otherBrandNames).filter(
      (k) => !keys(brandNames).includes(k)
    ),
  };
}

const MAX_HANGUL_LEFTOVER = 4;

function tierOf(hasModifier: boolean, leftoverCount: number): 0 | 1 | 2 {
  if (!hasModifier) {
    return 2;
  }
  return leftoverCount > 0 ? 1 : 0;
}
const MIN_ABBREVIATION = 3;
const HANGUL_ONLY_RE = /^[가-힣]+$/;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one ordered decision table keeps the relevance rules auditable in one place.
export function classifyKeywordRelevance(
  keyword: string,
  ctx: RelevanceContext
): RelevanceVerdict {
  const compact = compactTerm(keyword);
  if (!compact) {
    return { ok: false, reason: "unmatched" };
  }
  if (ctx.brandKeys.some((b) => compact.includes(b))) {
    return {
      ok: false,
      reason: ctx.brandKeys.includes(compact) ? "brandExact" : "brand",
    };
  }
  if (ctx.otherKeys.some((o) => compact.includes(o))) {
    return { ok: false, reason: "otherBrand" };
  }
  const segments = segmentKeyword(keyword, ctx.dict);
  if (segments.some((s) => s.entry?.kind === "negative")) {
    return { ok: false, reason: "unrelated" };
  }
  const intents = new Set<KeywordIntent>();
  let purpose: string | null = null;
  const purposeIdx = new Set<number>();
  for (const [index, s] of segments.entries()) {
    if (s.entry?.intent) {
      intents.add(s.entry.intent);
    }
    if (s.entry?.purposeMarker === "before") {
      const prev = segments[index - 1];
      if (prev && prev.entry?.kind !== "head") {
        purpose = prev.display;
        purposeIdx.add(index - 1);
      }
    }
    if (s.entry?.purposeMarker === "after") {
      const rest = segments
        .slice(index + 1)
        .filter((r) => r.entry === null || r.entry.kind === "qualifier");
      const words = rest
        .filter((r) => !r.entry?.drop)
        .map((r) => r.display)
        .join(" ");
      if (words) {
        purpose = words;
        for (let k = index + 1; k < segments.length; k += 1) {
          if (rest.includes(segments[k] as Segment)) {
            purposeIdx.add(k);
          }
        }
      }
    }
  }
  // 용도 부분(「for skin」)의 낱말은 상품 표현(head)이 아니다.
  const heads = segments.filter(
    (s, index) => s.entry?.kind === "head" && !purposeIdx.has(index)
  );
  if (heads.length === 0) {
    return { ok: false, reason: "unmatched" };
  }
  // 줄임말: 상품명의 긴 낱말 앞부분(「줄기세포배양액」 → 「줄기세포」)은 같은 낱말로 본다(한글 3자 이상).
  for (const s of segments) {
    if (
      s.entry === null &&
      s.text.length >= MIN_ABBREVIATION &&
      HANGUL_ONLY_RE.test(s.text) &&
      [...ctx.terms.modifiers.keys()].some(
        (m) => m.length > s.text.length && m.startsWith(s.text)
      )
    ) {
      s.entry = { kind: "modifier", display: s.text };
    }
  }
  const leftovers = segments.filter(
    (s, index) => s.entry === null && !purposeIdx.has(index)
  );
  if (leftovers.some((s) => LATIN_CHAR_RE.test(s.text))) {
    // 영어 조각 = 다른 브랜드·모르는 낱말일 가능성이 크다(「medicube」「the ordinary」).
    return { ok: false, reason: "unmatched" };
  }
  const hangulLeftover = leftovers.reduce(
    (sum, s) => sum + (HANGUL_RE.test(s.text) ? s.text.length : 0),
    0
  );
  if (hangulLeftover > MAX_HANGUL_LEFTOVER) {
    return { ok: false, reason: "unmatched" };
  }
  // 프로필 낱말이 둘 이상(modifier + head, 또는 head 두 개 「PDRN앰플」)이면 이 브랜드의 상품 표현이다.
  const hasModifier =
    segments.some((s) => s.entry?.kind === "modifier") ||
    new Set(heads.map((h) => h.text)).size > 1;
  const head = (heads.at(-1) as Segment).text;
  const isCore = ctx.terms.coreHeads.has(head);
  const headOnlyOk =
    ctx.allowHeadOnly && isCore && (intents.size > 0 || leftovers.length > 0);
  if (!(hasModifier || purpose || headOnlyOk)) {
    // head 단독(「앰플」·「컨설팅추천」·「직무교육」) — 상품 브랜드의 대표 head 일 때만 받는다.
    return { ok: false, reason: "unmatched" };
  }
  const coreSegments = segments.filter(
    (s, index) =>
      !purposeIdx.has(index) &&
      (s.entry === null ||
        s.entry.kind === "head" ||
        s.entry.kind === "modifier" ||
        (s.entry.kind === "qualifier" && !s.entry.intent && !s.entry.drop))
  );
  // 같은 낱말이 두 번(「serum … serum」)이면 한 번만.
  const seen = new Set<string>();
  const core = coreSegments.filter((s) => {
    if (seen.has(s.text)) {
      return false;
    }
    seen.add(s.text);
    return true;
  });
  return {
    ok: true,
    core: core.map((s) => s.display).join(" "),
    coreKey: core
      .map((s) => s.text)
      .sort()
      .join("+"),
    hasModifier,
    head,
    intents: [...intents].sort(),
    leftover: leftovers.map((s) => s.text),
    purpose,
    tier: tierOf(hasModifier, leftovers.length),
  };
}

/** 다른 뜻(의료·연구·채용 등) 낱말인가 — 데이터로 찾은 영어 head 후보를 거를 때 쓴다. */
export function isOtherSenseTerm(word: string): boolean {
  const key = compactTerm(word);
  return KO_NEGATIVE.includes(key) || EN_NEGATIVE.includes(key);
}

/** 의도·한정어(「best」「skin」「추천」)인가 — 데이터로 찾은 head 후보에서 뺀다. */
export function isQualifierTerm(word: string): boolean {
  const key = compactTerm(word);
  return (
    KO_QUALIFIERS[key] !== undefined ||
    EN_QUALIFIERS[key] !== undefined ||
    EN_DROPPED.has(key) ||
    KO_DROPPED.has(key)
  );
}

/** 키워드에 프로필 낱말 하나라도 들어 있는가(대표 상품 설명의 「일반 낱말」 판정용). */
export function keywordUniverseHas(
  universe: readonly string[],
  token: string
): boolean {
  const key = compactTerm(token);
  return key.length >= 2 && universe.some((k) => compactTerm(k).includes(key));
}
