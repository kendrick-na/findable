// 실제 수요 기반 「이름 없는 구매 질문」 생성 — 순수 함수 (2026-10-06, 측정 알고리즘 v3 §2-③)
//
// 왜: 이름 없는 질문(discovery)은 지금까지 공식 사이트 제목 조각에서만 만들었다
//   (`audit-prompts.ts generateDiscoveryPrompts`). 프란츠처럼 제목에 업종 단서가 없으면 0개였고,
//   있더라도 「실제로 사람들이 그렇게 묻는지」를 확인할 방법이 없었다.
//   → 공식몰 제품명(brand-catalog) → 씨앗 키워드 → **실측 월 검색량**(네이버·구글) →
//     검색량 높은 카테고리 키워드 → 사람이 묻는 말투의 질문. 질문마다 출처 키워드·검색량을 남긴다.
//
// 원칙
//   1. 결정적이다 — 같은 입력이면 같은 질문(LLM 미사용. 문장은 주제별 고정 틀).
//   2. **보수적으로 거른다** — 키워드를 사전 낱말로 끝까지 쪼갤 수 있을 때만 쓴다.
//      사전 = 이 브랜드 제품명에서 확인된 성분·제형 + 피부고민·의도 낱말. 모르는 조각(다른 브랜드
//      「아누아」, 시술 「주사」, 쇼핑 「쇼핑몰」)이 하나라도 있으면 버린다.
//      → 다른 브랜드 사전이 없어도 다른 브랜드 키워드가 들어오지 못한다(모르는 낱말 = 탈락).
//   3. 브랜드 자신의 이름이 들어간 키워드는 버린다(「프란츠」「franz ferdinand」) — 이름 없는 질문이다.
//   4. 성분 사전은 **화장품(K-뷰티) 중심**이다. 다른 업종은 제품명에서 대문자 약어(PDRN·EGF)만
//      핵심어로 인정되므로 질문이 0개일 수 있다 → 그때는 러너가 기존 사이트 기반 질문으로 돌아간다.
//
// 표기: 주제(topic) 이름은 리포트가 한국어라 시장과 무관하게 한국어다.

export type DemandMarket = "KR" | "US";
export type DemandTopic =
  | "제품 추천"
  | "효능·성분"
  | "가격·가성비"
  | "피부고민"
  | "사용법";
export const DEMAND_TOPICS: readonly DemandTopic[] = [
  "제품 추천",
  "효능·성분",
  "가격·가성비",
  "피부고민",
  "사용법",
];

export interface DemandKeyword {
  keyword: string;
  /** 「< 10」처럼 근사값이면 true — 질문 씨앗으로 쓰지 않는다. */
  lowVolume?: boolean;
  source: "naver" | "google";
  /** 월 검색수(네이버 = PC+모바일, 구글 = 월 평균). */
  volume: number;
}

/** 질문 하나의 출처 — 리포트·검토자가 「왜 이 질문인가」를 확인하는 근거. */
export interface DemandProvenance {
  /**
   * true = 같은 핵심어의 다른 주제로 넓힌 질문(그 주제의 키워드는 검색량 데이터에 없었다).
   * 검색량은 출처 키워드의 값이다.
   */
  expanded: boolean;
  keyword: string;
  market: DemandMarket;
  source: "naver" | "google";
  topic: DemandTopic;
  volume: number;
}

export interface DemandQuestion extends DemandProvenance {
  lang: "ko" | "en";
  text: string;
}

export interface DemandQuestionSet {
  /**
   * 브랜드 이름 단독 키워드의 검색량(참고값 — 질문에는 쓰지 않는다).
   * ⚠️ 동명(예: 미국 「franz」 = 밴드 Franz Ferdinand 등)이 섞인 값일 수 있다.
   */
  brandVolume: Partial<Record<DemandMarket, DemandKeyword | null>>;
  excluded: Record<
    DemandMarket,
    { brand: number; lowVolume: number; otherBrand: number; unmatched: number }
  >;
  questions: Record<DemandMarket, DemandQuestion[]>;
  version: 1;
}

type ConceptKind = "ingredient" | "type" | "concern";
interface Concept {
  /** en 폼: 공백 포함 원형. 비교는 compact 로 한다. */
  en: string[];
  id: string;
  kind: ConceptKind;
  ko: string[];
}

// ── 사전 ─────────────────────────────────────────────────────────────
// 제형(type). 앰플 → 미국 소비자는 serum 이라 부른다(같은 제형으로 취급).
const TYPE_CONCEPTS: Concept[] = [
  { id: "ampoule", kind: "type", ko: ["앰플"], en: ["ampoule", "serum"] },
  { id: "serum", kind: "type", ko: ["세럼"], en: ["serum"] },
  { id: "essence", kind: "type", ko: ["에센스"], en: ["essence"] },
  { id: "eyecream", kind: "type", ko: ["아이크림"], en: ["eye cream"] },
  { id: "suncream", kind: "type", ko: ["선크림", "썬크림"], en: ["sunscreen"] },
  { id: "cream", kind: "type", ko: ["크림"], en: ["cream", "moisturizer"] },
  { id: "toner", kind: "type", ko: ["토너"], en: ["toner"] },
  { id: "lotion", kind: "type", ko: ["로션"], en: ["lotion"] },
  {
    id: "sheetmask",
    kind: "type",
    ko: ["마스크팩", "시트마스크"],
    en: ["sheet mask", "face mask"],
  },
  { id: "mask", kind: "type", ko: ["마스크"], en: ["mask"] },
  { id: "patch", kind: "type", ko: ["패치"], en: ["patch", "patches"] },
  {
    id: "cleanser",
    kind: "type",
    ko: ["클렌저", "클렌징폼"],
    en: ["cleanser"],
  },
  { id: "mist", kind: "type", ko: ["미스트"], en: ["mist"] },
  { id: "pad", kind: "type", ko: ["패드"], en: ["pad", "pads"] },
  { id: "balm", kind: "type", ko: ["밤"], en: ["balm"] },
  { id: "booster", kind: "type", ko: ["부스터"], en: ["booster"] },
];

