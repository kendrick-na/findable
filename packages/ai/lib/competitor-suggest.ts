// 경쟁사 추천 — 도메인·업종 → LLM 추론 (2026-08-21, 온보딩 §4)
//
// 배경(👤 결정): "자동으로 채워지고, 수정하거나 선택할 수 있게" — 단 Otterly 의 실패
//   (AI 가 자동으로 다 채워서 오분류된 경쟁사가 그대로 측정에 들어간 사고)를 반면교사로,
//   이 함수는 **후보만 만든다**. 화면에 기본 선택할지·수정 가능하게 둘지는 UI 몫이다.
//
// 왜 LLM 인가(크롤링·기존데이터 재활용이 아니라): `competitor-extract.ts` 의
//   `extractCompetitorLandscape` 는 이미 저장된 AI 답변을 재파싱해 원가 0 으로 경쟁
//   지형을 뽑는다 — 하지만 그건 **측정을 한 번 돌린 뒤**에만 쓸 수 있는 데이터다.
//   온보딩 4단계는 측정 **전** 단계라 그 재료가 아직 없다. 경쟁사(Scrunch, f021 실측
//   `docs/_경쟁사_UIUX/전체화면플로우지도_2026-08-21.md`)도 같은 이유로 온보딩에서는
//   그 자리에서 즉시 LLM 호출로 추천한다 — Findable도 같은 방식이 맞다.
//
// `brand-identity.ts` 의 4층 체인과 같은 패턴(Letsur haiku · generateObject+zod ·
//   confident 게이트로 환각 방지)을 재사용한다. 새 모델 라우팅을 만들지 않는다.

import { createOpenAI } from "@ai-sdk/openai";
import { log } from "@repo/observability/log";
import { generateObject } from "ai";
import { z } from "zod";
import { models } from "./models";

const LETSUR_COMPETITOR_MODEL_ID =
  process.env.FINDABLE_CREW_LETSUR_MODEL ?? "claude-haiku-4-5-20251001";

function competitorSuggestModel() {
  const letsurKey = process.env.LETSUR_API_KEY;
  if (letsurKey) {
    const letsur = createOpenAI({
      baseURL: "https://gw.letsur.ai/v1",
      apiKey: letsurKey,
    });
    return letsur(LETSUR_COMPETITOR_MODEL_ID);
  }
  return models.chat;
}

const suggestSchema = z.object({
  competitors: z
    .array(z.string())
    .describe(
      "실제로 아는 경쟁사 브랜드명 3~5개(한국어 우선). 모르면 빈 배열."
    )
    .default([]),
  confident: z
    .boolean()
    .describe(
      "이 브랜드의 업종·시장을 실제로 아는 경우에만 true. 추측이면 false."
    ),
});

const PROTOCOL_RE = /^https?:\/\//;
const WWW_RE = /^www\./;

function normalizeHost(domain: string): string {
  return (
    domain.replace(PROTOCOL_RE, "").replace(WWW_RE, "").split("/")[0] ?? domain
  ).toLowerCase();
}

/**
 * 도메인·브랜드명·업종으로 경쟁사 후보를 추천한다.
 *
 * ⚠️ **후보만 반환한다 — 담긴 상태가 아니다.** 화면이 기본 선택 여부를 결정한다.
 *   (전자상거래법 "특정옵션 사전선택" 회피 원칙 — 재설계안 §7-D-4 와 같은 결.)
 * ⚠️ `confident=false` 거나 호출 실패 시 빈 배열 — 모르는데 지어내지 않는다.
 */
export async function suggestCompetitors(input: {
  brandName: string;
  domain: string;
  industry?: string | null;
}): Promise<string[]> {
  try {
    const host = normalizeHost(input.domain);
    const industryHint = input.industry
      ? ` 업종은 ${input.industry}로 분류돼 있어.`
      : "";
    const { object: out } = await generateObject({
      model: competitorSuggestModel(),
      schema: suggestSchema,
      prompt:
        `"${input.brandName}"(${host})의 실제 주요 경쟁사 브랜드를 3~5개 알려줘.${industryHint} ` +
        "실제로 아는 시장일 때만 답하고, 모르면 confident=false로 표시해. " +
        "브랜드명만 답해(설명·URL 없이).",
    });
    if (!out.confident) {
      return [];
    }
    return out.competitors.map((c: string) => c.trim()).filter(Boolean);
  } catch (error) {
    log.warn("competitor.suggest.failed", {
      domain: input.domain,
      error: String(error),
    });
    return [];
  }
}
