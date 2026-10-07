// 질문 계획 v2 — 브랜드 1개당 하루 20문항 (2026-10-07 대표 결정 · A1 그림자 단계)
//
//   A 카테고리 구매 8 · B 고민·사용법 4 · C 대표 상품(이름 없이 특징으로) 3 · D 비교·대안 2 ·
//   E 브랜드 이해 3(이름 넣음). 시장 비율 기본 국내 7 : 해외 3. 말투는 AI 에 실제로 묻는 반말
//   대화체(「PDRN 앰플 추천해줘」) / 미국은 캐주얼 영어.
//
// 재료 = 브랜드 프로필(brand-profile.ts) + 실측 검색량(네이버·구글). 질문마다 출처 키워드·월 검색량을
//   남긴다. 결정적이다(같은 입력 → 같은 질문). 화장품 사전 없음 — 관련성은 keyword-relevance.ts.
//
// ⚠️ 이 계획은 지금 **그림자**로만 돈다(점수·추세·Tracking 미사용 — shadow-plan-v2.ts).

import { topicParticle } from "./actions";
import {
  type BrandProfile,
  discoverEnglishHeads,
  profileTermsFor,
} from "./brand-profile";
import type { DemandKeyword, DemandMarket } from "./demand-prompts";
import {
  classifyKeywordRelevance,
  compactTerm,
  keywordUniverseHas,
  offeringTokens,
  type RelevanceReason,
  type RelevantKeyword,
  relevanceContext,
} from "./keyword-relevance";

import {
  type PlanV2Provenance,
  type PlanV2Type,
  QUESTION_PLAN_V2,
} from "./plan-v2-contract";

export const PLAN_V2_TYPES: readonly PlanV2Type[] = ["A", "B", "C", "D", "E"];
/** 유형별 문항 수(합계 20). */
export const PLAN_V2_COMPOSITION: Readonly<Record<PlanV2Type, number>> = {
  A: 8,
  B: 4,
  C: 3,
  D: 2,
  E: 3,
};
export const PLAN_V2_TOTAL = 20;
/** 두 시장을 함께 잴 때 국내 비율(대표 결정 7 : 3). */
export const PLAN_V2_KR_SHARE = 0.7;
const DEFAULT_MIN_VOLUME = 30;
/** A 1차 선발에서 같은 head(「교육」「앰플」)로 끝나는 키워드 상한. */
const MAX_A_PER_HEAD = 3;
const BRACKETS_RE = /\([^)]*\)|\[[^\]]*\]/g;
const SPACES_RE = /\s+/g;
const HANGUL_TEXT_RE = /[가-힣]/;
const SHORT_LATIN_RE = /^[a-z0-9]{2,6}$/;
const MARKET_ORDER: readonly DemandMarket[] = ["KR", "US"];

export interface PlanV2Question {
  /** E 만 brand(이름 넣음). A~D 는 discovery(이름 없음). */
  kind: "brand" | "discovery";
  lang: "ko" | "en";
  market: DemandMarket;
  provenance: PlanV2Provenance;
  text: string;
  type: PlanV2Type;
}

type ExcludedCounts = Record<RelevanceReason | "lowVolume", number>;

export interface QuestionPlanV2 {
  counts: Record<PlanV2Type, number>;
  excluded: Partial<Record<DemandMarket, ExcludedCounts>>;
  markets: Record<DemandMarket, number>;
  /** 이름 없는 질문(A~D) 수. 0 이면 note 가 사유를 말한다. */
  nameLessCount: number;
  note: "no_profile" | "no_keyword_data" | null;
  questionPlanVersion: typeof QUESTION_PLAN_V2;
  questions: PlanV2Question[];
}

export interface BuildPlanV2Input {
  /** 브랜드 자신의 모든 표기(한/영·별칭·사이트명). A~D 문장에 들어가면 안 된다. */
  brandNames: readonly string[];
  /** 등록 경쟁사(D 재료). */
  competitors?: readonly string[];
  /** 질문에 넣는 표기 — 한국어 질문은 ko, 영어 질문은 en. */
  displayNames: { en: string; ko: string };
  keywords: Partial<Record<DemandMarket, readonly DemandKeyword[] | null>>;
  markets: readonly DemandMarket[];
  minVolume?: number;
  /** 등록 경쟁사 + 지난 회차 AI 답변에서 나온 다른 브랜드 이름(키워드 제외용). */
  otherBrandNames?: readonly string[];
  profile: BrandProfile;
}

