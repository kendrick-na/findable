// AI 답변에서 "나열된 브랜드 이름" 뽑기 (2026-10-15)
//
// 왜: 답변 속 브랜드가 번호 목록이 아니라 표·글머리표·문장으로 나열되는 경우가 많다(운영 실측: Gemini·ChatGPT 답변은 표나 문장형이 흔함).
//   번호 목록만 파싱하는 `extractCompetitorLandscape` 로는 "브랜드가 안 나와요"로 잘못 읽혔다. 이 함수는 모델에게 이름만 뽑게 하되,
//   **답변 본문에 실제로 있는 이름만** 남기는 검증을 코드가 한다(모델이 지어내지 못하게).
// 원가: 짧은 입력(답변 4천 자 이내) + 이름 배열 출력의 Haiku 호출 1번.

import { log } from "@repo/observability/log";
import { generateObject } from "ai";
import { z } from "zod";
import { findEngineName } from "./engine-names";
import {
  HELPER_GATEWAY_MODEL_ID,
  letsurModelWithFallback,
} from "./letsur-fallback";
import { models } from "./models";

const MODEL_ID =
  process.env.FINDABLE_CREW_LETSUR_MODEL ?? "claude-haiku-4-5-20251001";
const MAX_ANSWER_CHARS = 4000;
const MAX_BRANDS = 15;
const NON_IDENTITY_RE = /[^a-z0-9가-힣]/g;

const schema = z.object({
  brands: z
    .array(z.string())
    .describe(
      "답변이 추천·비교·예시로 든 서로 다른 회사·브랜드·서비스·제품 이름. 일반 명사·분류명·설명은 제외."
    )
    .default([]),
});

function model() {
  return (
    letsurModelWithFallback(MODEL_ID, {
      callSite: "answer-brands",
      gatewayModelId: HELPER_GATEWAY_MODEL_ID,
    }) ?? models.chat
  );
}

const key = (value: string) => value.toLowerCase().replace(NON_IDENTITY_RE, "");

/** 모델이 준 이름 중 답변 본문에 실제로 있는 것만, 중복 없이 남긴다(순수 함수). */
export function keepNamesPresentInAnswer(
  names: readonly string[],
  answer: string
): string[] {
  const body = key(answer);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const k = key(name);
    // AI 서비스 이름(ChatGPT·Gemini 등)은 "나열된 브랜드"로 세지 않는다 — AI 검색 주제의 답변에서 예시로 자주 등장하는 잡음이다.
    if (
      k.length < 2 ||
      seen.has(k) ||
      !body.includes(k) ||
      findEngineName(name)
    ) {
      continue;
    }
    seen.add(k);
    out.push(name);
  }
  return out.slice(0, MAX_BRANDS);
}

/** 답변에서 나열된 브랜드 이름을 뽑는다. 호출 실패면 null(판단할 수 없다 — 0개로 단정하지 않는다). */
export async function extractListedBrands(
  answer: string
): Promise<string[] | null> {
  const text = answer.slice(0, MAX_ANSWER_CHARS);
  if (text.trim().length === 0) {
    return [];
  }
  try {
    const { object } = await generateObject({
      model: model(),
      schema,
      prompt: `다음은 AI가 어떤 질문에 한 답변이야. 이 답변이 추천·비교·예시로 직접 든 **서로 다른 회사·브랜드·서비스·제품 이름**만 뽑아줘(표·목록·문장 어디에 있든).
- 일반 명사, 분류명(예: '보습 크림', '간편결제 앱'), 성분명, 설명 문구는 넣지 마.
- 답변에 적힌 이름만, 적힌 그대로. 답변에 없는 이름을 만들지 마. 최대 ${MAX_BRANDS}개. 하나도 없으면 빈 배열.

[답변]
${text}`,
    });
    return keepNamesPresentInAnswer(object.brands, text);
  } catch (error) {
    log.warn("answer_brands.failed", { error: String(error) });
    return null;
  }
}

// ── 경쟁사 후보 추출 (2026-10-15 · 경쟁사 시스템 점검) ────────────────────────────────
// 일반 '나열된 브랜드' 추출과 다른 점: ① 자사(다른 언어 표기 포함)를 빼고 ② 같은 회사의 하위 브랜드·제품 라인은 한 곳으로 합치고
// ③ 같은 서비스 분야가 아닌 인접 업종(배달앱·결제 대행 등)을 빼고 ④ 지정한 시장의 경쟁사를 우선한다.
// 운영 점검(12 사례)에서 나온 오류: 당근 → 'Karrot'(자사 영문명) 포함, SK AX → Accenture 4개(하위 브랜드), 토스 → KB스타뱅킹·배달의민족.

const candidateSchema = z.object({
  competitors: z
    .array(z.string())
    .describe(
      "자사와 같은 서비스 분야에서 직접 경쟁하는 회사·브랜드 이름(회사 단위, 하위 브랜드는 대표 이름 하나로)."
    )
    .default([]),
});

export interface CompetitorExtractContext {
  /** 서비스 분야 한 줄. */
  category: string;
  /** 지정한 시장(예: '한국'). 없으면 시장 우선 규칙을 쓰지 않는다. */
  market?: string | null;
  /** 자사 이름·별칭·도메인 줄기 — 어떤 언어 표기든 후보에서 뺀다. */
  ownNames: readonly string[];
}

export async function extractCompetitorCandidates(
  answer: string,
  ctx: CompetitorExtractContext
): Promise<string[] | null> {
  const text = answer.slice(0, MAX_ANSWER_CHARS);
  if (text.trim().length === 0) {
    return [];
  }
  try {
    const { object } = await generateObject({
      model: model(),
      schema: candidateSchema,
      prompt: `다음은 '${ctx.category}' 분야의 유명한 서비스를 묻는 질문에 AI가 한 답변이야. 이 중 **자사의 직접 경쟁사 후보**만 뽑아줘.
자사 이름: ${ctx.ownNames.join(", ")}
${ctx.market ? `- 대상 시장은 ${ctx.market}이야. 같은 시장에서 활동하는 회사를 우선하고, 해외 회사는 그 시장에서도 실제 경쟁하는 경우만 넣어.\n` : ""}- **자사는 어떤 언어·표기든 넣지 마**(영문명·약칭 포함).
- 같은 회사의 하위 브랜드·제품 라인·지사는 **대표 이름 하나로만**(예: 'Accenture Song' → 'Accenture').
- '${ctx.category}'와 같은 서비스를 파는 회사만. 배달·결제·광고 같은 **인접 업종, 매체, 마켓플레이스, AI 서비스(ChatGPT 등)는 넣지 마.**
- 답변에 적힌 이름만, 적힌 그대로. 최대 8개. 없으면 빈 배열.

[답변]
${text}`,
    });
    return keepNamesPresentInAnswer(object.competitors, text);
  } catch (error) {
    log.warn("competitor_candidates.failed", { error: String(error) });
    return null;
  }
}
