// 추적 프롬프트 자동 제안 마법사 (표준 백로그 1, 2026-07-30)
//
// 목적: 브랜드 등록 시 AI가 "이 브랜드를 AI 검색에서 어떻게 추적할지"를 맥락에 맞게
//   제안한다 — 추적 질문(프롬프트) ~20개 + 경쟁사 후보 ~6개. 사용자는 체크박스로
//   승인해 Prompt 테이블에 저장한다(경쟁 SoV는 competitor-extract가 답변에서 파싱).
//
// 배경: 러너의 generateAuditPrompts는 브랜드명만 끼운 고정 4개(추천/장단점/유사5/경쟁순위)라
//   업종·맥락이 안 담긴다. Peec·Semrush 등은 등록 시 20~30개 후보를 자동 제안→승인이 표준.
//   여기서 만드는 건 "후보 생성"뿐 — 저장·측정 반영은 서버 액션/러너의 몫(관심사 분리).
//
// 패턴: brand-identity.ts와 동일 — generateObject + zod + Letsur haiku 라우팅 + confident
//   게이트 + 실패 시 정적 폴백(환각·조용한 실패 방지).

import { log } from "@repo/observability/log";
import { generateObject } from "ai";
import { z } from "zod";
import { findEngineName } from "./engine-names";
import {
  HELPER_GATEWAY_MODEL_ID,
  letsurModelWithFallback,
} from "./letsur-fallback";
import { models } from "./models";
import {
  balanceAxisOfType,
  composeQuestions,
  defaultConsumerQuestions,
  fixedAlternativeQuestions,
  guardQuestions,
  industryFrame,
  industryLabel,
  type PlanMarketScope,
  type PlanQuestion,
  QUESTION_COMPOSITION,
  type QuestionType,
  targetCounts,
  topicOfType,
  vetCategoryPhrase,
} from "./question-plan";

// brand-identity.ts와 동일 모델 라우팅(Letsur haiku 우선, 구조화 출력 라이브 검증됨).
const LETSUR_SUGGEST_MODEL_ID =
  process.env.FINDABLE_CREW_LETSUR_MODEL ?? "claude-haiku-4-5-20251001";

function suggestModel() {
  // 🔴 Letsur 불가(유닛 소진·만료·인증)면 같은 호출을 Gateway 로 명시적 폴백(letsur-fallback.ts).
  const letsur = letsurModelWithFallback(LETSUR_SUGGEST_MODEL_ID, {
    callSite: "prompt-suggestions",
    gatewayModelId: HELPER_GATEWAY_MODEL_ID,
  });
  if (letsur) {
    return letsur;
  }
  return models.chat;
}

export type SuggestLanguage = "ko" | "en";

// audit runner의 균형 원칙(P0-a) 계승: 추적 질문은 두 유형을 섞는다.
//   - brand: 브랜드 자체를 물어 노출·팩트정합·감성 측정.
//   - competitor: 경쟁 대비 순위·SoV 측정(estimateMentionPosition·경쟁벤치 의존).
export type PromptCategoryHint = "brand" | "competitor";

/**
 * 질문의 **의도 유형** — DB `PromptCategory` enum 과 같은 문자열을 쓴다(schema.prisma).
 *
 * 🔴 왜 `category`(brand/competitor) 와 **따로** 두는가 (N-42):
 *   `category` 는 **측정 균형 축**이다 — 브랜드형·경쟁형을 번갈아 섞어야
 *   노출(SoV)과 순위를 같이 잴 수 있다(P0-a · `interleave`). 이 축을 없애면 측정이 기운다.
 *   `topic` 은 **주제 축**이다 — "무엇을 묻는 질문인가"라서 묶어 보여주고 처방을 가른다.
 *   → 두 축은 목적이 다르다. 합치면 둘 중 하나가 망가진다.
 *
 * 🔴 이걸 만든 이유: 예전엔 배열 단위로 category 를 통째 부여해
 *   실제 저장되는 값이 `recommendation`·`comparison` **2종뿐**이었다(실측).
 *   `best_in_category`(카테고리 1위)처럼 GEO 에서 가장 중요한 유형이 **한 번도 안 잡혔다**.
 */
export type PromptTopic =
  | "best_in_category"
  | "alternative"
  | "comparison"
  | "recommendation"
  | "problem_solving"
  | "buying_guide"
  | "custom";

