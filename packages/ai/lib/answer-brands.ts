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
