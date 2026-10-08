// 질문 계획 v2 — 질문 개선(2026-10-07 대표 승인 「질문 개선」 · 그림자 전용)
//
// 왜: 규칙 틀만으로 만든 질문에 ① 너무 넓은 질문(AI 캐릭터 영상 회사에 「영상 제작」)
//   ② 조각 난 말(「PDRN 마스크 팩」) ③ 성분을 상품처럼(「EGF peptide」) ④ 다른 브랜드 이름 섞임이 남았다.
//   경쟁사 관행 = 실제 수요 데이터 → 질문 변환 → 검증 → (나중에) 고객 승인. 그 가운데 앞 셋을 한다.
//
// 흐름(LLM 은 주입 — 테스트는 가짜 LLM)
//   1. 프로필 구조화: 이미 모은 **공식 사이트 근거**(상품명·서비스 페이지·제목·소제목·메뉴)만 LLM 에 주고
//      { products[{name,type}], useCases, targetCustomers, problemsSolved, categories, differentiators }
//      엄격 JSON 을 받는다 → zod 검증. 실패하면 규칙 기반 프로필 그대로(LLM 프로필 없음).
//      ⛔ 네이버 지식iN·블로그 데이터는 넣지 않는다(네이버 Open API 약관 — 법무 검토 대기).
//   2. 후보 과생성(40~60): 기존 규칙 문장(template) + LLM 이 프로필·검색량 키워드에만 근거해 다시 쓴 문장.
//      후보마다 출처(키워드+검색량, 또는 「profile」)를 남긴다. 목록에 없는 키워드를 대면 버린다.
//   3. 심사: 결정적 검사(우리 이름·다른 브랜드·언어·길이·성분=상품) → LLM 심사 1회(브랜드당 배치)
//      → 통과 후보만 의미 중복 제거(글자 2-gram 자카드) → 검색량 가중 선발로 20문항
//      (A8 B4 C3 D2 E3 · 시장 비율 그대로). 탈락 사유는 저장한다.
//   LLM 이 하나라도 실패하면 그 단계만 규칙 기반으로 돌아간다(측정을 막지 않는다).
//
// 성분 규칙: 성분(ingredient)은 상품이 아니다. 질문에서는 「성분 X 들어간 <카테고리>」로만 쓴다.

import { z } from "zod";
import type { DemandMarket } from "./demand-prompts";
import { compactTerm } from "./keyword-relevance";
import type { PlanV2Provenance, PlanV2Type } from "./plan-v2-contract";
import {
  type BuildPlanV2Input,
  buildQuestionPlanV2,
  eTexts,
  PLAN_V2_COMPOSITION,
  PLAN_V2_TYPES,
  type PlanV2KeywordRow,
  type PlanV2Question,
  planV2KeywordPool,
  type QuestionPlanV2,
  splitByMarket,
} from "./question-plan-v2";

// ── LLM 주입 계약 ───────────────────────────────────────────────────
export interface PlanLlmRequest {
  callSite: string;
  maxOutputTokens: number;
  prompt: string;
  signal?: AbortSignal;
  system: string;
  temperature?: number;
}
export interface PlanLlmResponse {
  costKrw: number;
  text: string;
}
export type PlanLlm = (request: PlanLlmRequest) => Promise<PlanLlmResponse>;

// ── 1. 프로필 구조화 ────────────────────────────────────────────────
const SHORT_TEXT = z.string().trim().min(1).max(80);
export const PRODUCT_TYPES = [
  "product",
  "ingredient",
  "technology",
  "service",
] as const;
export const llmBrandProfileSchema = z.object({
  products: z
    .array(z.object({ name: SHORT_TEXT, type: z.enum(PRODUCT_TYPES) }))
    .max(40),
  useCases: z.array(SHORT_TEXT).max(20),
  targetCustomers: z.array(SHORT_TEXT).max(20),
  problemsSolved: z.array(SHORT_TEXT).max(20),
  categories: z.array(SHORT_TEXT).min(1).max(15),
  differentiators: z.array(SHORT_TEXT).max(20),
});
export type LlmBrandProfile = z.infer<typeof llmBrandProfileSchema>;

const EVIDENCE_LIMIT = 60;
const SITE_TEXT_LIMIT = 15;

/** LLM 에 주는 공식 사이트 근거(출처 표시 + 이름). 지식iN·블로그는 없다. */
export function profileEvidence(
  input: Pick<BuildPlanV2Input, "profile">,
  siteTextTerms: readonly string[] = []
): string[] {
  const label: Record<string, string> = {
    catalog: "상품명",
    service_page: "서비스 페이지",
    site_heading: "소제목(h1/h3)",
    site_title: "페이지 제목",
    site_nav: "메뉴",
    customer: "고객 입력 상품",
    industry: "등록 업종",
    site_text: "사이트 문구",
  };
  const lines = input.profile.offerings
    .slice(0, EVIDENCE_LIMIT)
    .map((o) => `[${label[o.source] ?? o.source}·${o.lang}] ${o.name}`);
  for (const term of siteTextTerms.slice(0, SITE_TEXT_LIMIT)) {
    lines.push(`[사이트 문구] ${term}`);
  }
  return lines;
}