/** LLM 이 유형을 못 정하거나 모르는 값을 뱉었을 때의 안전한 기본값. */
const FALLBACK_TOPIC: Record<PromptCategoryHint, PromptTopic> = {
  brand: "recommendation",
  competitor: "comparison",
};

const TOPIC_VALUES = new Set<string>([
  "best_in_category",
  "alternative",
  "comparison",
  "recommendation",
  "problem_solving",
  "buying_guide",
  "custom",
]);

/**
 * LLM 이 준 유형 문자열을 enum 으로 좁힌다.
 * ⚠️ 모르는 값이면 **버리지 않고** 균형 축 기준 기본값으로 떨어뜨린다 —
 *   질문 자체는 멀쩡한데 유형 하나 때문에 제안이 사라지면 손해다.
 */
export function normalizeTopic(
  raw: string | undefined,
  hint: PromptCategoryHint
): PromptTopic {
  const v = raw?.trim().toLowerCase();
  return v && TOPIC_VALUES.has(v) ? (v as PromptTopic) : FALLBACK_TOPIC[hint];
}

export interface SuggestedPrompt {
  category: PromptCategoryHint;
  language: SuggestLanguage;
  text: string;
  /** 주제 유형(7종). 저장 시 `Prompt.category` 로 들어간다. */
  topic: PromptTopic;
  /** 단계2 질문 유형(구매·고민·대표상품·대안·브랜드 이해). 화면이 묶어 보여준다. 옛 제안엔 없다. */
  type?: QuestionType;
}

export interface PromptSuggestions {
  competitors: string[];
  prompts: SuggestedPrompt[];
  /** 사이트에서 읽은 글자가 거의 없어 질문이 일반적일 수 있다(화면이 안내할 수 있게 알린다). */
  siteThin?: boolean;
}

// 상한: 구성비(8·4·3·2·3 = 20)와 같다. 러너 원가·429 보호는 저장 상한(플랜)과 러너 상한이 맡는다.
const MAX_PROMPTS = Object.values(QUESTION_COMPOSITION).reduce(
  (a, b) => a + b,
  0
);
// 유형별로 목표보다 넉넉히 받아 둔다 — 자동 검사에서 버려지는 몫.
const OVERSHOOT = 3;
// 거른 뒤 이 수보다 적으면 한 번 더 만들어 합친다(추가 AI 호출 1회 · 2026-10-14 대표 위임 승인).
const RETRY_BELOW = 14;
// 사이트 글이 이만큼은 있어야 "대표 상품 0개"를 재시도 사유로 본다(글이 없는 사이트에서 헛호출 방지).
const MIN_SITE_TEXT_FOR_REPRESENTATIVE_RETRY = 300;

/**
 * 질문 1개 = 문장 + 언어. 유형은 배열(유형별 목록)이 정한다 — 질문마다 LLM 이 유형을 고르게 하면
 * 이름 없는 유형에 이름이 섞이는 오분류가 늘어서, 유형은 프롬프트 구조로 고정하고 코드가 검사한다.
 * ⚠️ **추가 AI 호출은 없다**(같은 `generateObject` 한 번).
 */
const promptItemSchema = z.object({
  text: z.string(),
  language: z.enum(["ko", "en"]),
  // 이 질문이 나온 재료. 재료에 없는 이름·사실을 지어내지 않았다는 자기 신고이며, 코드가 대조해 거른다.
  basis: z.enum(["brand", "competitor", "industry", "site"]).optional(),
  // 질문이 브랜드 이름의 뜻을 풀어서(예: 넘버즈인→번호 매긴) 나왔으면 true. true 면 코드가 버린다.
  fromName: z.boolean().optional(),
});