// 성분(ingredient). 제품명에 나온 것만 그 브랜드의 핵심어가 된다.
const INGREDIENT_CONCEPTS: Concept[] = [
  {
    id: "stemcell",
    kind: "ingredient",
    ko: ["줄기세포", "줄기세포배양액"],
    en: ["stem cell"],
  },
  {
    id: "hyaluronic",
    kind: "ingredient",
    ko: ["히알루론산"],
    en: ["hyaluronic acid"],
  },
  { id: "peptide", kind: "ingredient", ko: ["펩타이드"], en: ["peptide"] },
  { id: "collagen", kind: "ingredient", ko: ["콜라겐"], en: ["collagen"] },
  { id: "retinol", kind: "ingredient", ko: ["레티놀"], en: ["retinol"] },
  {
    id: "niacinamide",
    kind: "ingredient",
    ko: ["나이아신아마이드"],
    en: ["niacinamide"],
  },
  { id: "vitaminc", kind: "ingredient", ko: ["비타민c"], en: ["vitamin c"] },
  {
    id: "cica",
    kind: "ingredient",
    ko: ["시카", "병풀"],
    en: ["cica", "centella"],
  },
  { id: "ceramide", kind: "ingredient", ko: ["세라마이드"], en: ["ceramide"] },
  { id: "exosome", kind: "ingredient", ko: ["엑소좀"], en: ["exosome"] },
  { id: "panthenol", kind: "ingredient", ko: ["판테놀"], en: ["panthenol"] },
  { id: "snail", kind: "ingredient", ko: ["달팽이"], en: ["snail mucin"] },
  { id: "propolis", kind: "ingredient", ko: ["프로폴리스"], en: ["propolis"] },
  { id: "heartleaf", kind: "ingredient", ko: ["어성초"], en: ["heartleaf"] },
  { id: "bakuchiol", kind: "ingredient", ko: ["바쿠치올"], en: ["bakuchiol"] },
  {
    id: "glutathione",
    kind: "ingredient",
    ko: ["글루타치온"],
    en: ["glutathione"],
  },
  { id: "salmon", kind: "ingredient", ko: ["연어"], en: ["salmon"] },
];

// 피부고민(concern) — 어느 브랜드에나 쓸 수 있는 구매 동기.
const CONCERN_CONCEPTS: Concept[] = [
  {
    id: "wrinkle",
    kind: "concern",
    ko: ["주름"],
    en: ["wrinkles", "wrinkle", "fine lines"],
  },
  { id: "brightening", kind: "concern", ko: ["미백"], en: ["brightening"] },
  {
    id: "darkspot",
    kind: "concern",
    ko: ["기미", "잡티"],
    en: ["dark spots", "hyperpigmentation", "melasma"],
  },
  { id: "pore", kind: "concern", ko: ["모공"], en: ["pores"] },
  {
    id: "acne",
    kind: "concern",
    ko: ["여드름", "트러블"],
    en: ["acne", "breakouts"],
  },
  {
    id: "firming",
    kind: "concern",
    ko: ["탄력", "리프팅"],
    en: ["firming", "sagging skin"],
  },
  {
    id: "hydration",
    kind: "concern",
    ko: ["수분", "보습"],
    en: ["hydration", "dry skin"],
  },
  {
    id: "soothing",
    kind: "concern",
    ko: ["진정", "홍조"],
    en: ["redness", "sensitive skin"],
  },
  { id: "scar", kind: "concern", ko: ["흉터"], en: ["scars", "acne scars"] },
  { id: "texture", kind: "concern", ko: ["피부결"], en: ["texture"] },
  {
    id: "aging",
    kind: "concern",
    ko: ["노화", "안티에이징"],
    en: ["anti aging", "antiaging", "aging"],
  },
  { id: "darkcircle", kind: "concern", ko: ["다크서클"], en: ["dark circles"] },
  { id: "oily", kind: "concern", ko: ["지성"], en: ["oily skin"] },
];