interface Candidate {
  bucket: "A" | "B" | "D";
  keyword: DemandKeyword;
  rel: RelevantKeyword;
}

const LANG: Record<DemandMarket, "ko" | "en"> = { KR: "ko", US: "en" };

/** 유형별 시장 배분 — 두 시장이면 국내 70%(반올림), 한 시장이면 전부. */
export function splitByMarket(
  count: number,
  markets: readonly DemandMarket[],
  krShare = PLAN_V2_KR_SHARE
): Record<DemandMarket, number> {
  const hasKr = markets.includes("KR");
  const hasUs = markets.includes("US");
  if (hasKr && hasUs) {
    const kr = Math.round(count * krShare);
    return { KR: kr, US: count - kr };
  }
  return { KR: hasKr ? count : 0, US: hasUs ? count : 0 };
}

function bucketOf(
  rel: RelevantKeyword,
  commerce: boolean
): Candidate["bucket"] {
  if (rel.intents.includes("compare")) {
    return "D";
  }
  if (
    rel.purpose ||
    rel.intents.includes("use") ||
    rel.intents.includes("eff") ||
    (!commerce && rel.intents.includes("price"))
  ) {
    return "B";
  }
  return "A";
}

function collectCandidates(
  market: DemandMarket,
  input: BuildPlanV2Input
): { candidates: Candidate[]; excluded: ExcludedCounts } {
  const lang = LANG[market];
  const rows = input.keywords[market] ?? [];
  let terms = profileTermsFor(input.profile, lang, input.brandNames);
  if (lang === "en") {
    terms = discoverEnglishHeads(
      terms,
      rows.map((r) => r.keyword)
    );
  }
  // AI 답변에서 뽑은 「다른 브랜드」 목록에는 「PDRN 앰플」 같은 일반 명사가 섞일 수 있다 —
  //   이 브랜드의 상품 낱말이 들어간 이름은 브랜드로 보지 않는다(카테고리 키워드를 통째로 잃지 않게).
  const profileKeys = [...terms.heads.keys(), ...terms.modifiers.keys()].filter(
    (k) => k.length >= 2
  );
  const otherBrandNames = (input.otherBrandNames ?? []).filter((name) => {
    const key = compactTerm(name);
    return !profileKeys.some((k) => key.includes(k));
  });
  const ctx = relevanceContext(terms, input.brandNames, otherBrandNames, {
    allowHeadOnly: input.profile.businessType === "commerce",
  });
  const excluded: ExcludedCounts = {
    brand: 0,
    brandExact: 0,
    otherBrand: 0,
    unrelated: 0,
    unmatched: 0,
    lowVolume: 0,
  };
  const commerce = input.profile.businessType === "commerce";
  const minVolume = input.minVolume ?? DEFAULT_MIN_VOLUME;
  const byKey = new Map<string, Candidate>();
  for (const keyword of rows) {
    const rel = classifyKeywordRelevance(keyword.keyword, ctx);
    if (!rel.ok) {
      excluded[rel.reason] += 1;
      continue;
    }
    if (keyword.lowVolume || keyword.volume < minVolume) {
      excluded.lowVolume += 1;
      continue;
    }
    const bucket = bucketOf(rel, commerce);
    // A 는 핵심어가 같으면 하나만(「영상제작」「영상제작업체」) — 가격 의도만 따로 둔다.
    const intentKey =
      bucket === "A"
        ? String(rel.intents.includes("price"))
        : rel.intents.join(",");
    const key = `${bucket}|${rel.coreKey}|${rel.purpose ?? ""}|${intentKey}`;
    const existing = byKey.get(key);
    if (!existing || keyword.volume > existing.keyword.volume) {
      byKey.set(key, { bucket, keyword, rel });
    }
  }
  // 프로필 낱말과 정확히 맞는 키워드 먼저(tier), 같은 tier 안에서는 검색량 순.
  const candidates = [...byKey.values()].sort(
    (a, b) =>
      a.rel.tier - b.rel.tier ||
      b.keyword.volume - a.keyword.volume ||
      a.keyword.keyword.localeCompare(b.keyword.keyword)
  );
  return { candidates, excluded };
}