const suggestionSchema = z.object({
  category: z
    .array(promptItemSchema)
    .describe(
      "이름 없는 구매·카테고리 질문. 소비자가 AI에게 반말로 묻는 말. 예: '민감성 피부 보습 크림 추천해줘', '아이 간식 뭐가 좋아?'. 브랜드명·별칭을 절대 넣지 말 것."
    )
    .default([]),
  concern: z
    .array(promptItemSchema)
    .describe(
      "이름 없는 고민 해결 질문. 예: '환절기에 피부가 당기는데 어떻게 해?'. 브랜드명·별칭 금지."
    )
    .default([]),
  representative: z
    .array(promptItemSchema)
    .describe(
      "이름 없는 대표 제품·서비스 질문. **공식 사이트 문구에 적힌 제품·서비스·특징만** 써서 만든다. 사이트에 없는 제품명·수치·성분은 지어내지 말 것. 브랜드명·별칭 금지."
    )
    .default([]),
  alternative: z
    .array(promptItemSchema)
    .describe(
      "비교·대안 질문. 경쟁사 이름이 주어졌을 때만 '[경쟁사] 대신 쓸 만한 곳', '[경쟁사] 말고 뭐 있어?' 형태로 만든다(우리 브랜드명은 넣지 말 것). 경쟁사가 없으면 빈 배열."
    )
    .default([]),
  brandUnderstanding: z
    .array(promptItemSchema)
    .describe(
      "브랜드를 직접 묻는 질문. 반드시 브랜드명을 넣을 것. 예시는 프롬프트의 [업종 틀]을 따른다(업종에 맞지 않는 구매처 질문 금지)."
    )
    .default([]),
  categoryPhrase: z
    .string()
    .describe(
      "이 브랜드가 속한 서비스 분야 이름 한 줄(예: 'AI 검색 가시성 진단 서비스', '신생아용 보습 스킨케어'). 회사·브랜드·제품 고유명사와 AI 서비스 이름은 절대 넣지 말 것. 모르면 빈 문자열."
    )
    .default(""),
  confident: z
    .boolean()
    .describe(
      "주어진 업종·사이트 문구로 맥락 있는 질문을 만들었으면 true. 재료가 부족해 추측했으면 false."
    ),
});

export interface SuggestInput {
  /** 고객이 확인한 별칭(한·영·제품 표기). */
  aliases?: readonly string[];
  brandName: string;
  /** 등록·승인된 경쟁사 이름. 없으면 대안 질문은 일반형. */
  competitors?: readonly string[];
  domain: string;
  /** 업종 enum 값. */
  industry?: string | null;
  /** 주 사용 언어 힌트(시장 범위가 없을 때). */
  language?: "ko" | "en" | "both";
  /** 타깃 시장 — 언어 배분을 정한다. */
  marketScope?: PlanMarketScope | null;
  /** 공식 사이트가 스스로 쓴 문구(제목·설명·H1 + 소제목·FAQ·구조화 데이터·본문 첫머리). */
  site?: {
    bodySnippet?: string | null;
    description?: string | null;
    faq?: readonly string[] | null;
    h1?: string | null;
    headings?: readonly string[] | null;
    jsonLdFacts?: readonly string[] | null;
    siteName?: string | null;
    /** 사이트 글자가 거의 안 읽혔다(JS 렌더링·차단 의심) — 재료가 얇다는 신호. */
    thin?: boolean;
    title?: string | null;
  } | null;
}

const MARKET_LABEL: Record<PlanMarketScope, string> = {
  korea: "한국",
  global: "해외(영어)",
  both: "한국+해외",
};

function scopeOf(input: SuggestInput): PlanMarketScope {
  if (input.marketScope) {
    return input.marketScope;
  }
  if (input.language === "en") {
    return "global";
  }
  return input.language === "both" ? "both" : "korea";
}

function siteTextOf(site: SuggestInput["site"]): string {
  return [
    site?.title,
    site?.siteName,
    site?.h1,
    site?.description,
    ...(site?.headings ?? []),
    ...(site?.faq ?? []),
    ...(site?.jsonLdFacts ?? []),
    site?.bodySnippet,
  ]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" ");
}

/** 프롬프트에 싣는 사이트 재료(길이를 묶는다). */
function siteMaterialOf(site: SuggestInput["site"]): string {
  if (!site) {
    return "없음";
  }
  const lines = [
    [site.title, site.siteName, site.h1, site.description]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .join(" / "),
    site.headings?.length
      ? `소제목: ${site.headings.slice(0, 12).join(" · ")}`
      : "",
    site.faq?.length ? `사이트 FAQ: ${site.faq.slice(0, 8).join(" · ")}` : "",
    site.jsonLdFacts?.length
      ? `구조화 정보: ${site.jsonLdFacts.slice(0, 8).join(" · ")}`
      : "",
    site.bodySnippet ? `본문 첫머리: ${site.bodySnippet.slice(0, 900)}` : "",
  ].filter(Boolean);
  return lines.length > 0 ? lines.join("\n  ") : "없음";
}