type Intent = "rec" | "eff" | "price" | "use" | "neutral";
const KO_MODIFIERS: Record<string, Intent> = {
  추천: "rec",
  순위: "rec",
  랭킹: "rec",
  인기: "rec",
  베스트: "rec",
  후기: "rec",
  리뷰: "rec",
  브랜드: "rec",
  종류: "rec",
  효과: "eff",
  효능: "eff",
  성분: "eff",
  부작용: "eff",
  차이: "eff",
  가격: "price",
  가성비: "price",
  저렴한: "price",
  사용법: "use",
  바르는법: "use",
  바르는순서: "use",
  사용순서: "use",
  순서: "use",
  루틴: "use",
  화장품: "neutral",
  제품: "neutral",
  스킨케어: "neutral",
  기초: "neutral",
  피부: "neutral",
  얼굴: "neutral",
  여자: "neutral",
  남자: "neutral",
  남성: "neutral",
  여성: "neutral",
  에좋은: "neutral",
  좋은: "neutral",
};
const EN_MODIFIERS: Record<string, Intent> = {
  best: "rec",
  top: "rec",
  good: "rec",
  recommended: "rec",
  review: "rec",
  reviews: "rec",
  brand: "rec",
  brands: "rec",
  benefits: "eff",
  benefit: "eff",
  ingredients: "eff",
  results: "eff",
  sideeffects: "eff",
  whatis: "eff",
  vs: "eff",
  cheap: "price",
  affordable: "price",
  budget: "price",
  price: "price",
  drugstore: "price",
  howtouse: "use",
  howtoapply: "use",
  routine: "use",
  korean: "neutral",
  kbeauty: "neutral",
  face: "neutral",
  facial: "neutral",
  skin: "neutral",
  skincare: "neutral",
  for: "neutral",
  the: "neutral",
  with: "neutral",
  and: "neutral",
  product: "neutral",
  products: "neutral",
  women: "neutral",
  men: "neutral",
};

// 제품명에서 대문자 약어(PDRN·EGF·NAD+)를 핵심 성분으로 인정한다. 판촉 낱말은 제외.
const ACRONYM_RE = /(?<![A-Za-z])[A-Z][A-Z0-9]{1,5}\+?(?![A-Za-z])/g;
const ACRONYM_STOP = new Set([
  "NEW",
  "SET",
  "MINI",
  "BEST",
  "SALE",
  "EVENT",
  "GIFT",
  "KIT",
  "PLUS",
  "PRO",
  "EX",
  "ML",
  "MG",
  "EA",
  "SPF",
  "PA",
  "UV",
  "BIG",
  "HOT",
  "TOP",
  "ONLY",
  "DAY",
  "AND",
  "THE",
  "FOR",
  "SKIN",
  "CARE",
]);
const COMPACT_RE = /[\s\-_./·]+/g;
const BRACKETED_RE = /\([^)]*\)|\[[^\]]*\]/g;
const NON_WORD_RE = /[^0-9a-z가-힣+]/g;
const POLITE_END_RE = /(요|까요|나요|세요|니다|ㅠ+|ㅜ+)\s*[?？!.]*$/;
const CASUAL_END_RE = /(줘|해|야|냐|나|까|지)\s*[?？!.]*$/;
const HANGUL_RE = /[가-힣]/;

const DEFAULT_MAX_PER_MARKET = 8;
const DEFAULT_MIN_PER_MARKET = 6;
const ABSOLUTE_MAX_PER_MARKET = 12;
const DEFAULT_MIN_VOLUME = 30;
const MAX_SEEDS = 10;
// 성분 단독 검색(「줄기세포」「stem cell」「PDRN」)은 의료·연구 검색이 섞여 화장품 수요가 아니다
//   (미국 「stem cell」 월 60,500 실측). 의도 낱말(효과·benefits)이나 이 맥락 낱말이 있을 때만 쓴다.
const BEAUTY_CONTEXT = new Set([
  "화장품",
  "스킨케어",
  "기초",
  "피부",
  "얼굴",
  "skin",
  "skincare",
  "face",
  "facial",
  "kbeauty",
]);
/** 한 주제가 질문 자리를 독차지하지 않게(검색량이 한 주제에 몰려도 다른 주제를 남긴다). */
const MAX_PER_TOPIC = 3;

export function compactKeyword(value: string): string {
  return value.toLowerCase().replace(COMPACT_RE, "").replace(NON_WORD_RE, "");
}

const formsOf = (concept: Concept, lang: "ko" | "en"): string[] =>
  lang === "ko" ? concept.ko : concept.en;

// ── 제품명 → 이 브랜드의 성분·제형 ──────────────────────────────────
export interface CatalogVocabulary {
  /** 대문자 약어(PDRN 등) 포함 성분 개념. */
  ingredients: Concept[];
  /** 같은 제품명에 함께 나온 (성분, 제형) 쌍과 제품 수. 씨앗 우선순위에 쓴다. */
  pairs: Array<{ count: number; ingredient: Concept; type: Concept }>;
  types: Concept[];
}

function acronymConcept(acronym: string): Concept {
  return {
    id: `acr:${acronym}`,
    kind: "ingredient",
    ko: [acronym.toLowerCase()],
    en: [acronym.toLowerCase()],
  };
}