/** LLM 후보 생성에 넘기는 키워드 한 줄(질문 개선 2026-10-07). */
export interface PlanV2KeywordRow {
  keyword: string;
  /** true = 규칙 관련성 판정을 통과(프로필 낱말과 맞음). false = 판정 불가(unmatched) — LLM·심사가 거른다. */
  matched: boolean;
  source: DemandKeyword["source"];
  volume: number;
}

/**
 * 시장별 키워드 재료 — 우리 이름·다른 브랜드·다른 뜻(unrelated)·저검색량은 뺀다.
 * 규칙 판정을 통과한 키워드 먼저, 그다음 판정 불가(unmatched) 키워드를 검색량 순으로(상한 limit).
 */
export function planV2KeywordPool(
  market: DemandMarket,
  input: BuildPlanV2Input,
  limit: number
): PlanV2KeywordRow[] {
  if (input.profile.level === "none") {
    return [];
  }
  const lang = LANG[market];
  const rows = input.keywords[market] ?? [];
  let terms = profileTermsFor(input.profile, lang, input.brandNames);
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
    { allowHeadOnly: input.profile.businessType === "commerce" }
  );
  const minVolume = input.minVolume ?? DEFAULT_MIN_VOLUME;
  const matched: PlanV2KeywordRow[] = [];
  const unmatched: PlanV2KeywordRow[] = [];
  const seen = new Set<string>();
  for (const k of rows) {
    const key = compactTerm(k.keyword);
    if (k.lowVolume || k.volume < minVolume || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const rel = classifyKeywordRelevance(k.keyword, ctx);
    const row = {
      keyword: k.keyword,
      volume: k.volume,
      source: k.source,
      matched: rel.ok,
    };
    if (rel.ok) {
      matched.push(row);
    } else if (rel.reason === "unmatched") {
      unmatched.push(row);
    }
  }
  const byVolume = (a: PlanV2KeywordRow, b: PlanV2KeywordRow) =>
    b.volume - a.volume;
  return [...matched.sort(byVolume), ...unmatched.sort(byVolume)].slice(
    0,
    limit
  );
}

// ── 문장 틀(반말 대화체 / 캐주얼 영어) ────────────────────────────────
function aText(
  market: DemandMarket,
  core: string,
  commerce: boolean,
  price: boolean,
  variant: number
): string {
  if (market === "KR") {
    if (price && commerce) {
      return `가성비 좋은 ${core} 추천해줘`;
    }
    const ko = commerce
      ? [
          `${core} 추천해줘`,
          `${core} 뭐가 좋아?`,
          `요즘 괜찮은 ${core} 추천 좀 해줘`,
        ]
      : [
          `${core} 추천해줘`,
          `${core} 잘하는 곳 어디야?`,
          `괜찮은 ${core} 있으면 알려줘`,
        ];
    return ko[variant % ko.length] as string;
  }
  if (price && commerce) {
    return `What's a good affordable ${core}?`;
  }
  const en = commerce
    ? [
        `What's the best ${core}?`,
        `Can you recommend a good ${core}?`,
        `Which ${core} is actually worth buying?`,
      ]
    : [
        `Who are the best ${core} providers?`,
        `Can you recommend a good ${core} service?`,
        `Which company should I hire for ${core}?`,
      ];
  return en[variant % en.length] as string;
}

type BKind = "purpose" | "use" | "eff" | "cost";

function bText(
  market: DemandMarket,
  kind: BKind,
  core: string,
  commerce: boolean,
  purpose: string | null
): string {
  if (market === "KR") {
    switch (kind) {
      case "purpose":
        return commerce
          ? `${purpose}에 좋은 ${core} 뭐 있어?`
          : `${purpose}에 맞는 ${core} 추천해줘`;
      case "use":
        return commerce
          ? `${core} 어떻게 써? 순서랑 방법 알려줘`
          : `${core} 어떻게 시작하면 돼?`;
      case "cost":
        return `${core} 비용 보통 얼마야?`;
      default:
        return `${core} 효과 진짜 있어?`;
    }
  }
  switch (kind) {
    case "purpose":
      return `What's the best ${core} for ${purpose}?`;
    case "use":
      return commerce
        ? `How do I use ${core} in my routine?`
        : `How do I get started with ${core}?`;
    case "cost":
      return `How much does ${core} usually cost?`;
    default:
      return `Does ${core} actually work?`;
  }
}

