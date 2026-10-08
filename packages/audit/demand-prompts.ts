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
//   2. 관련성은 **이 브랜드의 상품 이름**에서 뽑은 낱말로 판정한다(`keyword-relevance.ts`).
//      🔴 2026-10-07 대표 결정: K-뷰티 성분·제형 사전 의존을 없앴다 — 화장품이 아니어도 같은 규칙이다.
//   3. 브랜드 자신·다른 브랜드 이름이 들어간 키워드는 버린다(「프란츠」「메디큐브PDRN」).
//
// 표기: 주제(topic) 이름은 리포트가 한국어라 시장과 무관하게 한국어다.

import {
  type BrandProfile,
  buildBrandProfile,
  discoverEnglishHeads,
  profileSeedKeywords,
  profileTermsFor,
} from "./brand-profile";
import {
  classifyKeywordRelevance,
  compactTerm,
  type ProfileTerms,
  type RelevantKeyword,
  relevanceContext,
} from "./keyword-relevance";

export type DemandMarket = "KR" | "US";
/**
 * 「피부고민」은 v1(사전 시절) 저장분 호환용으로 남긴다. 새 질문의 용도·고민은 「고민·용도」다.
 */
export type DemandTopic =
  | "제품 추천"
  | "효능·성분"
  | "가격·가성비"
  | "고민·용도"
  | "피부고민"
  | "사용법";