/** 제품명에서 사전 개념을 왼쪽부터 가장 긴 것 우선으로 찾는다. */
function scanConcepts(compact: string, concepts: Concept[]): Concept[] {
  const forms = concepts
    .flatMap((concept) =>
      [...concept.ko, ...concept.en].map((form) => ({
        concept,
        form: compactKeyword(form),
      }))
    )
    .filter((f) => f.form.length >= 2)
    .sort((a, b) => b.form.length - a.form.length);
  const found: Concept[] = [];
  let i = 0;
  while (i < compact.length) {
    const hit = forms.find((f) => compact.startsWith(f.form, i));
    if (hit) {
      if (!found.includes(hit.concept)) {
        found.push(hit.concept);
      }
      i += hit.form.length;
    } else {
      i += 1;
    }
  }
  return found;
}

function stripNames(text: string, brandNames: readonly string[]): string {
  let out = text;
  for (const name of brandNames) {
    if (name && name.length >= 2) {
      out = out.replace(new RegExp(escapeRegExp(name), "gi"), " ");
    }
  }
  return out;
}

const REGEX_SPECIAL_RE = /[.*+?^${}()|[\]\\]/g;
function escapeRegExp(value: string): string {
  return value.replace(REGEX_SPECIAL_RE, "\\$&");
}

export function catalogVocabulary(
  products: ReadonlyArray<{ name: string }>,
  brandNames: readonly string[]
): CatalogVocabulary {
  const ingredients = new Map<string, Concept>();
  const types = new Map<string, Concept>();
  const pairCount = new Map<
    string,
    { count: number; ingredient: Concept; type: Concept }
  >();
  const brandKeys = brandNames.map(compactKeyword).filter((k) => k.length >= 2);
  for (const product of products) {
    // 괄호 속은 포장·증정 메모다(「(CJ스티커)」「[1+1]」) — 성분·제형으로 읽지 않는다.
    const text = stripNames(
      product.name.replace(BRACKETED_RE, " "),
      brandNames
    );
    const productIngredients: Concept[] = [];
    for (const match of text.matchAll(ACRONYM_RE)) {
      const acronym = match[0];
      const key = compactKeyword(acronym);
      if (
        ACRONYM_STOP.has(acronym.replace("+", "")) ||
        brandKeys.some((b) => b.includes(key) || key.includes(b))
      ) {
        continue;
      }
      const concept =
        ingredients.get(`acr:${acronym}`) ?? acronymConcept(acronym);
      productIngredients.push(concept);
    }
    const compact = compactKeyword(text);
    const scanned = scanConcepts(compact, [
      ...TYPE_CONCEPTS,
      ...INGREDIENT_CONCEPTS,
    ]);
    productIngredients.push(...scanned.filter((c) => c.kind === "ingredient"));
    const productTypes = scanned.filter((c) => c.kind === "type");
    for (const c of productIngredients) {
      ingredients.set(c.id, c);
    }
    for (const t of productTypes) {
      types.set(t.id, t);
    }
    for (const ing of new Set(productIngredients)) {
      for (const type of new Set(productTypes)) {
        const key = `${ing.id}|${type.id}`;
        const entry = pairCount.get(key) ?? { count: 0, ingredient: ing, type };
        entry.count += 1;
        pairCount.set(key, entry);
      }
    }
  }
  const pairs = [...pairCount.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.ingredient.id.localeCompare(b.ingredient.id) ||
      a.type.id.localeCompare(b.type.id)
  );
  const byPairs = (a: Concept, b: Concept) => {
    const score = (c: Concept) =>
      pairs
        .filter((p) => p.ingredient === c || p.type === c)
        .reduce((s, p) => s + p.count, 0);
    return score(b) - score(a) || a.id.localeCompare(b.id);
  };
  return {
    ingredients: [...ingredients.values()].sort(byPairs),
    types: [...types.values()].sort(byPairs),
    pairs,
  };
}

/** 검색량 조회용 씨앗 — 국내(한국어, 공백 없음)·미국(영어). 브랜드 이름 1개를 참고값으로 덧붙인다. */
export function demandSeedKeywords(
  vocabulary: CatalogVocabulary,
  brandNames: { en?: string | null; ko?: string | null }
): Record<DemandMarket, string[]> {
  const ko: string[] = [];
  const en: string[] = [];
  const push = (list: string[], value: string) => {
    const v = value.trim();
    if (v && !list.includes(v) && list.length < MAX_SEEDS - 1) {
      list.push(v);
    }
  };
  const koForm = (c: Concept) =>
    c.id.startsWith("acr:") ? (c.id.slice(4) as string) : (c.ko[0] ?? "");
  const enForm = (c: Concept) =>
    c.id.startsWith("acr:") ? c.id.slice(4).toLowerCase() : (c.en[0] ?? "");
  for (const pair of vocabulary.pairs) {
    push(ko, `${koForm(pair.ingredient)}${pair.type.ko[0] ?? ""}`);
    for (const typeForm of pair.type.en) {
      push(en, `${enForm(pair.ingredient)} ${typeForm}`);
    }
  }
  for (const ing of vocabulary.ingredients) {
    push(ko, koForm(ing));
    push(en, enForm(ing));
  }
  if (brandNames.ko) {
    ko.push(brandNames.ko.replace(COMPACT_RE, ""));
  }
  if (brandNames.en) {
    en.push(brandNames.en.toLowerCase());
  }
  return { KR: ko, US: en };
}

// ── 키워드 해석 ─────────────────────────────────────────────────────
interface Token {
  concept?: Concept;
  form: string;
  intent?: Intent;
}