function bKindOf(rel: RelevantKeyword): BKind {
  if (rel.purpose) {
    return "purpose";
  }
  if (rel.intents.includes("use")) {
    return "use";
  }
  if (rel.intents.includes("eff")) {
    return "eff";
  }
  return "cost";
}

/**
 * B 확장 순서 — 업종 말투 기본.
 * ⛔ 2026-10-07: 지식iN 질문 유형 개수로 순서를 바꾸던 입력을 지웠다(네이버 Open API 약관 —
 *   AI 입력·검색 표시 외 용도 금지, 법무 검토 대기). brand-profile-live.ts 머리말 참조.
 */
function bExpansionOrder(commerce: boolean): BKind[] {
  return commerce ? ["eff", "use", "cost"] : ["use", "cost", "eff"];
}

const provenanceOf = (c: Candidate, expanded: boolean): PlanV2Provenance => ({
  keyword: c.keyword.keyword,
  volume: c.keyword.volume,
  source: c.keyword.source,
  expanded,
  ...(c.rel.leftover.length > 0 ? { leftover: c.rel.leftover } : {}),
});

interface MarketPools {
  candidates: Candidate[];
  excluded: ExcludedCounts;
}

interface Picker {
  /** slot = 같은 키워드를 같은 틀로 두 번 쓰지 않게 하는 열쇠(B 는 틀 종류를 덧붙인다). */
  add: (q: PlanV2Question, slot?: string) => boolean;
}

function makePicker(
  questions: PlanV2Question[],
  brandKeys: readonly string[]
): Picker {
  const texts = new Set<string>();
  const slots = new Set<string>();
  return {
    add: (q, slot = "") => {
      const key = compactTerm(q.text);
      const slotKey = [
        q.type,
        q.market,
        q.provenance.keyword ?? q.text,
        q.provenance.competitor ?? "",
        q.provenance.offering ?? "",
        slot,
      ].join("|");
      if (texts.has(key) || slots.has(slotKey)) {
        return false;
      }
      // 이름 없는 질문에 우리 이름이 들어가면 안 된다(안전장치).
      if (q.kind === "discovery" && brandKeys.some((b) => key.includes(b))) {
        return false;
      }
      texts.add(key);
      slots.add(slotKey);
      questions.push(q);
      return true;
    },
  };
}

function pickA(
  market: DemandMarket,
  target: number,
  pool: Candidate[],
  commerce: boolean,
  flagshipList: readonly Flagship[],
  picker: Picker
): number {
  let added = 0;
  const lang = LANG[market];
  // A 는 같은 핵심어를 두 번 묻지 않는다(「AI 교육 추천해줘」와 「AI 교육 잘하는 곳 어디야?」).
  const usedCores = new Set<string>();
  const tryAdd = (
    core: string,
    coreKey: string,
    price: boolean,
    provenance: PlanV2Provenance
  ) => {
    if (added >= target || usedCores.has(coreKey)) {
      return;
    }
    const text = aText(market, core, commerce, price, added);
    if (
      picker.add({
        type: "A",
        kind: "discovery",
        market,
        lang,
        text,
        provenance,
      })
    ) {
      usedCores.add(coreKey);
      added += 1;
    }
  };
  const aPool = pool.filter((c) => c.bucket === "A");
  // 1차는 head 하나당 최대 MAX_A_PER_HEAD 개(「교육」만 8개가 되지 않게), 2차는 상한 없이.
  const perHead = new Map<string, number>();
  const ordered = aPool.filter((c) => {
    const n = perHead.get(c.rel.head) ?? 0;
    perHead.set(c.rel.head, n + 1);
    return n < MAX_A_PER_HEAD;
  });
  ordered.push(...aPool.filter((c) => !ordered.includes(c)));
  for (const c of ordered) {
    tryAdd(
      c.rel.core,
      c.rel.coreKey,
      c.rel.intents.includes("price"),
      provenanceOf(c, false)
    );
  }
  // 부족하면 ① B·D 키워드의 핵심어를 A 틀로 ② 프로필의 상품·서비스 이름으로 넓힌다(expanded).
  for (const c of pool.filter((x) => x.bucket !== "A")) {
    tryAdd(c.rel.core, c.rel.coreKey, false, provenanceOf(c, true));
  }
  for (const f of flagshipList) {
    const usable =
      f.lang === lang || (lang === "en" && !HANGUL_TEXT_RE.test(f.description));
    if (usable) {
      tryAdd(f.description, `offering:${compactTerm(f.description)}`, false, {
        keyword: f.keyword?.keyword ?? null,
        volume: f.keyword?.volume ?? null,
        source: f.keyword ? f.keyword.source : f.source,
        offering: f.description,
        expanded: true,
      });
    }
  }
  return added;
}