/** 모델 출력에서 JSON 객체를 꺼낸다(코드펜스·앞뒤 말 무시). 실패하면 null. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const brandKeysOf = (names: readonly string[]) =>
  names.map(compactTerm).filter((k) => k.length >= 2);

/** zod 통과 후 정리 — 우리 이름이 든 항목을 지운다. 상품·카테고리가 다 비면 null(= 규칙 기반으로). */
export function sanitizeLlmProfile(
  value: unknown,
  brandNames: readonly string[]
): LlmBrandProfile | null {
  const parsed = llmBrandProfileSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const keys = brandKeysOf(brandNames);
  const clean = (s: string) => !keys.some((k) => compactTerm(s).includes(k));
  const uniq = (list: readonly string[]) => [
    ...new Map(list.filter(clean).map((s) => [compactTerm(s), s])).values(),
  ];
  const p = parsed.data;
  const products = [
    ...new Map(
      p.products
        .filter((x) => clean(x.name))
        .map((x) => [compactTerm(x.name), x])
    ).values(),
  ];
  const categories = uniq(p.categories);
  if (categories.length === 0 && products.length === 0) {
    return null;
  }
  return {
    products,
    categories,
    useCases: uniq(p.useCases),
    targetCustomers: uniq(p.targetCustomers),
    problemsSolved: uniq(p.problemsSolved),
    differentiators: uniq(p.differentiators),
  };
}

const PROFILE_SYSTEM = `너는 회사 공식 웹사이트에서 읽은 근거만으로 브랜드 프로필을 구조화한다.
규칙:
- 근거 목록에 없는 사실은 쓰지 않는다. 추측·일반 상식으로 채우지 않는다. 모르면 빈 배열.
- 브랜드 이름·제품 라인 이름(고유명사)은 빼고 일반 명사로 쓴다(예: 「OO 인텐시브 볼륨 앰플」 → 「볼륨 앰플」).
- products[].type: product = 실제로 사고파는 물건(앰플·세럼·마스크팩·의자), service = 의뢰하는 서비스(AI 캐릭터 영상 제작·AI 도입 컨설팅),
  ingredient = 성분·원료(PDRN·EGF·펩타이드·히알루론산·나이아신아마이드), technology = 기술·공법(줄기세포 배양 기술·생성형 AI 파이프라인).
  성분은 절대 product 가 아니다. 「EGF 펩타이드」처럼 성분만 있으면 ingredient.
- categories: 고객이 AI 에게 물을 때 쓰는 **이 회사에 맞는 구체적** 카테고리 이름. 너무 넓게 쓰지 않는다
  (AI 캐릭터 영상 회사 → 「AI 캐릭터 영상 제작」, 「영상 제작」 아님).
- 조각 난 말(「마스크 팩」 같은 띄어쓰기 실수·잘린 문구)은 자연스러운 말로 고친다(「마스크팩」).
- 한국어 근거는 한국어로, 영어 근거만 있는 항목은 영어로 쓴다.
- JSON 하나만 출력한다. 설명 금지.`;

export function profilePrompt(args: {
  brandNames: readonly string[];
  evidence: readonly string[];
  industry: string | null;
}): string {
  return `브랜드 이름(출력에 넣지 말 것): ${args.brandNames.join(", ")}
등록 업종: ${args.industry ?? "모름"}
공식 사이트 근거:
${args.evidence.map((line) => `- ${line}`).join("\n")}

다음 모양의 JSON 으로 답해:
{"products":[{"name":"...","type":"product|ingredient|technology|service"}],"useCases":["..."],"targetCustomers":["..."],"problemsSolved":["..."],"categories":["..."],"differentiators":["..."]}`;
}

// ── 2. 후보 ────────────────────────────────────────────────────────
export interface PlanCandidate {
  id: string;
  kind: "brand" | "discovery";
  lang: "ko" | "en";
  market: DemandMarket;
  provenance: PlanV2Provenance;
  text: string;
  type: PlanV2Type;
}

const LANG: Record<DemandMarket, "ko" | "en"> = { KR: "ko", US: "en" };
const KR_KEYWORD_LIMIT = 40;
const US_KEYWORD_LIMIT = 25;
/** 과생성 상한(템플릿 + LLM) — 심사 1회 배치 크기. */
export const MAX_CANDIDATES = 60;
/** LLM 에 유형별로 새로 요청하는 배수(최종 문항 수 × 2, 규칙 문장 다시 쓰기는 따로). */
const OVERGEN_FACTOR = 2;

const generatedSchema = z.object({
  candidates: z
    .array(
      z.object({
        type: z.enum(["A", "B", "C", "D"]),
        market: z.enum(["KR", "US"]),
        text: z.string().trim().min(2).max(160),
        keywordId: z.string().nullish(),
      })
    )
    .max(80),
});

const GENERATE_SYSTEM = `너는 사람들이 ChatGPT·Perplexity 같은 AI 에게 실제로 묻는 질문을 만든다.
규칙:
- 근거는 주어진 「브랜드 프로필」과 「검색 키워드(월 검색량)」뿐이다. 다른 사실을 지어내지 않는다.
- KR 질문 = 실제 한국 사람이 AI 채팅에 치는 자연스러운 반말 한 문장(「PDRN 들어간 앰플 추천해줘」 「AI 캐릭터 영상 만들어주는 업체 어디가 잘해?」).
  US 질문 = casual English one sentence.
- 유형: A = 이 카테고리 구매·의뢰처 찾기, B = 고민·사용법·비용·효과, C = 대표 상품·서비스를 이름 없이 특징으로 묘사해 찾기,
  D = 비교·대안(D 에서만 「등록 경쟁사」 이름을 쓸 수 있다).
- 브랜드 이름(우리·다른 회사 모두)은 넣지 않는다(D 의 등록 경쟁사만 예외).
- 성분은 상품이 아니다: 「PDRN 추천해줘」 「EGF 펩타이드 뭐가 좋아?」 금지 → 「PDRN 들어간 앰플 추천해줘」처럼 「성분 + 들어간 + 카테고리」로만.
- 너무 넓게 묻지 않는다: 이 회사의 구체 카테고리로 묻는다(AI 캐릭터 영상 회사 → 「영상 제작 업체 추천」 금지).
- 키워드 조각을 그대로 붙이지 말고 말이 되게 고친다(「PDRN 마스크 팩」 → 「PDRN 마스크팩」).
- 「다시 쓸 규칙 문장」은 하나씩 같은 유형·시장·키워드로 자연스럽게 다시 쓴다(뜻이 이상하거나 너무 넓으면 이 브랜드 카테고리에 맞게 좁힌다).
  다시 쓴 문장도 candidates 에 넣는다(「만들 개수」와 별도).
- keywordId = 그 질문이 근거로 삼은 키워드 id(목록에 있는 것만). 키워드 없이 프로필에만 근거하면 null.
- JSON 하나만 출력한다. 설명 금지.`;