interface KeywordAnalysis {
  concern: Concept | null;
  /** 키워드에 실제로 쓰인 고민 표기(「수분」「dry skin」). */
  concernForm: string | null;
  coreForms: Token[];
  /** 「화장품」「skin」처럼 피부·화장품 맥락 낱말이 있는가. */
  hasBeautyContext: boolean;
  hasIngredient: boolean;
  hasType: boolean;
  intents: Set<Intent>;
}

function buildDictionary(
  lang: "ko" | "en",
  vocabulary: CatalogVocabulary
): Map<string, Token> {
  const dict = new Map<string, Token>();
  const allowedTypes =
    vocabulary.types.length > 0 ? vocabulary.types : TYPE_CONCEPTS;
  const add = (form: string, token: Token) => {
    const key = compactKeyword(form);
    if (key.length >= 2 && !dict.has(key)) {
      dict.set(key, { ...token, form });
    }
  };
  for (const c of vocabulary.ingredients) {
    for (const f of formsOf(c, lang)) {
      add(f, { concept: c, form: f });
    }
  }
  for (const c of allowedTypes) {
    for (const f of formsOf(c, lang)) {
      add(f, { concept: c, form: f });
    }
  }
  for (const c of CONCERN_CONCEPTS) {
    for (const f of formsOf(c, lang)) {
      add(f, { concept: c, form: f });
    }
  }
  const modifiers = lang === "ko" ? KO_MODIFIERS : EN_MODIFIERS;
  for (const [form, intent] of Object.entries(modifiers)) {
    add(form, { intent, form });
  }
  return dict;
}

/** 사전 낱말로 끝까지 쪼갠다(낱말 수 최소). 쪼갤 수 없으면 null. */
function segment(compact: string, dict: Map<string, Token>): Token[] | null {
  const n = compact.length;
  const best: Array<{ cost: number; prev: number; token: Token | null }> =
    Array.from({ length: n + 1 }, () => ({
      cost: Number.POSITIVE_INFINITY,
      prev: -1,
      token: null,
    }));
  best[0] = { cost: 0, prev: -1, token: null };
  for (let i = 1; i <= n; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const from = best[j];
      if (!from || from.cost === Number.POSITIVE_INFINITY) {
        continue;
      }
      const token = dict.get(compact.slice(j, i));
      const target = best[i];
      if (token && target && from.cost + 1 < target.cost) {
        best[i] = { cost: from.cost + 1, prev: j, token };
      }
    }
  }
  if (!best[n] || best[n].cost === Number.POSITIVE_INFINITY) {
    return null;
  }
  const tokens: Token[] = [];
  let i = n;
  while (i > 0) {
    const step = best[i];
    if (!step?.token) {
      return null;
    }
    tokens.unshift(step.token);
    i = step.prev;
  }
  return tokens;
}

function analyze(tokens: Token[]): KeywordAnalysis {
  const intents = new Set<Intent>();
  let concern: Concept | null = null;
  let concernForm: string | null = null;
  const ingredients: Token[] = [];
  const types: Token[] = [];
  let hasBeautyContext = false;
  for (const t of tokens) {
    if (t.intent) {
      intents.add(t.intent);
      hasBeautyContext ||= BEAUTY_CONTEXT.has(compactKeyword(t.form));
    } else if (t.concept?.kind === "concern") {
      if (!concern) {
        concern = t.concept;
        concernForm = t.form;
      }
    } else if (t.concept) {
      // 같은 개념이 두 번(「egf ampoule serum」의 ampoule·serum)이면 앞의 것만.
      const bucket = t.concept.kind === "ingredient" ? ingredients : types;
      if (!bucket.some((b) => b.concept === t.concept)) {
        bucket.push(t);
      }
    }
  }
  // 어순 정규화: 성분 → 제형(「serum stem cell」 = 「stem cell serum」).
  return {
    concern,
    concernForm,
    hasBeautyContext,
    coreForms: [...ingredients, ...types],
    hasIngredient: ingredients.length > 0,
    hasType: types.length > 0,
    intents,
  };
}

function topicOf(a: KeywordAnalysis): DemandTopic {
  if (a.concern) {
    return "피부고민";
  }
  if (a.intents.has("use")) {
    return "사용법";
  }
  if (a.intents.has("price")) {
    return "가격·가성비";
  }
  if (a.intents.has("eff")) {
    return "효능·성분";
  }
  return "제품 추천";
}

function displayForm(token: Token): string {
  if (token.concept?.id.startsWith("acr:")) {
    return token.concept.id.slice(4);
  }
  if (token.concept?.id === "vitaminc") {
    return HANGUL_RE.test(token.form) ? "비타민C" : "vitamin C";
  }
  return token.form;
}

// ── 문장 틀 ─────────────────────────────────────────────────────────
export type QuestionStyle = "casual" | "polite";

/**
 * 지식iN 질문 제목(실제 사람이 쓴 말)의 끝맺음으로 말투를 정한다.
 * 존댓말(…요/…까요/…나요)이 반말보다 많으면 polite. 제목이 없으면 casual(AI 대화체).
 * 제목 원문은 저장하지 않는다(네이버 약관) — 여기서는 끝맺음 개수만 센다.
 */