function pickB(
  market: DemandMarket,
  target: number,
  pool: Candidate[],
  commerce: boolean,
  picker: Picker
): number {
  let added = 0;
  for (const c of pool.filter((x) => x.bucket === "B")) {
    if (added >= target) {
      break;
    }
    const kind = bKindOf(c.rel);
    if (
      picker.add(
        {
          type: "B",
          kind: "discovery",
          market,
          lang: LANG[market],
          text: bText(market, kind, c.rel.core, commerce, c.rel.purpose),
          provenance: provenanceOf(c, false),
        },
        kind
      )
    ) {
      added += 1;
    }
  }
  const order = bExpansionOrder(commerce);
  const anchors = pool.filter((x) => x.bucket === "A" && x.rel.hasModifier);
  const fallbackAnchors = anchors.length > 0 ? anchors : pool;
  for (const [kindIndex, kind] of order.entries()) {
    // 틀마다 다른 핵심어부터(같은 키워드로 B 가 몰리지 않게).
    const shift = kindIndex % Math.max(1, fallbackAnchors.length);
    const rotated = [
      ...fallbackAnchors.slice(shift),
      ...fallbackAnchors.slice(0, shift),
    ];
    for (const c of rotated) {
      if (added >= target) {
        return added;
      }
      if (
        picker.add(
          {
            type: "B",
            kind: "discovery",
            market,
            lang: LANG[market],
            text: bText(market, kind, c.rel.core, commerce, null),
            provenance: provenanceOf(c, true),
          },
          kind
        )
      ) {
        added += 1;
        break; // 한 틀에 한 핵심어씩 — 같은 틀이 몰리지 않게.
      }
    }
  }
  return added;
}

interface Flagship {
  description: string;
  keyword: DemandKeyword | null;
  lang: "ko" | "en";
  name: string;
  offeringSource: BrandProfile["offerings"][number]["source"];
  source: "catalog" | "site";
}