const PROTOCOL_RE = /^https?:\/\//;
const WWW_RE = /^www\./;

function domainName(domain: string): string {
  return (
    domain
      .replace(PROTOCOL_RE, "")
      .replace(WWW_RE, "")
      .split("/")[0]
      ?.split(".")[0] ?? ""
  );
}

function brandNamesOf(input: SuggestInput): string[] {
  return [
    input.brandName,
    ...(input.aliases ?? []),
    input.site?.siteName ?? "",
    domainName(input.domain),
  ].filter((v) => v.trim().length >= 2);
}

function toSuggested(q: PlanQuestion): SuggestedPrompt {
  return {
    text: q.text,
    language: q.language,
    category: balanceAxisOfType(q.type),
    topic: topicOfType(q.type),
    type: q.type,
  };
}

/**
 * 정적 폴백 — LLM 실패·비확신 시 업종 분야 이름만으로 만든 소비자 말투 기본 질문을 제안으로 낸다.
 *   업종을 모르면(또는 other) 지어내지 않고 빈 목록 — 화면이 "직접 추가"로 안내한다.
 */
export function staticFallback(input: SuggestInput): PromptSuggestions {
  const defaults = defaultConsumerQuestions({
    englishName: input.brandName,
    industry: input.industry,
    koreanName: input.brandName,
    language: scopeOf(input) === "global" ? "en" : "ko",
  });
  if (!defaults) {
    return { prompts: [], competitors: [] };
  }
  const prompts = defaults.map((d) =>
    toSuggested({
      language: d.language,
      text: d.text,
      type: d.nameless ? "category" : "brand",
    })
  );
  return { prompts, competitors: [] };
}

/**
 * 브랜드 등록 맥락 → 추적 질문 후보(소비자 말투 · 이름 없는 질문 중심).
 *   입력: 업종·시장·사이트 문구·별칭·경쟁사 (브랜드명 단독 입력은 오분류 위험).
 *   추가 AI 호출은 1개(generateObject). 코드가 결과를 거른 뒤 구성비(8·4·3·2·3)에 맞춘다.
 *   반환값은 "후보"일 뿐 — 사람이 고른 것만 저장·측정된다(호출부의 승인 흐름).
 */
export async function suggestTrackingPrompts(
  input: SuggestInput
): Promise<PromptSuggestions> {
  const scope = scopeOf(input);
  try {
    const siteText = siteTextOf(input.site);
    // 사이트 글이 AI 엔진 이름을 직접 쓰는 브랜드(사업이 AI 검색)만 질문의 엔진 이름을 허용한다.
    const allowEngineNames = findEngineName(siteText) !== null;
    const ctx = {
      allowEngineNames,
      brandNames: brandNamesOf(input),
      competitors: input.competitors,
      industry: input.industry,
      requireBasis: true,
      siteText,
    };
    const hasCompetitors = (input.competitors?.length ?? 0) > 0;
    let all: PlanQuestion[] = [];
    let confident = true;
    // 첫 결과가 이미 충분했고 대표 상품만 비어서 다시 만드는 경우 — 두 번째 응답의 "확신 없음"이 멀쩡한 첫 결과를 버리게 하면 안 된다.
    let representativeOnlyRetry = false;
    let categoryPhrase: string | null = null;
    // 처음 1번 + 모자라면 1번 더(합쳐서 다시 거른다). 추가 호출은 최대 1회.
    for (let attempt = 0; attempt < 2; attempt++) {
      const round = await generateCandidates(input, scope);
      all = [...all, ...round.questions];
      confident = representativeOnlyRetry
        ? confident
        : confident && round.confident;
      categoryPhrase ??= vetCategoryPhrase(round.categoryPhrase, ctx);
      const guarded = guardQuestions(all, ctx);
      const composed = composeWithFixedAlternatives(
        composeQuestions(guarded.kept, scope, { preferListing: true }),
        input,
        scope,
        hasCompetitors,
        categoryPhrase
      );
      logGuardDropped(attempt, input.brandName, guarded.dropped);
      const missingRepresentative = shouldRetryForRepresentative(
        attempt,
        input,
        siteText,
        composed
      );
      if (missingRepresentative && composed.length >= RETRY_BELOW) {
        representativeOnlyRetry = true;
      }
      if (
        (composed.length >= RETRY_BELOW && !missingRepresentative) ||
        attempt === 1 ||
        !round.confident
      ) {
        // 비확신이거나 사실상 빈손이면 업종 기반 기본 질문으로 최소치 보장.
        if (!confident || composed.length < 4) {
          return staticFallback(input);
        }
        return {
          prompts: composed.slice(0, MAX_PROMPTS).map(toSuggested),
          competitors: [],
          ...(input.site?.thin ? { siteThin: true } : {}),
        };
      }
    }
    return staticFallback(input);
  } catch (error) {
    log.warn("prompt.suggest.failed", {
      brandName: input.brandName,
      domain: input.domain,
      error: String(error),
    });
    return staticFallback(input);
  }
}