export function styleFromAnchors(
  titles: readonly string[] | null | undefined
): QuestionStyle {
  let polite = 0;
  let casual = 0;
  for (const title of titles ?? []) {
    if (POLITE_END_RE.test(title)) {
      polite += 1;
    } else if (CASUAL_END_RE.test(title)) {
      casual += 1;
    }
  }
  return polite > casual ? "polite" : "casual";
}

// 「{고민}에 좋은 …」이 자연스럽게 읽히는 표현(「수분에 좋은」 → 「수분 보충에 좋은」).
const KO_CONCERN_PHRASE: Record<string, string> = {
  주름: "주름 관리",
  기미: "기미 관리",
  잡티: "잡티 관리",
  모공: "모공 관리",
  여드름: "여드름 피부",
  트러블: "트러블 피부",
  탄력: "탄력 관리",
  수분: "수분 보충",
  진정: "피부 진정",
  홍조: "홍조 피부",
  흉터: "흉터 관리",
  피부결: "피부결 관리",
  노화: "노화 관리",
  다크서클: "다크서클 관리",
  지성: "지성 피부",
};

function koQuestion(
  topic: DemandTopic,
  core: string,
  coreHasType: boolean,
  coreHasIngredient: boolean,
  concern: string | null,
  style: QuestionStyle
): string {
  const item = coreHasType ? core : `${core} 화장품`;
  const polite = style === "polite";
  switch (topic) {
    case "피부고민":
      if (!polite) {
        return `${concern}에 좋은 ${item} 추천해줘`;
      }
      // 성분이 있는 핵심어는 지식iN 말투 그대로(「PDRN 앰플 주름 관리에 괜찮을까요?」),
      //   제형만이면 「주름 관리에 좋은 앰플 있을까요?」.
      return coreHasIngredient
        ? `${core} ${concern}에 괜찮을까요?`
        : `${concern}에 좋은 ${item} 있을까요?`;
    case "사용법":
      return polite
        ? `${core} 어떻게 바르는 게 좋은가요?`
        : `${core} 바르는 순서랑 사용법 알려줘`;
    case "가격·가성비":
      return polite
        ? `가성비 좋은 ${item} 있을까요?`
        : `가성비 좋은 ${item} 추천해줘`;
    case "효능·성분":
      return polite ? `${core} 효과 정말 있나요?` : `${core} 효과 진짜 있어?`;
    default:
      return polite ? `${item} 추천해 주세요` : `${item} 추천해줘`;
  }
}

function enQuestion(
  topic: DemandTopic,
  core: string,
  coreHasType: boolean,
  concern: string | null
): string {
  const item = coreHasType ? core : `${core} skincare product`;
  switch (topic) {
    case "피부고민":
      return `What's the best ${item} for ${concern}?`;
    case "사용법":
      return `How should I use ${core} in my skincare routine?`;
    case "가격·가성비":
      return `What's a good affordable ${item}?`;
    case "효능·성분":
      return `Does ${core} actually work for skin?`;
    default:
      return `What's the best ${item}?`;
  }
}

interface Candidate {
  analysis: KeywordAnalysis;
  core: string;
  coreKey: string;
  keyword: DemandKeyword;
  topic: DemandTopic;
}

export interface GenerateDemandQuestionsInput {
  /** 브랜드 자신의 모든 표기(한/영·별칭·사이트명). 포함된 키워드는 버린다. */
  brandNames: readonly string[];
  keywords: Partial<Record<DemandMarket, readonly DemandKeyword[] | null>>;
  maxPerMarket?: number;
  minPerMarket?: number;
  minVolume?: number;
  /** 등록 경쟁사 등 알려진 다른 브랜드 이름 — 포함된 키워드는 버린다(사전 거름에 더한 안전장치). */
  otherBrandNames?: readonly string[];
  products: ReadonlyArray<{ name: string }>;
  /** 시장별 지식iN 질문 제목(말투 기준). 저장하지 않는다. */
  styleAnchors?: Partial<Record<DemandMarket, readonly string[] | null>>;
}

const MARKET_LANG: Record<DemandMarket, "ko" | "en"> = { KR: "ko", US: "en" };

function concernPhrase(
  market: DemandMarket,
  form: string | null
): string | null {
  if (form === null) {
    return null;
  }
  return market === "KR" ? (KO_CONCERN_PHRASE[form] ?? form) : form;
}

function questionFor(
  market: DemandMarket,
  topic: DemandTopic,
  candidate: Candidate,
  style: QuestionStyle
): string {
  const concernToken = concernPhrase(market, candidate.analysis.concernForm);
  return market === "KR"
    ? koQuestion(
        topic,
        candidate.core,
        candidate.analysis.hasType,
        candidate.analysis.hasIngredient,
        concernToken,
        style
      )
    : enQuestion(
        topic,
        candidate.core,
        candidate.analysis.hasType,
        concernToken
      );
}

type Excluded = DemandQuestionSet["excluded"][DemandMarket];