function keywordLines(
  pools: Partial<Record<DemandMarket, PlanV2KeywordRow[]>>,
  ids: Map<string, { market: DemandMarket; row: PlanV2KeywordRow }>
): string {
  const lines: string[] = [];
  for (const market of ["KR", "US"] as const) {
    for (const row of pools[market] ?? []) {
      const id = `k${ids.size + 1}`;
      ids.set(id, { market, row });
      lines.push(`${id}|${market}|${row.keyword}|${row.volume}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : "(없음)";
}

const TOKEN_SPLIT_RE = /[\s?？!.,~·/()「」"']+/;
const LATIN_CHAR_RE = /[a-z0-9]/;

/** 질문을 낱말 단위 정규형으로 자른다(낱말 경계 판정용). */
function compactTokens(text: string): string[] {
  return text.split(TOKEN_SPLIT_RE).map(compactTerm).filter(Boolean);
}

/**
 * 키워드 글자 2-gram 의 절반 넘게 질문에 있어야 「그 키워드에 근거한 질문」으로 본다.
 * 질문 쪽 2-gram 은 **낱말 안에서만** 만든다 — 「개선 패치」의 낱말 경계를 넘는 「선패」로
 * 「선패치」에 묶이는 일을 막는다(2026-10-07 실측 오연결).
 */
export function keywordFits(text: string, keyword: string): boolean {
  const k = compactTerm(keyword);
  const tokens = compactTokens(text);
  if (k.length < 2) {
    return tokens.includes(k);
  }
  const grams = new Set<string>();
  for (const token of tokens) {
    for (let i = 0; i < token.length - 1; i += 1) {
      grams.add(token.slice(i, i + 2));
    }
  }
  let hit = 0;
  for (let i = 0; i < k.length - 1; i += 1) {
    if (grams.has(k.slice(i, i + 2))) {
      hit += 1;
    }
  }
  return hit / (k.length - 1) > 0.5;
}

/**
 * 키워드가 질문 안에 **낱말 경계에서 시작해** 들어 있는가(띄어쓰기는 무시).
 * 끝은 낱말 끝이거나 한글 조사·어미(「앰플은」 「추천해줘」)로 이어지면 된다. 영문 키워드는
 * 영문 글자로 이어지면 안 된다(「serum」 ≠ 「serums…」가 아니라 「cto」 ≠ 「ctor」).
 */
export function keywordAtBoundary(text: string, keyword: string): boolean {
  const key = compactTerm(keyword);
  const tokens = compactTokens(text);
  const joined = tokens.join("");
  const starts = new Set<number>();
  let pos = 0;
  for (const token of tokens) {
    starts.add(pos);
    pos += token.length;
  }
  const ends = new Set([...starts].filter((x) => x > 0).concat(pos));
  for (const start of starts) {
    if (!joined.startsWith(key, start)) {
      continue;
    }
    const end = start + key.length;
    const next = joined[end] ?? "";
    const lastIsLatin = LATIN_CHAR_RE.test(key.at(-1) ?? "");
    if (ends.has(end) || (!lastIsLatin && HANGUL_RE.test(next))) {
      return true;
    }
    if (lastIsLatin && !LATIN_CHAR_RE.test(next)) {
      return true;
    }
  }
  return false;
}

/** 질문 문장에 낱말 경계로 들어 있는 같은 시장 키워드 중 가장 구체적인(긴) 것, 같으면 검색량이 큰 것. */
export function keywordInText(
  text: string,
  market: DemandMarket,
  ids: ReadonlyMap<string, { market: DemandMarket; row: PlanV2KeywordRow }>
): { market: DemandMarket; row: PlanV2KeywordRow } | undefined {
  let best: { market: DemandMarket; row: PlanV2KeywordRow } | undefined;
  for (const ref of ids.values()) {
    const key = compactTerm(ref.row.keyword);
    if (
      ref.market === market &&
      key.length >= 2 &&
      keywordAtBoundary(text, ref.row.keyword) &&
      (!best ||
        key.length > compactTerm(best.row.keyword).length ||
        (key.length === compactTerm(best.row.keyword).length &&
          ref.row.volume > best.row.volume))
    ) {
      best = ref;
    }
  }
  return best;
}

function generationQuota(
  markets: readonly DemandMarket[]
): Array<{ count: number; market: DemandMarket; type: PlanV2Type }> {
  const out: Array<{ count: number; market: DemandMarket; type: PlanV2Type }> =
    [];
  for (const type of ["A", "B", "C", "D"] as const) {
    const split = splitByMarket(
      Math.ceil(PLAN_V2_COMPOSITION[type] * OVERGEN_FACTOR),
      markets
    );
    for (const market of markets) {
      if (split[market] > 0) {
        out.push({ type, market, count: split[market] });
      }
    }
  }
  return out;
}

export function generatePrompt(args: {
  competitors: readonly string[];
  forbiddenNames: readonly string[];
  keywordText: string;
  markets: readonly DemandMarket[];
  profile: LlmBrandProfile;
  quota: ReturnType<typeof generationQuota>;
  /** 다시 쓸 규칙 문장(유형|시장|keywordId|문장). */
  rewrite: readonly string[];
}): string {
  return `브랜드 프로필(JSON):
${JSON.stringify(args.profile)}

넣으면 안 되는 이름: ${args.forbiddenNames.join(", ") || "(없음)"}
등록 경쟁사(D 에서만 사용 가능): ${args.competitors.join(", ") || "(없음)"}

검색 키워드(id|시장|키워드|월 검색량):
${args.keywordText}

만들 개수(유형·시장별): ${args.quota.map((q) => `${q.type}/${q.market} ${q.count}개`).join(", ")}

다시 쓸 규칙 문장(유형|시장|keywordId|문장):
${args.rewrite.join("\n") || "(없음)"}

다음 모양의 JSON 으로 답해:
{"candidates":[{"type":"A","market":"KR","text":"...","keywordId":"k1"}]}`;
}

// ── 3. 심사 ────────────────────────────────────────────────────────
export const REJECT_REASONS = [
  "irrelevant",
  "too_broad",
  "unnatural",
  "branded",
  "fragment",
  "ingredient_as_product",
  "wrong_language",
  "judge_missing",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

const judgeSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      pass: z.boolean(),
      reasons: z.array(z.string()).optional(),
    })
  ),
});

const JUDGE_SYSTEM = `너는 AI 검색 측정용 질문 후보를 심사한다. 후보마다 pass(true/false)와 탈락 사유를 낸다.
탈락 사유(여러 개 가능):
- irrelevant: 이 브랜드의 카테고리와 관련 없음
- too_broad: 너무 넓어서 이 브랜드가 답에 나올 이유가 약함(AI 캐릭터 영상 회사에 「영상 제작 업체 추천」)
- unnatural: 실제 한국 사람(US 는 미국 사람)이 AI 에게 이렇게 묻지 않음 — 어색한 말투·번역투·키워드 나열
- branded: 유형 A~D 질문에 브랜드 이름이 들어감(D 의 등록 경쟁사 이름은 허용). 유형 E 는 브랜드 이름이 원래 들어간다.
- fragment: 잘린 말·띄어쓰기 깨진 조각·뜻이 안 통하는 말(「PDRN 마스크 팩 찾고 있는데」 — 붙여 써야 할 합성어 「마스크팩」이 「마스크 팩」으로 깨진 것도 fragment)
- ingredient_as_product: 성분을 상품처럼 묻는다(「EGF 펩타이드 추천해줘」). 「성분 들어간 카테고리」는 괜찮다.
엄격하게 보되, 자연스럽고 이 브랜드 카테고리에 맞는 질문은 통과시킨다.
JSON 하나만 출력한다. 설명 금지.`;

export function judgePrompt(args: {
  brandNames: readonly string[];
  candidates: readonly PlanCandidate[];
  competitors: readonly string[];
  profile: LlmBrandProfile | null;
  summary: string;
}): string {
  const brandLine = args.profile
    ? `카테고리: ${args.profile.categories.join(", ")}
상품·서비스: ${args.profile.products
        .filter((p) => p.type === "product" || p.type === "service")
        .map((p) => p.name)
        .join(", ")}
성분(상품 아님): ${args.profile.products
        .filter((p) => p.type === "ingredient")
        .map((p) => p.name)
        .join(", ")}`
    : `공식 사이트 상품·서비스: ${args.summary}`;
  return `브랜드: ${args.brandNames.join(", ")}
${brandLine}
등록 경쟁사: ${args.competitors.join(", ") || "(없음)"}

후보(id|유형|시장|질문):
${args.candidates.map((c) => `${c.id}|${c.type}|${c.market}|${c.text}`).join("\n")}

다음 모양의 JSON 으로 답해(모든 id 에 대해):
{"results":[{"id":"c1","pass":true,"reasons":[]},{"id":"c2","pass":false,"reasons":["too_broad"]}]}`;
}

const HANGUL_RE = /[가-힣]/;
const MIN_TEXT = 6;
const MAX_TEXT = 140;
const WORD_SPLIT_RE = /\s+/;

/** 성분 낱말이 있는데 카테고리·상품 낱말이 하나도 없으면 「성분 = 상품」으로 본다. */
export function ingredientAsProduct(
  text: string,
  profile: LlmBrandProfile | null
): boolean {
  if (!profile) {
    return false;
  }
  const compact = compactTerm(text);
  const ingredients = profile.products
    .filter((p) => p.type === "ingredient")
    .map((p) => compactTerm(p.name))
    .filter((k) => k.length >= 2);
  if (!ingredients.some((k) => compact.includes(k))) {
    return false;
  }
  // 카테고리·상품 이름의 낱말(성분 낱말 제외) 중 하나라도 있으면 「성분 + 카테고리」다.
  const ingredientWords = new Set(
    profile.products
      .filter((p) => p.type === "ingredient")
      .flatMap((p) => p.name.split(WORD_SPLIT_RE).map(compactTerm))
  );
  const heads = [
    ...profile.categories,
    ...profile.products
      .filter((p) => p.type === "product" || p.type === "service")
      .map((p) => p.name),
  ]
    .flatMap((name) => name.split(WORD_SPLIT_RE).map(compactTerm))
    .filter((w) => w.length >= 2 && !ingredientWords.has(w))
    // 질문과 같은 글자(한글/영문)의 낱말만 본다 — 번역 사전이 없으니 다른 말의 질문은 LLM 심사에 맡긴다.
    .filter((w) => HANGUL_RE.test(w) === HANGUL_RE.test(text));
  if (heads.length === 0) {
    return false;
  }
  return !heads.some((w) => compact.includes(w));
}

/**
 * 너무 넓은 질문(결정적): 근거 키워드가 이 회사 카테고리·상품 이름의 **일부분**일 뿐이고
 * (「영상제작」 ⊂ 「AI 캐릭터 영상 제작」) 질문에도 그 카테고리 전체가 없으면 넓다고 본다.
 * LLM 심사가 같은 말을 회차마다 다르게 판정해(2026-10-07 실측) 결정적으로 막는다.
 */
export function keywordTooBroad(
  c: Pick<PlanCandidate, "provenance" | "text">,
  profile: LlmBrandProfile | null
): boolean {
  const keyword = c.provenance.keyword;
  if (!(profile && keyword)) {
    return false;
  }
  const key = compactTerm(keyword);
  const text = compactTerm(c.text);
  const names = [
    ...profile.categories,
    ...profile.products
      .filter((p) => p.type === "product" || p.type === "service")
      .map((p) => p.name),
  ].map(compactTerm);
  const covers = names.filter((n) => n !== key && n.includes(key));
  if (covers.length === 0 || names.includes(key)) {
    return false;
  }
  return !covers.some((n) => text.includes(n));
}

function deterministicRejects(
  c: PlanCandidate,
  ctx: {
    competitorKeys: readonly string[];
    otherKeys: readonly string[];
    ownKeys: readonly string[];
    profile: LlmBrandProfile | null;
  }
): RejectReason[] {
  const reasons: RejectReason[] = [];
  const compact = compactTerm(c.text);
  if (c.kind === "discovery") {
    const own = ctx.ownKeys.some((k) => compact.includes(k));
    const other = ctx.otherKeys.some(
      (k) =>
        compact.includes(k) &&
        !(c.type === "D" && ctx.competitorKeys.includes(k))
    );
    if (own || other) {
      reasons.push("branded");
    }
  }
  const hasHangul = HANGUL_RE.test(c.text);
  if ((c.market === "KR" && !hasHangul) || (c.market === "US" && hasHangul)) {
    reasons.push("wrong_language");
  }
  const words = c.text.split(WORD_SPLIT_RE);
  const repeated = words.some(
    (w, i) => i > 0 && w.length > 1 && w === words[i - 1]
  );
  if (c.text.length < MIN_TEXT || c.text.length > MAX_TEXT || repeated) {
    reasons.push("fragment");
  }
  if (c.kind === "discovery" && ingredientAsProduct(c.text, ctx.profile)) {
    reasons.push("ingredient_as_product");
  }
  if (c.kind === "discovery" && keywordTooBroad(c, ctx.profile)) {
    reasons.push("too_broad");
  }
  return reasons;
}

// ── 4. 중복 제거·선발 ───────────────────────────────────────────────
const STOP_WORDS = new Set([
  "추천해줘",
  "추천",
  "좀",
  "해줘",
  "알려줘",
  "뭐",
  "뭐가",
  "뭐야",
  "좋아",
  "좋아?",
  "있어",
  "있어?",
  "괜찮은",
  "요즘",
  "어디",
  "어디야",
  "어디가",
  "곳",
  "데",
  "the",
  "a",
  "an",
  "best",
  "good",
  "what's",
  "what",
  "which",
  "is",
  "are",
  "can",
  "you",
  "recommend",
  "any",
  "for",
  "me",
  "i",
]);
const PUNCT_RE = /[?？!.,~·]/g;

function bigrams(text: string): Set<string> {
  const content = text
    .toLowerCase()
    .replace(PUNCT_RE, " ")
    .split(WORD_SPLIT_RE)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join("");
  const out = new Set<string>();
  for (let i = 0; i < content.length - 1; i += 1) {
    out.add(content.slice(i, i + 2));
  }
  if (out.size === 0 && content) {
    out.add(content);
  }
  return out;
}

/** 글자 2-gram 자카드(정형 문구·띄어쓰기 차이 무시). 0~1. */
export function textSimilarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (x.size === 0 || y.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const g of x) {
    if (y.has(g)) {
      inter += 1;
    }
  }
  return inter / (x.size + y.size - inter);
}

export const DEDUPE_THRESHOLD = 0.6;

/** 점수 높은 순으로 지나가며 같은 유형·시장에 비슷한 질문이 이미 있으면 버린다. */
export function dedupeCandidates<T extends PlanCandidate>(
  ordered: readonly T[],
  threshold = DEDUPE_THRESHOLD
): { kept: T[]; removed: T[] } {
  const kept: T[] = [];
  const removed: T[] = [];
  for (const c of ordered) {
    const dup = kept.some(
      (k) =>
        k.type === c.type &&
        k.market === c.market &&
        textSimilarity(k.text, c.text) >= threshold
    );
    (dup ? removed : kept).push(c);
  }
  return { kept, removed };
}

/**
 * 검색량 가중 점수 — log10(검색량+1), 프로필만 근거 = 1, LLM 다듬은 문장 +0.5.
 * E(브랜드 이해)는 모두 같은 점수 — 넣은 순서(「어떤 회사야?」 → 대표 상품 → 장단점)를 지킨다.
 */
export function candidateScore(c: PlanCandidate): number {
  if (c.type === "E") {
    return 1;
  }
  const volume = c.provenance.volume ?? 0;
  const base = volume > 0 ? Math.log10(volume + 1) : 1;
  return base + (c.provenance.origin === "llm" ? 0.5 : 0);
}

// ── 오케스트레이션 ──────────────────────────────────────────────────
export interface RefineMetrics {
  candidatesGenerated: number;
  dedupRemoved: number;
  /** 최종 질문 중 검색량 있는 키워드에 묶인 비율(%, 소수 1자리). */
  demandLinkRate: number;
  /** 결정적 검사(이름·언어·길이·성분)로 심사 전에 뺀 수. */
  deterministicRejected: number;
  judge: "llm" | "unavailable";
  judged: number;
  judgePassed: number;
  /** LLM 심사 통과율(%, 소수 1자리). 심사가 없으면 null. */
  judgePassRate: number | null;
  llmCalls: Record<
    "profile" | "generate" | "judge",
    "ok" | "invalid" | "failed" | "skipped"
  >;
  llmCostKrw: number;
  profileSource: "llm" | "rules";
  /** 유형 구성을 다 못 채운 수(지어내지 않는다). */
  shortfall: number;
  version: 1;
}

export interface RejectedCandidate {
  market: DemandMarket;
  origin: "template" | "llm";
  reasons: RejectReason[];
  text: string;
  type: PlanV2Type;
}

export interface RefinedPlan {
  llmProfile: LlmBrandProfile | null;
  metrics: RefineMetrics;
  plan: QuestionPlanV2;
  /** 탈락 예시(최대 REJECTED_KEEP) — 측정 맥락 저장용. */
  rejected: RejectedCandidate[];
}

export const REJECTED_KEEP = 30;

export interface RefineInput extends BuildPlanV2Input {
  industry?: string | null;
  siteTextTerms?: readonly string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function demandLinkRate(questions: readonly PlanV2Question[]): number {
  if (questions.length === 0) {
    return 0;
  }
  const linked = questions.filter(
    (q) => q.provenance.keyword && (q.provenance.volume ?? 0) > 0
  ).length;
  return round1((linked / questions.length) * 100);
}

function emptyMetrics(): RefineMetrics {
  return {
    version: 1,
    profileSource: "rules",
    judge: "unavailable",
    candidatesGenerated: 0,
    deterministicRejected: 0,
    judged: 0,
    judgePassed: 0,
    judgePassRate: null,
    dedupRemoved: 0,
    demandLinkRate: 0,
    shortfall: 0,
    llmCostKrw: 0,
    llmCalls: { profile: "skipped", generate: "skipped", judge: "skipped" },
  };
}

function finalizePlan(
  base: QuestionPlanV2,
  questions: PlanV2Question[]
): QuestionPlanV2 {
  const counts = { A: 0, B: 0, C: 0, D: 0, E: 0 } as Record<PlanV2Type, number>;
  const byMarket: Record<DemandMarket, number> = { KR: 0, US: 0 };
  for (const q of questions) {
    counts[q.type] += 1;
    byMarket[q.market] += 1;
  }
  const order: readonly DemandMarket[] = ["KR", "US"];
  questions.sort(
    (a, b) =>
      PLAN_V2_TYPES.indexOf(a.type) - PLAN_V2_TYPES.indexOf(b.type) ||
      order.indexOf(a.market) - order.indexOf(b.market)
  );
  const nameLessCount = questions.filter((q) => q.kind === "discovery").length;
  return {
    ...base,
    questions,
    counts,
    markets: byMarket,
    nameLessCount,
    note: nameLessCount === 0 ? (base.note ?? "no_keyword_data") : base.note,
  };
}

const toQuestion = (c: PlanCandidate): PlanV2Question => ({
  type: c.type,
  kind: c.kind,
  market: c.market,
  lang: c.lang,
  text: c.text,
  provenance: c.provenance,
});

/** 유형·시장 구성대로 고른다(같은 키워드는 같은 유형·시장에서 한 번 먼저). */
function selectComposition(
  passing: readonly PlanCandidate[],
  markets: readonly DemandMarket[]
): { questions: PlanV2Question[]; shortfall: number } {
  const ranked = [...passing].sort(
    (a, b) => candidateScore(b) - candidateScore(a)
  );
  const used = new Set<string>();
  const questions: PlanV2Question[] = [];
  let shortfall = 0;
  const take = (type: PlanV2Type, market: DemandMarket, n: number) => {
    let added = 0;
    const pool = ranked.filter(
      (c) => c.type === type && c.market === market && !used.has(c.id)
    );
    const seenKeywords = new Set<string>();
    const firstPass = pool.filter((c) => {
      const k = c.provenance.keyword;
      if (!k) {
        return true;
      }
      if (seenKeywords.has(k)) {
        return false;
      }
      seenKeywords.add(k);
      return true;
    });
    for (const c of [
      ...firstPass,
      ...pool.filter((x) => !firstPass.includes(x)),
    ]) {
      if (added >= n) {
        break;
      }
      if (!used.has(c.id)) {
        used.add(c.id);
        questions.push(toQuestion(c));
        added += 1;
      }
    }
    return added;
  };
  for (const type of PLAN_V2_TYPES) {
    const split = splitByMarket(PLAN_V2_COMPOSITION[type], markets);
    let missing = 0;
    for (const m of markets) {
      missing += split[m] - take(type, m, split[m]);
    }
    for (const m of markets) {
      if (missing <= 0) {
        break;
      }
      missing -= take(type, m, missing);
    }
    shortfall += Math.max(0, missing);
  }
  return { questions, shortfall };
}

async function callJson(
  llm: PlanLlm,
  request: PlanLlmRequest,
  costs: { krw: number }
): Promise<unknown> {
  const response = await llm(request);
  costs.krw += Number.isFinite(response.costKrw) ? response.costKrw : 0;
  return extractJson(response.text);
}

const PROFILE_MAX_TOKENS = 1500;
const GENERATE_MAX_TOKENS = 4500;
const JUDGE_MAX_TOKENS = 4000;
/** LLM 심사 응답이 후보의 이 비율 미만만 돌려주면 심사 실패로 본다(잘린 출력). */
const JUDGE_MIN_COVERAGE = 0.8;

/**
 * 규칙 계획 → (LLM 프로필 · LLM 후보 · LLM 심사) → 20문항.
 * llm 이 null 이면 규칙 계획을 그대로 돌려준다(측정 맥락에 profileSource=rules).
 * ⛔ throw 하지 않는다 — 단계마다 실패하면 그 단계만 규칙 기반으로.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: profile → candidates → judge → dedupe → select is one fail-open pipeline; each step's fallback sits next to it on purpose.
export async function refineQuestionPlanV2(
  input: RefineInput,
  llm: PlanLlm | null,
  signal?: AbortSignal
): Promise<RefinedPlan> {
  const base = buildQuestionPlanV2(input);
  const metrics = emptyMetrics();
  if (!llm || input.profile.level === "none") {
    metrics.candidatesGenerated = base.questions.length;
    metrics.demandLinkRate = demandLinkRate(base.questions);
    return { plan: base, metrics, rejected: [], llmProfile: null };
  }
  const markets = (["KR", "US"] as const).filter((m) =>
    input.markets.includes(m)
  );
  const costs = { krw: 0 };
  const ownNames = input.brandNames.filter((n) => n.trim().length >= 2);
  const competitors = (input.competitors ?? []).filter((c) => c.trim());

  // 1. 프로필 구조화
  let llmProfile: LlmBrandProfile | null = null;
  try {
    const json = await callJson(
      llm,
      {
        callSite: "question-plan.profile",
        system: PROFILE_SYSTEM,
        prompt: profilePrompt({
          brandNames: ownNames,
          evidence: profileEvidence(input, input.siteTextTerms ?? []),
          industry: input.industry ?? input.profile.industry,
        }),
        maxOutputTokens: PROFILE_MAX_TOKENS,
        signal,
      },
      costs
    );
    llmProfile = sanitizeLlmProfile(json, ownNames);
    metrics.llmCalls.profile = llmProfile ? "ok" : "invalid";
  } catch {
    metrics.llmCalls.profile = "failed";
  }
  metrics.profileSource = llmProfile ? "llm" : "rules";

  // 2. 후보: 규칙 문장 + (LLM 프로필이 있으면) LLM 다시 쓰기 + E 주제 보강
  const candidates: PlanCandidate[] = [];
  const texts = new Set<string>();
  const push = (c: Omit<PlanCandidate, "id">) => {
    const key = `${c.market}|${compactTerm(c.text)}`;
    if (texts.has(key) || candidates.length >= MAX_CANDIDATES) {
      return;
    }
    texts.add(key);
    candidates.push({ ...c, id: `c${candidates.length + 1}` });
  };
  const pushTemplates = () => {
    for (const q of base.questions) {
      push({ ...q, provenance: { ...q.provenance, origin: "template" } });
    }
  };
  if (llmProfile) {
    const commerce = input.profile.businessType === "commerce";
    const topicKo =
      llmProfile.products.find(
        (p) =>
          (p.type === "product" || p.type === "service") &&
          HANGUL_RE.test(p.name)
      )?.name ??
      llmProfile.categories.find((c) => HANGUL_RE.test(c)) ??
      null;
    const topicEn =
      llmProfile.products.find(
        (p) =>
          (p.type === "product" || p.type === "service") &&
          !HANGUL_RE.test(p.name)
      )?.name ??
      llmProfile.categories.find((c) => !HANGUL_RE.test(c)) ??
      null;
    for (const m of markets) {
      const name = m === "KR" ? input.displayNames.ko : input.displayNames.en;
      for (const text of eTexts(
        m,
        name,
        commerce,
        m === "KR" ? topicKo : topicEn
      )) {
        push({
          type: "E",
          kind: "brand",
          market: m,
          lang: LANG[m],
          text,
          provenance: {
            keyword: null,
            volume: null,
            source: "registration",
            expanded: false,
            origin: "llm",
          },
        });
      }
    }
    const pools: Partial<Record<DemandMarket, PlanV2KeywordRow[]>> = {};
    for (const m of markets) {
      pools[m] = planV2KeywordPool(
        m,
        input,
        m === "KR" ? KR_KEYWORD_LIMIT : US_KEYWORD_LIMIT
      );
    }
    const ids = new Map<
      string,
      { market: DemandMarket; row: PlanV2KeywordRow }
    >();
    const keywordText = keywordLines(pools, ids);
    const idOf = new Map(
      [...ids].map(([id, ref]) => [`${ref.market}|${ref.row.keyword}`, id])
    );
    const rewrite = base.questions
      .filter((q) => q.kind === "discovery")
      .map(
        (q) =>
          `${q.type}|${q.market}|${(q.provenance.keyword && idOf.get(`${q.market}|${q.provenance.keyword}`)) ?? "null"}|${q.text}`
      );
    try {
      const json = await callJson(
        llm,
        {
          callSite: "question-plan.generate",
          system: GENERATE_SYSTEM,
          prompt: generatePrompt({
            profile: llmProfile,
            forbiddenNames: [
              ...ownNames,
              ...(input.otherBrandNames ?? []),
            ].slice(0, 40),
            competitors,
            keywordText,
            markets,
            quota: generationQuota(markets),
            rewrite,
          }),
          maxOutputTokens: GENERATE_MAX_TOKENS,
          temperature: 0.4,
          signal,
        },
        costs
      );
      const parsed = generatedSchema.safeParse(json);
      if (parsed.success) {
        metrics.llmCalls.generate = "ok";
        for (const g of parsed.data.candidates) {
          if (!markets.includes(g.market)) {
            continue;
          }
          const keywordId =
            g.keywordId && g.keywordId !== "null" ? g.keywordId : null;
          // keywordId 를 안 댔어도 질문 안에 검색 키워드가 그대로 들어 있으면 그 키워드(가장 구체적인 것)에 묶는다.
          const named = keywordId ? ids.get(keywordId) : undefined;
          // 댄 키워드가 문장과 안 맞으면(「CTO 구독」 질문에 「AX교육」) 문장 속 키워드로 다시 묶는다.
          const ref =
            named && keywordFits(g.text, named.row.keyword)
              ? named
              : keywordInText(g.text, g.market, ids);
          // 목록에 없는 키워드를 댔거나 다른 시장 키워드면 버린다(근거 없는 질문 금지).
          if (keywordId && (!ref || ref.market !== g.market)) {
            continue;
          }
          const competitor = competitors.find((c) =>
            compactTerm(g.text).includes(compactTerm(c))
          );
          push({
            type: g.type,
            kind: "discovery",
            market: g.market,
            lang: LANG[g.market],
            text: g.text,
            provenance: ref
              ? {
                  keyword: ref.row.keyword,
                  volume: ref.row.volume,
                  source: ref.row.source,
                  expanded: false,
                  origin: "llm",
                  ...(competitor ? { competitor } : {}),
                }
              : {
                  keyword: null,
                  volume: null,
                  source: "profile",
                  expanded: false,
                  origin: "llm",
                  ...(competitor ? { competitor } : {}),
                },
          });
        }
      } else {
        metrics.llmCalls.generate = "invalid";
      }
    } catch {
      metrics.llmCalls.generate = "failed";
    }
  }
  // 규칙 문장은 마지막에(LLM 이 다시 쓴 문장과 겹치면 중복 제거에서 점수가 낮은 쪽이 빠진다).
  pushTemplates();
  metrics.candidatesGenerated = candidates.length;

  // 3. 결정적 검사
  const profileKeys = llmProfile
    ? [...llmProfile.categories, ...llmProfile.products.map((p) => p.name)].map(
        compactTerm
      )
    : [];
  const otherKeys = brandKeysOf([
    ...competitors,
    ...(input.otherBrandNames ?? []),
  ]).filter((k) => !profileKeys.some((p) => p.includes(k) || k.includes(p)));
  const ctx = {
    ownKeys: brandKeysOf(ownNames),
    otherKeys,
    competitorKeys: brandKeysOf(competitors),
    profile: llmProfile,
  };
  const rejected: Array<RejectedCandidate & { id: string }> = [];
  const reject = (c: PlanCandidate, reasons: RejectReason[]) =>
    rejected.push({
      id: c.id,
      text: c.text,
      type: c.type,
      market: c.market,
      origin: c.provenance.origin ?? "template",
      reasons,
    });
  const survivors: PlanCandidate[] = [];
  for (const c of candidates) {
    const reasons = deterministicRejects(c, ctx);
    if (reasons.length > 0) {
      reject(c, reasons);
    } else {
      survivors.push(c);
    }
  }
  metrics.deterministicRejected = rejected.length;

  // 4. LLM 심사(브랜드당 1회)
  let passing = survivors;
  if (survivors.length > 0) {
    try {
      const json = await callJson(
        llm,
        {
          callSite: "question-plan.judge",
          system: JUDGE_SYSTEM,
          prompt: judgePrompt({
            brandNames: ownNames,
            candidates: survivors,
            competitors,
            profile: llmProfile,
            summary: input.profile.offerings
              .slice(0, 12)
              .map((o) => o.name)
              .join(", "),
          }),
          maxOutputTokens: JUDGE_MAX_TOKENS,
          signal,
        },
        costs
      );
      const parsed = judgeSchema.safeParse(json);
      const byId = new Map(
        parsed.success ? parsed.data.results.map((r) => [r.id, r]) : []
      );
      const covered = survivors.filter((c) => byId.has(c.id)).length;
      if (parsed.success && covered >= survivors.length * JUDGE_MIN_COVERAGE) {
        metrics.llmCalls.judge = "ok";
        metrics.judge = "llm";
        passing = [];
        for (const c of survivors) {
          const verdict = byId.get(c.id);
          if (verdict?.pass) {
            passing.push(c);
            continue;
          }
          const reasons = (verdict?.reasons ?? []).filter(
            (r): r is RejectReason =>
              (REJECT_REASONS as readonly string[]).includes(r)
          );
          let finalReasons: RejectReason[] = ["judge_missing"];
          if (verdict) {
            finalReasons = reasons.length > 0 ? reasons : ["irrelevant"];
          }
          reject(c, finalReasons);
        }
        metrics.judged = survivors.length;
        metrics.judgePassed = passing.length;
        metrics.judgePassRate = round1(
          (passing.length / survivors.length) * 100
        );
      } else {
        metrics.llmCalls.judge = "invalid";
      }
    } catch {
      metrics.llmCalls.judge = "failed";
    }
  }

  // 5. 중복 제거 → 선발
  const ordered = [...passing].sort(
    (a, b) => candidateScore(b) - candidateScore(a)
  );
  const { kept, removed } = dedupeCandidates(ordered);
  metrics.dedupRemoved = removed.length;
  const { questions, shortfall } = selectComposition(kept, markets);
  metrics.shortfall = shortfall;
  metrics.llmCostKrw = round2(costs.krw);
  const plan = finalizePlan(base, questions);
  metrics.demandLinkRate = demandLinkRate(plan.questions);
  return {
    plan,
    metrics,
    llmProfile,
    rejected: rejected
      .slice(0, REJECTED_KEEP)
      .map(({ id: _id, ...rest }) => rest),
  };
}
