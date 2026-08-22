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

import { createOpenAI } from "@ai-sdk/openai";
import { log } from "@repo/observability/log";
import { generateObject } from "ai";
import { z } from "zod";
import { models } from "./models";

// brand-identity.ts와 동일 모델 라우팅(Letsur haiku 우선, 구조화 출력 라이브 검증됨).
const LETSUR_SUGGEST_MODEL_ID =
  process.env.FINDABLE_CREW_LETSUR_MODEL ?? "claude-haiku-4-5-20251001";

function suggestModel() {
  const letsurKey = process.env.LETSUR_API_KEY;
  if (letsurKey) {
    const letsur = createOpenAI({
      baseURL: "https://gw.letsur.ai/v1",
      apiKey: letsurKey,
    });
    return letsur(LETSUR_SUGGEST_MODEL_ID);
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
}

export interface PromptSuggestions {
  competitors: string[];
  prompts: SuggestedPrompt[];
}

// 개수 상한(전략: 지금은 고정, 플랜별 차등은 백로그 2·7 게이팅에서). 러너 원가·429 보호.
const MAX_PROMPTS = 24;
const MAX_COMPETITORS = 8;

/**
 * 질문 1개 = 문장 + **주제 유형**.
 *
 * 🔴 N-42: 예전엔 `z.array(z.string())` 이라 유형을 **배열 단위로 통째** 부여했다
 *   → 저장되는 값이 2종뿐이었다. 이제 질문마다 LLM 이 유형을 판단한다.
 *   ⚠️ **추가 AI 호출은 없다**(같은 `generateObject` 한 번의 출력 모양만 바뀐다).
 */
const promptItemSchema = z.object({
  text: z.string(),
  topic: z
    .enum([
      "best_in_category",
      "alternative",
      "comparison",
      "recommendation",
      "problem_solving",
      "buying_guide",
      "custom",
    ])
    .describe(
      "이 질문의 의도. best_in_category=카테고리 1위/최고를 묻는 것, alternative=대안·대체재를 찾는 것, comparison=둘 이상을 비교하는 것, recommendation=추천을 구하는 것, problem_solving=문제·고민 해결을 묻는 것, buying_guide=구매 기준·고르는 법을 묻는 것, custom=위 어디에도 안 맞는 것."
    ),
});

const suggestionSchema = z.object({
  brandPromptsKo: z
    .array(promptItemSchema)
    .describe(
      "브랜드 자체를 묻는 한국어 질문 5~7개. 예: '{브랜드} 어때?', '{브랜드} 믿을만해?'. 실제 소비자가 AI에게 물을 법한 자연스러운 문장. 각 질문에 topic 을 붙일 것."
    )
    .default([]),
  brandPromptsEn: z
    .array(promptItemSchema)
    .describe("Same as brandPromptsKo but in English, 5~7 items.")
    .default([]),
  competitorPromptsKo: z
    .array(promptItemSchema)
    .describe(
      "경쟁·카테고리 순위를 묻는 한국어 질문 5~7개. 예: '{카테고리} 브랜드 추천 5개', '{브랜드} 대안'. 브랜드가 경쟁사 나열 속에서 얼마나 등장하는지 측정용. 각 질문에 topic 을 붙일 것."
    )
    .default([]),
  competitorPromptsEn: z
    .array(promptItemSchema)
    .describe("Same as competitorPromptsKo but in English, 5~7 items.")
    .default([]),
  competitors: z
    .array(z.string())
    .describe(
      "이 브랜드의 실제 경쟁 브랜드명 3~8개(브랜드명만, 설명 없이). 확실하지 않으면 넣지 말 것."
    )
    .default([]),
  confident: z
    .boolean()
    .describe(
      "이 브랜드/업종을 실제로 알고 맥락 있는 제안을 했으면 true. 도메인만 보고 추측했으면 false."
    ),
});

// 목록 마커("- ", "1. ", "* ")·따옴표 제거용(top-level: useTopLevelRegex).
const LIST_MARKER_RE = /^\s*[-*\d.)\s]+/;
const QUOTE_RE = /["'`]/g;

function cleanLine(raw: string): string {
  return raw.replace(LIST_MARKER_RE, "").replace(QUOTE_RE, "").trim();
}

function takeClean(
  items: Array<{ text: string; topic?: string }>,
  language: SuggestLanguage,
  category: PromptCategoryHint
): SuggestedPrompt[] {
  const seen = new Set<string>();
  const out: SuggestedPrompt[] = [];
  for (const raw of items) {
    const text = cleanLine(raw.text ?? "");
    const key = text.toLowerCase();
    if (text.length >= 3 && text.length <= 200 && !seen.has(key)) {
      seen.add(key);
      // 모르는 유형이어도 질문은 살린다(normalizeTopic 이 균형축 기준으로 떨어뜨린다).
      out.push({
        text,
        language,
        category,
        topic: normalizeTopic(raw.topic, category),
      });
    }
  }
  return out;
}

function dedupeCompetitors(items: string[], brandName: string): string[] {
  const seen = new Set<string>([brandName.toLowerCase()]);
  const out: string[] = [];
  for (const raw of items) {
    const name = cleanLine(raw);
    const key = name.toLowerCase();
    if (name.length >= 1 && name.length <= 60 && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out.slice(0, MAX_COMPETITORS);
}

// 두 유형을 번갈아 섞어 상한까지(brand·competitor 균형 유지 — P0-a). ko/en도 교차.
function interleave(
  brand: SuggestedPrompt[],
  competitor: SuggestedPrompt[]
): SuggestedPrompt[] {
  const out: SuggestedPrompt[] = [];
  const max = Math.max(brand.length, competitor.length);
  for (let i = 0; i < max && out.length < MAX_PROMPTS; i++) {
    if (brand[i]) {
      out.push(brand[i] as SuggestedPrompt);
    }
    if (competitor[i] && out.length < MAX_PROMPTS) {
      out.push(competitor[i] as SuggestedPrompt);
    }
  }
  return out;
}

/**
 * 정적 폴백 — LLM 실패·비확신 시 generateAuditPrompts와 같은 골격을 제안으로 낸다.
 *   최소한 고정 4개 수준은 항상 보장(마법사가 빈 화면이 되지 않게).
 */
function staticFallback(brandName: string): PromptSuggestions {
  // ⚠️ 폴백도 유형을 갖는다 — LLM 이 실패해도 묶음 화면이 「직접 추가」 한 덩어리가 되지 않게.
  //   유형은 문장의 실제 의도에 맞춘다(추측 라벨을 붙이면 처방이 어긋난다).
  const prompts: SuggestedPrompt[] = [
    {
      text: `${brandName} 추천해줘`,
      language: "ko",
      category: "brand",
      topic: "recommendation",
    },
    {
      text: `${brandName}의 장단점은?`,
      language: "ko",
      category: "brand",
      topic: "buying_guide",
    },
    {
      text: `${brandName}와 같은 카테고리의 인기 브랜드 5가지 추천해줘`,
      language: "ko",
      category: "competitor",
      topic: "best_in_category",
    },
    {
      text: `${brandName} 경쟁사 대표 브랜드를 순위로 알려줘`,
      language: "ko",
      category: "competitor",
      topic: "comparison",
    },
    {
      text: `What is ${brandName}? Is it worth buying?`,
      language: "en",
      category: "brand",
      topic: "buying_guide",
    },
    {
      text: `Top 5 popular brands similar to ${brandName}`,
      language: "en",
      category: "competitor",
      topic: "alternative",
    },
  ];
  return { prompts, competitors: [] };
}

/**
 * 브랜드 등록 맥락 → 추적 프롬프트·경쟁사 후보 제안.
 *   추가 AI 호출은 1개(generateObject). confident=false거나 실패 시 정적 폴백.
 *   반환값은 "후보"일 뿐 — 저장·측정 반영은 호출부(서버 액션)의 승인 흐름이 결정한다.
 *
 * @param brandName 대표 브랜드명(resolveBrandIdentity의 brandName 권장).
 * @param domain    브랜드 도메인(업종 힌트).
 * @param language  주 사용 언어. "both"면 ko/en 모두, "ko"/"en"이면 그 언어 위주.
 */
export async function suggestTrackingPrompts(
  brandName: string,
  domain: string,
  language: "ko" | "en" | "both" = "both"
): Promise<PromptSuggestions> {
  try {
    const { object: out } = await generateObject({
      model: suggestModel(),
      schema: suggestionSchema,
      prompt: `브랜드 "${brandName}"(도메인: ${domain})를 AI 검색(ChatGPT·Perplexity·네이버 등)에서 추적하기 위한 질문 목록과 경쟁 브랜드를 제안해줘.
- 실제 소비자가 AI에게 물을 법한 자연스러운 문장으로.
- 브랜드형(브랜드 자체를 묻는 것)과 경쟁형(카테고리·순위·대안을 묻는 것) 두 유형을 균형 있게.
- **질문마다 topic 을 붙여줘.** 실제 의도에 맞는 것으로 — 다 recommendation 으로 몰지 말고
  카테고리 1위를 묻는 질문은 best_in_category, 대안 탐색은 alternative,
  고르는 기준을 묻는 질문은 buying_guide, 고민 해결은 problem_solving 처럼 갈라줘.
- 이 브랜드/업종을 실제로 알 때만 맥락 있는 제안을 하고, 도메인만 보고 추측한 거면 confident=false로 표시해.`,
    });

    const wantKo = language === "ko" || language === "both";
    const wantEn = language === "en" || language === "both";

    const brand = [
      ...(wantKo ? takeClean(out.brandPromptsKo, "ko", "brand") : []),
      ...(wantEn ? takeClean(out.brandPromptsEn, "en", "brand") : []),
    ];
    const competitor = [
      ...(wantKo ? takeClean(out.competitorPromptsKo, "ko", "competitor") : []),
      ...(wantEn ? takeClean(out.competitorPromptsEn, "en", "competitor") : []),
    ];

    const prompts = interleave(brand, competitor);
    // 비확신이거나 LLM이 사실상 빈손이면 정적 폴백으로 최소치 보장.
    if (!out.confident || prompts.length < 4) {
      return staticFallback(brandName);
    }

    return {
      prompts,
      competitors: dedupeCompetitors(out.competitors, brandName),
    };
  } catch (error) {
    log.warn("prompt.suggest.failed", {
      brandName,
      domain,
      error: String(error),
    });
    return staticFallback(brandName);
  }
}