/**
 * 질문 씨앗이 될 수 있는 키워드인가.
 *   · 핵심어 없음(「추천」「korean skincare」) → 아님
 *   · 제형 단독(「세럼」「앰플」) → 의도·고민 낱말이 붙어야(「앰플추천」「주름앰플」) 씀
 *   · 제형 없는 성분 키워드(「stem cell」「줄기세포가격」「펩타이드효능」) → 시술·의료·영양제
 *     검색이 섞인다(미국 「stem cell」 월 60,500 실측). 「화장품」「skin」 같은 맥락 낱말이나
 *     피부고민이 붙어야 씀
 */
function isQuestionSeed(a: KeywordAnalysis): boolean {
  const intentful =
    [...a.intents].some((i) => i !== "neutral") || a.concern !== null;
  const skincareContext = a.hasType || a.hasBeautyContext || a.concern !== null;
  return (
    a.coreForms.length > 0 && skincareContext && (a.hasIngredient || intentful)
  );
}

const byVolume = (a: Candidate, b: Candidate) =>
  b.keyword.volume - a.keyword.volume ||
  a.keyword.keyword.localeCompare(b.keyword.keyword);

interface MarketContext {
  brandKeys: string[];
  dict: Map<string, Token>;
  minVolume: number;
  otherKeys: string[];
}

/** 키워드 한 줄 → 후보 또는 제외 사유. */
function classifyKeyword(
  keyword: DemandKeyword,
  ctx: MarketContext
): Candidate | keyof Excluded | "brandExact" | null {
  const compact = compactKeyword(keyword.keyword);
  if (!compact) {
    return null;
  }
  if (ctx.brandKeys.some((b) => compact.includes(b))) {
    // 참고값은 브랜드 이름 **단독** 검색만(「franz ferdinand」 같은 동명 검색은 제외).
    return ctx.brandKeys.includes(compact) ? "brandExact" : "brand";
  }
  if (ctx.otherKeys.some((o) => compact.includes(o))) {
    return "otherBrand";
  }
  if (keyword.lowVolume || keyword.volume < ctx.minVolume) {
    return "lowVolume";
  }
  const tokens = segment(compact, ctx.dict);
  const analysis = tokens ? analyze(tokens) : null;
  if (!(analysis && isQuestionSeed(analysis))) {
    return "unmatched";
  }
  return {
    analysis,
    core: analysis.coreForms.map(displayForm).join(" "),
    coreKey: analysis.coreForms.map((t) => t.concept?.id ?? t.form).join("+"),
    keyword,
    topic: topicOf(analysis),
  };
}

function collectCandidates(
  keywords: readonly DemandKeyword[],
  ctx: MarketContext
): {
  brandVolume: DemandKeyword | null;
  excluded: Excluded;
  ranked: Candidate[];
} {
  const excluded: Excluded = {
    brand: 0,
    lowVolume: 0,
    otherBrand: 0,
    unmatched: 0,
  };
  let brandVolume: DemandKeyword | null = null;
  const byKey = new Map<string, Candidate>();
  for (const keyword of keywords) {
    const result = classifyKeyword(keyword, ctx);
    if (result === null) {
      continue;
    }
    if (result === "brandExact") {
      excluded.brand += 1;
      if (!brandVolume || keyword.volume > brandVolume.volume) {
        brandVolume = keyword;
      }
      continue;
    }
    if (typeof result === "string") {
      excluded[result] += 1;
      continue;
    }
    const key = `${result.topic}|${result.coreKey}|${result.analysis.concern?.id ?? ""}`;
    const existing = byKey.get(key);
    if (!existing || byVolume(result, existing) < 0) {
      byKey.set(key, result);
    }
  }
  return { brandVolume, excluded, ranked: [...byKey.values()].sort(byVolume) };
}

/** 1차: 주제마다 검색량 1위 하나씩(주제 다양성) → 2차: 남은 자리를 검색량 순으로(주제당 상한). */
function pickCandidates(ranked: Candidate[], maxPer: number): Candidate[] {
  const picked: Candidate[] = [];
  for (const topic of DEMAND_TOPICS) {
    const best = ranked.find((c) => c.topic === topic);
    if (best) {
      picked.push(best);
    }
  }
  picked.sort(byVolume);
  for (const c of ranked) {
    if (picked.length >= maxPer) {
      break;
    }
    const sameTopic = picked.filter((p) => p.topic === c.topic).length;
    if (!picked.includes(c) && sameTopic < MAX_PER_TOPIC) {
      picked.push(c);
    }
  }
  return picked.slice(0, maxPer);
}

/**
 * 3차(부족할 때만): 검색량 높은 「성분+제형」 핵심어를 빠진 주제로 넓힌다(expanded).
 * 이 단계에 오면 ranked 전부가 이미 뽑혔다(maxPer ≥ minPer).
 */
function expansionCandidates(
  ranked: Candidate[],
  picked: Candidate[]
): Array<{ candidate: Candidate; topic: DemandTopic }> {
  const anchors = ranked.filter(
    (c) => c.analysis.hasIngredient && c.analysis.hasType && !c.analysis.concern
  );
  const topConcern = ranked.find((c) => c.analysis.concern)?.analysis;
  const covered = new Set(picked.map((c) => `${c.topic}|${c.coreKey}`));
  const out: Array<{ candidate: Candidate; topic: DemandTopic }> = [];
  for (const anchor of anchors) {
    for (const topic of DEMAND_TOPICS) {
      const key = `${topic}|${anchor.coreKey}`;
      if (covered.has(key) || (topic === "피부고민" && !topConcern)) {
        continue;
      }
      covered.add(key);
      const candidate =
        topic === "피부고민" && topConcern
          ? {
              ...anchor,
              analysis: {
                ...anchor.analysis,
                concern: topConcern.concern,
                concernForm: topConcern.concernForm,
              },
            }
          : anchor;
      out.push({ candidate, topic });
    }
  }
  return out;
}