/** 사이트 글이 충분한데 대표 상품 질문이 하나도 안 남았으면 한 번 더 만든다(실측: 같은 사이트가 0~3개로 흔들림). */
function shouldRetryForRepresentative(
  attempt: number,
  input: SuggestInput,
  siteText: string,
  composed: readonly PlanQuestion[]
): boolean {
  return (
    attempt === 0 &&
    input.site?.thin !== true &&
    siteText.length >= MIN_SITE_TEXT_FOR_REPRESENTATIVE_RETRY &&
    !composed.some((c) => c.type === "representative")
  );
}

/** 가드가 버린 사유를 남긴다. 대표 상품이 왜 비었는지 보려고 그 유형의 사유·문장도 함께(모델이 만든 질문 문장뿐, 고객 정보 없음). */
function logGuardDropped(
  attempt: number,
  brandName: string,
  dropped: readonly { reason: string; text: string; type: QuestionType }[]
) {
  if (dropped.length === 0) {
    return;
  }
  log.info("prompt.suggest.guard_dropped", {
    attempt,
    brandName,
    dropped: dropped.map((d) => d.reason),
    droppedRepresentative: dropped
      .filter((d) => d.type === "representative")
      .map((d) => ({ reason: d.reason, text: d.text })),
  });
}

/** 경쟁사가 없으면 대안 질문은 모델 것을 버리고 코드의 고정 문형으로 채운다. */
function composeWithFixedAlternatives(
  composed: PlanQuestion[],
  input: SuggestInput,
  scope: PlanMarketScope,
  hasCompetitors: boolean,
  categoryPhrase: string | null
): PlanQuestion[] {
  if (hasCompetitors) {
    return composed;
  }
  return [
    ...composed.filter((q) => q.type !== "alternative"),
    ...fixedAlternativeQuestions(input.industry, scope, categoryPhrase),
  ];
}