/**
 * 대표 상품·서비스 — 이름(제품 라인명) 없이 **특징**으로 묘사한다.
 * 특징 = 검색 키워드에도 나오는 일반 낱말(「줄기세포배양액」「펩타이드」「CTO」) + 농도(「10%」) + head.
 * 키워드 어디에도 없는 낱말(「네이키드」「선쉴드」 같은 라인명)은 버린다.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: family grouping, generic-word filter and keyword lookup belong to one flagship pass.
function flagships(
  profile: BrandProfile,
  brandNames: readonly string[],
  keywords: Partial<Record<DemandMarket, readonly DemandKeyword[] | null>>,
  minVolume: number
): Flagship[] {
  // 「일반 낱말」 판정은 검색량이 있는 키워드로만 한다 — 씨앗으로 넣은 라인명(「인텐시브볼륨앰플」 월 10)이
  //   그대로 되돌아와 일반 낱말처럼 보이는 것을 막는다.
  const universe = [...(keywords.KR ?? []), ...(keywords.US ?? [])]
    .filter((k) => !k.lowVolume && k.volume >= minVolume)
    .map((k) => k.keyword);
  const families = new Map<
    string,
    {
      count: number;
      first: number;
      flagship: Flagship;
      maxPrice: number;
    }
  >();
  for (const [index, offering] of profile.offerings.entries()) {
    if (
      offering.source === "industry" ||
      offering.source === "site_nav" ||
      offering.source === "site_text"
    ) {
      continue;
    }
    const tokens = offeringTokens(offering.name, brandNames);
    if (!tokens.head) {
      continue;
    }
    const generic = tokens.modifiers.filter(
      (m) =>
        keywordUniverseHas(universe, m.compact) ||
        SHORT_LATIN_RE.test(m.compact)
    );
    if (generic.length === 0 && tokens.features.length === 0) {
      continue; // 「패치」처럼 head 만 남으면 대표 상품 묘사가 아니라 카테고리(A)다.
    }
    const parts = [
      ...generic.map((m) => m.display),
      ...tokens.features,
      tokens.head.display,
    ];
    // 영어 페이지 이름은 원문 그대로(괄호만 뺀다) — 낱말 순서를 섞지 않는다.
    const description =
      offering.lang === "en"
        ? offering.name.replace(BRACKETS_RE, " ").replace(SPACES_RE, " ").trim()
        : parts.join(" ");
    const familyKey = [
      ...generic.map((m) => m.compact),
      tokens.head.compact,
    ].join("+");
    const related =
      universe.length > 0
        ? ([...(keywords[offering.lang === "en" ? "US" : "KR"] ?? [])]
            .filter((k) => {
              const ck = compactTerm(k.keyword);
              return (
                ck.includes(tokens.head?.compact ?? "\u0000") &&
                generic.some((m) => ck.includes(m.compact))
              );
            })
            .sort((a, b) => b.volume - a.volume)[0] ?? null)
        : null;
    const entry = families.get(familyKey) ?? {
      count: 0,
      first: index,
      maxPrice: 0,
      flagship: {
        description,
        name: offering.name,
        lang: offering.lang,
        source: offering.source === "catalog" ? "catalog" : "site",
        offeringSource: offering.source,
        keyword: related,
      },
    };
    entry.count += 1;
    entry.maxPrice = Math.max(entry.maxPrice, offering.price ?? 0);
    families.set(familyKey, entry);
  }
  const commerce = profile.businessType === "commerce";
  // 서비스 사이트: 서비스 페이지 이름 → 홈 소제목 → 홈 제목 조각 순(실제 서비스 이름이 먼저).
  const rank = (f: { flagship: Flagship }) =>
    ({ service_page: 0, site_heading: 1, site_title: 2 })[
      f.flagship.offeringSource as "service_page"
    ] ?? 3;
  return [...families.values()]
    .sort((a, b) =>
      commerce
        ? b.count - a.count || b.maxPrice - a.maxPrice || a.first - b.first
        : rank(a) - rank(b) || a.first - b.first
    )
    .map((f) => f.flagship);
}

function cText(
  market: DemandMarket,
  description: string,
  commerce: boolean
): string {
  if (market === "KR") {
    if (commerce) {
      return `${description} 찾고 있는데 괜찮은 제품 있어?`;
    }
    const service = description.endsWith("서비스")
      ? description
      : `${description} 서비스`;
    return `${service} 하는 곳 있어? 괜찮은 데 추천해줘`;
  }
  return commerce
    ? `I'm looking for a ${description}. Any good ones?`
    : `Is there a company that offers ${description}?`;
}

function pickC(
  market: DemandMarket,
  target: number,
  list: Flagship[],
  commerce: boolean,
  picker: Picker
): number {
  let added = 0;
  const lang = LANG[market];
  for (const f of list) {
    if (added >= target) {
      break;
    }
    const usable =
      f.lang === lang || (lang === "en" && !HANGUL_TEXT_RE.test(f.description));
    if (!usable) {
      continue;
    }
    if (
      picker.add({
        type: "C",
        kind: "discovery",
        market,
        lang,
        text: cText(market, f.description, commerce),
        provenance: {
          keyword: f.keyword?.keyword ?? null,
          volume: f.keyword?.volume ?? null,
          source: f.keyword ? f.keyword.source : f.source,
          offering: f.description,
          expanded: false,
        },
      })
    ) {
      added += 1;
    }
  }
  return added;
}

function dText(
  market: DemandMarket,
  category: string,
  commerce: boolean,
  competitor: string | null
): string {
  if (market === "KR") {
    if (competitor) {
      return commerce
        ? `${competitor} 말고 비슷한 ${category} 뭐 있어?`
        : `${competitor} 말고 비슷한 ${category} 업체 있어?`;
    }
    return commerce
      ? `${category} 브랜드들 비교해줘. 어디가 제일 나아?`
      : `${category} 업체들 비교해줘. 어디가 제일 나아?`;
  }
  if (competitor) {
    return `What are good alternatives to ${competitor} for ${category}?`;
  }
  return commerce
    ? `Compare the top ${category} brands. Which one is best?`
    : `Compare the top ${category} providers. Which one is best?`;
}

function pickD(
  market: DemandMarket,
  target: number,
  pool: Candidate[],
  competitors: readonly string[],
  commerce: boolean,
  picker: Picker
): number {
  let added = 0;
  const categories = pool.filter((c) => c.bucket !== "B");
  const top = categories[0] ?? pool[0];
  if (!top) {
    return 0;
  }
  for (const competitor of competitors) {
    if (added >= target) {
      return added;
    }
    if (
      picker.add({
        type: "D",
        kind: "discovery",
        market,
        lang: LANG[market],
        text: dText(market, top.rel.core, commerce, competitor),
        provenance: { ...provenanceOf(top, false), competitor },
      })
    ) {
      added += 1;
    }
  }
  const compareFirst = [
    ...pool.filter((c) => c.bucket === "D"),
    ...categories.filter((c) => c.bucket !== "D"),
  ];
  for (const c of compareFirst) {
    if (added >= target) {
      break;
    }
    if (
      picker.add({
        type: "D",
        kind: "discovery",
        market,
        lang: LANG[market],
        text: dText(market, c.rel.core, commerce, null),
        provenance: provenanceOf(c, c.bucket !== "D"),
      })
    ) {
      added += 1;
    }
  }
  return added;
}

export function eTexts(
  market: DemandMarket,
  name: string,
  commerce: boolean,
  topic: string | null
): string[] {
  if (market === "KR") {
    const what = commerce ? "브랜드" : "회사";
    let second = `${name} 평판 어때?`;
    if (topic) {
      second = commerce
        ? `${name} ${topic} 괜찮아? 써본 사람들 평 어때?`
        : `${name} ${topic} 맡겨도 괜찮아?`;
    }
    return [
      `${name}${topicParticle(name)} 어떤 ${what}야?`,
      second,
      `${name} 장단점 솔직하게 알려줘`,
    ];
  }
  return [
    commerce
      ? `What is ${name}, and what do they sell?`
      : `What does ${name} do?`,
    topic
      ? `Is ${name}'s ${topic} any good? What do people say?`
      : `Is ${name} any good? What do people say?`,
    `What are the pros and cons of ${name}?`,
  ];
}

function pickE(
  market: DemandMarket,
  target: number,
  input: BuildPlanV2Input,
  topic: string | null,
  picker: Picker
): number {
  const name = market === "KR" ? input.displayNames.ko : input.displayNames.en;
  const texts = eTexts(
    market,
    name,
    input.profile.businessType === "commerce",
    topic
  );
  let added = 0;
  for (let i = 0; i < texts.length && added < target; i += 1) {
    const text = texts[i] as string;
    if (
      picker.add({
        type: "E",
        kind: "brand",
        market,
        lang: LANG[market],
        text,
        provenance: {
          keyword: null,
          volume: null,
          source: "registration",
          expanded: false,
        },
      })
    ) {
      added += 1;
    }
  }
  return added;
}

/** 브랜드 프로필 + 실측 검색량 → 20문항 계획(유형·시장 배분 고정, 부족하면 다른 시장으로 넘긴다). */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the five question types share one market-allocation loop on purpose.
export function buildQuestionPlanV2(input: BuildPlanV2Input): QuestionPlanV2 {
  const markets = (["KR", "US"] as const).filter((m) =>
    input.markets.includes(m)
  );
  const commerce = input.profile.businessType === "commerce";
  const brandKeys = input.brandNames
    .map(compactTerm)
    .filter((k) => k.length >= 2);
  const competitors = (input.competitors ?? []).filter(
    (c) => !brandKeys.some((b) => compactTerm(c).includes(b))
  );
  const pools: Partial<Record<DemandMarket, MarketPools>> = {};
  for (const m of markets) {
    pools[m] =
      input.profile.level === "none"
        ? {
            candidates: [],
            excluded: {
              brand: 0,
              brandExact: 0,
              otherBrand: 0,
              unrelated: 0,
              unmatched: 0,
              lowVolume: 0,
            },
          }
        : collectCandidates(m, input);
  }
  const flagshipList =
    input.profile.level === "none"
      ? []
      : flagships(
          input.profile,
          input.brandNames,
          input.keywords,
          input.minVolume ?? DEFAULT_MIN_VOLUME
        );
  const questions: PlanV2Question[] = [];
  const picker = makePicker(questions, brandKeys);
  // E(브랜드 이해)의 두 번째 질문은 대표 상품·서비스로 묻는다(없으면 1위 카테고리).
  const topicFor = (m: DemandMarket): string | null => {
    const flagship = flagshipList.find(
      (f) =>
        f.lang === LANG[m] ||
        (m === "US" && !HANGUL_TEXT_RE.test(f.description))
    );
    if (flagship) {
      return flagship.description;
    }
    return pools[m]?.candidates.find((c) => c.bucket === "A")?.rel.core ?? null;
  };

  const pick = (type: PlanV2Type, m: DemandMarket, target: number): number => {
    const pool = pools[m]?.candidates ?? [];
    switch (type) {
      case "A":
        return pickA(m, target, pool, commerce, flagshipList, picker);
      case "B":
        return pickB(m, target, pool, commerce, picker);
      case "C":
        return pickC(m, target, flagshipList, commerce, picker);
      case "D":
        return pickD(m, target, pool, competitors, commerce, picker);
      default:
        return pickE(m, target, input, topicFor(m), picker);
    }
  };
  for (const type of PLAN_V2_TYPES) {
    const split = splitByMarket(PLAN_V2_COMPOSITION[type], markets);
    let shortfall = 0;
    for (const m of markets) {
      shortfall += split[m] - (split[m] > 0 ? pick(type, m, split[m]) : 0);
    }
    // 한 시장이 못 채운 자리는 다른 시장이 채운다(국내 → 해외 순).
    for (const m of markets) {
      if (shortfall <= 0) {
        break;
      }
      shortfall -= pick(type, m, shortfall);
    }
  }

  const counts = { A: 0, B: 0, C: 0, D: 0, E: 0 } as Record<PlanV2Type, number>;
  const byMarket: Record<DemandMarket, number> = { KR: 0, US: 0 };
  for (const q of questions) {
    counts[q.type] += 1;
    byMarket[q.market] += 1;
  }
  // 유형 순서(A→E)·시장 순서대로 정렬 — 회차마다 같은 순서(시계열 비교).
  questions.sort(
    (a, b) =>
      PLAN_V2_TYPES.indexOf(a.type) - PLAN_V2_TYPES.indexOf(b.type) ||
      MARKET_ORDER.indexOf(a.market) - MARKET_ORDER.indexOf(b.market)
  );
  const nameLessCount = questions.filter((q) => q.kind === "discovery").length;
  const anyKeywords = markets.some((m) => (input.keywords[m] ?? []).length > 0);
  let note: QuestionPlanV2["note"] = null;
  if (nameLessCount === 0) {
    note = input.profile.level === "none" ? "no_profile" : "no_keyword_data";
  } else if (!anyKeywords) {
    note = "no_keyword_data";
  }
  const excluded: QuestionPlanV2["excluded"] = {};
  for (const m of markets) {
    if (pools[m]) {
      excluded[m] = (pools[m] as MarketPools).excluded;
    }
  }
  return {
    questionPlanVersion: QUESTION_PLAN_V2,
    questions,
    counts,
    markets: byMarket,
    nameLessCount,
    note,
    excluded,
  };
}

/** 측정 맥락 문구 — 이름 없는 질문이 0개일 때 화면·로그가 그대로 쓴다. */
export function planV2NoteText(
  note: QuestionPlanV2["note"],
  isKo = true
): string | null {
  if (note === "no_profile") {
    return isKo
      ? "이름 없는 질문 0개: 공식 사이트·등록 정보에서 상품·서비스·카테고리를 찾지 못했습니다."
      : "0 name-less questions: no products, services or categories found on the site or registration.";
  }
  if (note === "no_keyword_data") {
    return isKo
      ? "검색량 정보 없이 만든 질문이 있습니다(키워드 데이터 없음)."
      : "Some questions were built without search-volume data.";
  }
  return null;
}