export const DEMAND_TOPICS: readonly DemandTopic[] = [
  "제품 추천",
  "효능·성분",
  "가격·가성비",
  "고민·용도",
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

const POLITE_END_RE = /(요|까요|나요|세요|니다|ㅠ+|ㅜ+)\s*[?？!.]*$/;
const CASUAL_END_RE = /(줘|해|야|냐|나|까|지)\s*[?？!.]*$/;

const DEFAULT_MAX_PER_MARKET = 8;
const DEFAULT_MIN_PER_MARKET = 6;
const ABSOLUTE_MAX_PER_MARKET = 12;
const DEFAULT_MIN_VOLUME = 30;
/** 한 주제가 질문 자리를 독차지하지 않게(검색량이 한 주제에 몰려도 다른 주제를 남긴다). */
const MAX_PER_TOPIC = 3;

export function compactKeyword(value: string): string {
  return compactTerm(value);
}

// ── 제품명 → 이 브랜드의 프로필 낱말 ────────────────────────────────
/** 상품 이름에서 뽑은 head(「앰플」)·modifier(「PDRN」) — 사전이 아니다. */
export type CatalogVocabulary = ProfileTerms & { profile: BrandProfile };

export function catalogVocabulary(
  products: ReadonlyArray<{ name: string }>,
  brandNames: readonly string[]
): CatalogVocabulary {
  const profile = buildBrandProfile({
    catalog: products.map((p) => ({ name: p.name })),
    siteOfferings: [],
    siteTextTerms: [],
  });
  return { ...profileTermsFor(profile, "ko", brandNames), profile };
}

/** 검색량 조회 씨앗 — 국내(한국어, 공백 없음)·미국(영문 낱말). 브랜드 이름 1개를 참고값으로 덧붙인다. */
export function demandSeedKeywords(
  vocabulary: CatalogVocabulary,
  brandNames: { en?: string | null; ko?: string | null }
): Record<DemandMarket, string[]> {
  return profileSeedKeywords(vocabulary.profile, {
    ko: brandNames.ko ?? "",
    en: brandNames.en ?? null,
  });
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

function topicOf(rel: RelevantKeyword): DemandTopic {
  if (rel.purpose) {
    return "고민·용도";
  }
  if (rel.intents.includes("use")) {
    return "사용법";
  }
  if (rel.intents.includes("price")) {
    return "가격·가성비";
  }
  if (rel.intents.includes("eff")) {
    return "효능·성분";
  }
  return "제품 추천";
}

function koQuestion(
  topic: DemandTopic,
  core: string,
  purpose: string | null,
  style: QuestionStyle
): string {
  const polite = style === "polite";
  switch (topic) {
    case "고민·용도":
    case "피부고민":
      return polite
        ? `${purpose}에 좋은 ${core} 있을까요?`
        : `${purpose}에 좋은 ${core} 추천해줘`;
    case "사용법":
      return polite
        ? `${core} 어떻게 쓰는 게 좋은가요?`
        : `${core} 사용법이랑 순서 알려줘`;
    case "가격·가성비":
      return polite
        ? `가성비 좋은 ${core} 있을까요?`
        : `가성비 좋은 ${core} 추천해줘`;
    case "효능·성분":
      return polite ? `${core} 효과 정말 있나요?` : `${core} 효과 진짜 있어?`;
    default:
      return polite ? `${core} 추천해 주세요` : `${core} 추천해줘`;
  }
}

function enQuestion(
  topic: DemandTopic,
  core: string,
  purpose: string | null
): string {
  switch (topic) {
    case "고민·용도":
    case "피부고민":
      return `What's the best ${core} for ${purpose}?`;
    case "사용법":
      return `How should I use ${core}?`;
    case "가격·가성비":
      return `What's a good affordable ${core}?`;
    case "효능·성분":
      return `Does ${core} actually work?`;
    default:
      return `What's the best ${core}?`;
  }
}

interface Candidate {
  keyword: DemandKeyword;
  rel: RelevantKeyword;
  topic: DemandTopic;
}

export interface GenerateDemandQuestionsInput {
  /** 브랜드 자신의 모든 표기(한/영·별칭·사이트명). 포함된 키워드는 버린다. */
  brandNames: readonly string[];
  keywords: Partial<Record<DemandMarket, readonly DemandKeyword[] | null>>;
  maxPerMarket?: number;
  minPerMarket?: number;
  minVolume?: number;
  /** 등록 경쟁사 등 알려진 다른 브랜드 이름 — 포함된 키워드는 버린다. */
  otherBrandNames?: readonly string[];
  products: ReadonlyArray<{ name: string }>;
  /** 시장별 지식iN 질문 제목(말투 기준). 저장하지 않는다. */
  styleAnchors?: Partial<Record<DemandMarket, readonly string[] | null>>;
}

const MARKET_LANG: Record<DemandMarket, "ko" | "en"> = { KR: "ko", US: "en" };

type Excluded = DemandQuestionSet["excluded"][DemandMarket];

const byRank = (a: Candidate, b: Candidate) =>
  a.rel.tier - b.rel.tier ||
  b.keyword.volume - a.keyword.volume ||
  a.keyword.keyword.localeCompare(b.keyword.keyword);

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exclusion reasons map 1:1 to the stored counters.
function collectCandidates(
  keywords: readonly DemandKeyword[],
  ctx: ReturnType<typeof relevanceContext>,
  minVolume: number
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
    const rel = classifyKeywordRelevance(keyword.keyword, ctx);
    if (!rel.ok) {
      if (rel.reason === "brandExact") {
        // 참고값은 브랜드 이름 **단독** 검색만(「franz ferdinand」 같은 동명 검색은 제외).
        excluded.brand += 1;
        if (!brandVolume || keyword.volume > brandVolume.volume) {
          brandVolume = keyword;
        }
      } else if (rel.reason === "brand") {
        excluded.brand += 1;
      } else if (rel.reason === "otherBrand") {
        excluded.otherBrand += 1;
      } else {
        excluded.unmatched += 1;
      }
      continue;
    }
    if (keyword.lowVolume || keyword.volume < minVolume) {
      excluded.lowVolume += 1;
      continue;
    }
    const topic = topicOf(rel);
    const key = `${topic}|${rel.coreKey}|${rel.purpose ?? ""}`;
    const candidate = { keyword, rel, topic };
    const existing = byKey.get(key);
    if (!existing || byRank(candidate, existing) < 0) {
      byKey.set(key, candidate);
    }
  }
  return { brandVolume, excluded, ranked: [...byKey.values()].sort(byRank) };
}

/** 1차: 주제마다 1위 하나씩(주제 다양성) → 2차: 남은 자리를 순위대로(주제당 상한). */
function pickCandidates(ranked: Candidate[], maxPer: number): Candidate[] {
  const picked: Candidate[] = [];
  for (const topic of DEMAND_TOPICS) {
    const best = ranked.find((c) => c.topic === topic);
    if (best) {
      picked.push(best);
    }
  }
  picked.sort(byRank);
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

const EXPANSION_TOPICS: readonly DemandTopic[] = [
  "제품 추천",
  "효능·성분",
  "가격·가성비",
  "사용법",
];

/**
 * 3차(부족할 때만): 프로필 낱말과 정확히 맞는 핵심어(「PDRN 앰플」)를 빠진 주제로 넓힌다(expanded).
 */
function expansionCandidates(
  ranked: Candidate[],
  picked: Candidate[]
): Array<{ candidate: Candidate; topic: DemandTopic }> {
  const anchors = ranked.filter((c) => c.rel.hasModifier && !c.rel.purpose);
  const covered = new Set(picked.map((c) => `${c.topic}|${c.rel.coreKey}`));
  const out: Array<{ candidate: Candidate; topic: DemandTopic }> = [];
  for (const anchor of anchors) {
    for (const topic of EXPANSION_TOPICS) {
      const key = `${topic}|${anchor.rel.coreKey}`;
      if (!covered.has(key)) {
        covered.add(key);
        out.push({ candidate: anchor, topic });
      }
    }
  }
  return out;
}

function generateForMarket(
  market: DemandMarket,
  input: GenerateDemandQuestionsInput,
  profile: BrandProfile
): {
  brandVolume: DemandKeyword | null;
  excluded: Excluded;
  questions: DemandQuestion[];
} {
  const lang = MARKET_LANG[market];
  const rows = input.keywords[market] ?? [];
  const maxPer = Math.min(
    ABSOLUTE_MAX_PER_MARKET,
    Math.max(1, input.maxPerMarket ?? DEFAULT_MAX_PER_MARKET)
  );
  const minPer = Math.min(maxPer, input.minPerMarket ?? DEFAULT_MIN_PER_MARKET);
  let terms = profileTermsFor(profile, lang, input.brandNames);
  if (lang === "en") {
    terms = discoverEnglishHeads(
      terms,
      rows.map((r) => r.keyword)
    );
  }
  const ctx = relevanceContext(
    terms,
    input.brandNames,
    input.otherBrandNames ?? [],
    { allowHeadOnly: true }
  );
  const style = styleFromAnchors(input.styleAnchors?.[market]);
  const { brandVolume, excluded, ranked } = collectCandidates(
    rows,
    ctx,
    input.minVolume ?? DEFAULT_MIN_VOLUME
  );
  const picked = pickCandidates(ranked, maxPer);

  const questions: DemandQuestion[] = [];
  const seenText = new Set<string>();
  const add = (c: Candidate, topic: DemandTopic, expanded: boolean) => {
    const text =
      market === "KR"
        ? koQuestion(topic, c.rel.core, c.rel.purpose, style)
        : enQuestion(topic, c.rel.core, c.rel.purpose);
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
 * 공식몰 제품명 + 실측 검색량 → 시장별 이름 없는 구매 질문(순위 순, 주제 다양성 보장).
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
  if (vocabulary.heads.size === 0) {
    return set;
  }
  for (const market of ["KR", "US"] as const) {
    if (!input.keywords[market]) {
      continue;
    }
    const out = generateForMarket(market, input, vocabulary.profile);
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
 * 러너의 이름 없는 질문 자리(상한 `limit`)에 넣을 질문 — 시장별 순위 1위부터 번갈아.
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