function generateForMarket(
  market: DemandMarket,
  input: GenerateDemandQuestionsInput,
  vocabulary: CatalogVocabulary
): {
  brandVolume: DemandKeyword | null;
  excluded: Excluded;
  questions: DemandQuestion[];
} {
  const lang = MARKET_LANG[market];
  const maxPer = Math.min(
    ABSOLUTE_MAX_PER_MARKET,
    Math.max(1, input.maxPerMarket ?? DEFAULT_MAX_PER_MARKET)
  );
  const minPer = Math.min(maxPer, input.minPerMarket ?? DEFAULT_MIN_PER_MARKET);
  const ctx: MarketContext = {
    brandKeys: input.brandNames
      .map(compactKeyword)
      .filter((k) => k.length >= 2),
    otherKeys: (input.otherBrandNames ?? [])
      .map(compactKeyword)
      .filter((k) => k.length >= 2),
    dict: buildDictionary(lang, vocabulary),
    minVolume: input.minVolume ?? DEFAULT_MIN_VOLUME,
  };
  const style = styleFromAnchors(input.styleAnchors?.[market]);
  const { brandVolume, excluded, ranked } = collectCandidates(
    input.keywords[market] ?? [],
    ctx
  );
  const picked = pickCandidates(ranked, maxPer);

  const questions: DemandQuestion[] = [];
  const seenText = new Set<string>();
  const add = (c: Candidate, topic: DemandTopic, expanded: boolean) => {
    const text = questionFor(market, topic, c, style);
    if (seenText.has(text)) {
      return;
    }
    seenText.add(text);
    questions.push({
      text,
      lang,
      market,
      topic,
      keyword: c.keyword.keyword,
      volume: c.keyword.volume,
      source: c.keyword.source,
      expanded,
    });
  };
  for (const c of picked) {
    add(c, c.topic, false);
  }
  if (questions.length < minPer) {
    for (const { candidate, topic } of expansionCandidates(ranked, picked)) {
      if (questions.length >= minPer) {
        break;
      }
      add(candidate, topic, true);
    }
  }
  return { brandVolume, excluded, questions: questions.slice(0, maxPer) };
}

/**
 * 공식몰 제품명 + 실측 검색량 → 시장별 이름 없는 구매 질문(검색량 순, 주제 다양성 보장).
 * 같은 입력이면 같은 출력(시각·난수 없음).
 */
export function generateDemandQuestions(
  input: GenerateDemandQuestionsInput
): DemandQuestionSet {
  const vocabulary = catalogVocabulary(input.products, input.brandNames);
  const set: DemandQuestionSet = {
    version: 1,
    questions: { KR: [], US: [] },
    excluded: {
      KR: { brand: 0, lowVolume: 0, otherBrand: 0, unmatched: 0 },
      US: { brand: 0, lowVolume: 0, otherBrand: 0, unmatched: 0 },
    },
    brandVolume: {},
  };
  if (vocabulary.ingredients.length === 0 && vocabulary.types.length === 0) {
    return set;
  }
  for (const market of ["KR", "US"] as const) {
    if (!input.keywords[market]) {
      continue;
    }
    const out = generateForMarket(market, input, vocabulary);
    set.questions[market] = out.questions;
    set.excluded[market] = out.excluded;
    set.brandVolume[market] = out.brandVolume;
  }
  return set;
}

/** 측정 언어에 맞는 시장. 실제 고객 시장(marketScope)과 측정 언어의 교집합. */
export function demandMarketsFor(
  language: "ko" | "en" | "both",
  scope: "korea" | "global" | "both"
): DemandMarket[] {
  const markets: DemandMarket[] = [];
  if (language !== "en" && scope !== "global") {
    markets.push("KR");
  }
  if (language !== "ko" && scope !== "korea") {
    markets.push("US");
  }
  return markets;
}

/**
 * 러너의 이름 없는 질문 자리(상한 `limit`)에 넣을 질문 — 시장별 검색량 1위부터 번갈아.
 * 회차마다 같은 질문을 고른다(시계열 비교 가능). 전체 목록은 결과에 따로 저장한다.
 */
export function selectDemandRunQuestions(
  set: DemandQuestionSet,
  markets: readonly DemandMarket[],
  limit: number
): DemandQuestion[] {
  const queues = markets.map((m) => [...set.questions[m]]);
  const out: DemandQuestion[] = [];
  while (out.length < limit && queues.some((q) => q.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next && out.length < limit) {
        out.push(next);
      }
    }
  }
  return out;
}

/** 운영 플래그 — 기본 꺼짐. 관제탑이 켜기 전까지 러너 동작은 그대로다. */
export function isDemandPromptsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.MEASUREMENT_DEMAND_PROMPTS === "true";
}