async function generateCandidates(
  input: SuggestInput,
  scope: PlanMarketScope
): Promise<{
  categoryPhrase: string;
  confident: boolean;
  questions: PlanQuestion[];
}> {
  const targets = targetCounts(scope);
  const want = (type: QuestionType) =>
    (["ko", "en"] as const)
      .filter((lang) => targets[type][lang] > 0)
      .map(
        (lang) =>
          `${lang === "ko" ? "한국어" : "영어"} ${targets[type][lang] + OVERSHOOT}개`
      )
      .join(" + ");
  const label = industryLabel(input.industry);
  const frame = industryFrame(input.industry);
  const hasCompetitors = (input.competitors?.length ?? 0) > 0;
  const { object: out } = await generateObject({
    model: suggestModel(),
    schema: suggestionSchema,
    prompt: `브랜드를 AI 검색(ChatGPT·Perplexity·네이버 등)에서 추적할 **질문 후보**를 만들어줘.
질문은 투자자가 아니라 **${frame.persona}가 AI에게 실제로 묻는 말**(대화체)이어야 해.

[재료]
- 브랜드명: ${input.brandName}${input.aliases?.length ? ` (별칭: ${input.aliases.join(", ")})` : ""}
- 도메인: ${input.domain}
- 업종: ${label ? label.ko : "알 수 없음"}
- 타깃 시장: ${MARKET_LABEL[scope]}
- 공식 사이트 문구:
  ${siteMaterialOf(input.site)}
- 경쟁사: ${hasCompetitors ? (input.competitors ?? []).join(", ") : "없음"}

[업종 틀 — 이 업종 고객이 궁금해하는 것: ${frame.focus}]
- 브랜드 직접 질문 예시(브랜드명 자리에 이름을 넣어): ${frame.brandExamples.join(" / ")}

[만들 개수 — 유형별]
- category(구매·카테고리, 이름 없음): ${want("category")}
- concern(고민 해결, 이름 없음): ${want("concern")}
- representative(대표 제품·서비스, 이름 없음, 사이트 문구에 있는 것만): ${want("representative")}
- alternative(비교·대안): ${hasCompetitors ? want("alternative") : "만들지 마(경쟁사가 없으면 빈 배열)"}
- brandUnderstanding(브랜드 직접 질문): ${want("brand")}

[질문 형태 — 가장 중요]
- 이름 없는 질문(category·concern·representative)은 **AI 가 여러 브랜드·서비스를 나열하며 답하게 되는 질문**이어야 해: "~ 추천해줘", "~ 뭐가 좋아?", "~ 중에 어떤 게 나아?", "A 대신 쓸 만한 곳", "~하려면 어떤 서비스를 써야 해?".
- 개념 설명·정의·차이·방법만 묻는 질문("~이 뭐야?", "~랑 뭐가 달라?", "어떻게 하는 거야?")은 AI 가 브랜드 없이 설명만 하므로 **거의 만들지 마**(전체의 30% 이하).
- concern(고민)은 고민을 말한 뒤 "그럼 어떤 제품·서비스를 써야 해?"처럼 **해결 수단을 묻는 형태**로 끝내.

[규칙]
- category·concern·representative 질문에는 **브랜드명·별칭·도메인 이름을 절대 넣지 마.**
- 사이트 문구에 없는 제품명·성분·수치·실적은 만들지 마. 재료가 부족하면 개수를 줄이고 confident=false 로 표시해.
- **재료에 없는 회사·서비스·제품 이름(고유명사)을 질문에 쓰지 마.** 경쟁사는 위 [경쟁사]에 있는 이름만 쓴다.
${
  findEngineName(siteTextOf(input.site)) !== null
    ? "- 이 브랜드의 사업이 AI 검색이라 질문에 ChatGPT·Perplexity·네이버 AI 같은 이름이 자연스러우면 써도 돼(특히 concern). 단 브랜드명은 넣지 마."
    : "- ChatGPT·Claude·Gemini 같은 **AI 서비스·모델 이름을 질문에 쓰지 마.**"
}
- 브랜드 이름의 뜻을 풀어서 질문을 만들지 마(예: 이름이 '넘버즈인'이라고 '번호 매긴 제품'으로 쓰기 금지).
- "~라고 했는데", "~있다던데"처럼 **들은 이야기를 전제로 까는 문장 금지.** 질문은 전제 없이 바로 묻는다.
- categoryPhrase 에는 이 브랜드가 속한 **서비스 분야 이름**을 한 줄로 적어(고유명사·AI 서비스 이름 금지). 다른 선택지를 묻는 고정 질문에 쓰인다.
- 각 질문의 basis 에 재료 출처를 적어(brand·competitor·industry·site). 대표 제품 질문은 site 만 가능.
- 질문이 브랜드 이름의 뜻을 풀어서(이름 속 단어를 번역·설명해서) 나왔으면 fromName=true 로 표시해. 이름 뜻을 질문 소재로 삼는 것은 금지야.
- 언어는 각 항목의 language 에 맞게(ko=한국어, en=영어) 자연스럽게.`,
  });
  const asPlan = (
    items: {
      basis?: PlanQuestion["basis"];
      language: SuggestLanguage;
      text: string;
    }[],
    type: QuestionType
  ): PlanQuestion[] => items.map((i) => ({ ...i, type }));
  return {
    categoryPhrase: out.categoryPhrase,
    confident: out.confident,
    questions: [
      ...asPlan(out.category, "category"),
      ...asPlan(out.concern, "concern"),
      ...asPlan(out.representative, "representative"),
      ...asPlan(out.alternative, "alternative"),
      ...asPlan(out.brandUnderstanding, "brand"),
    ],
  };
}
