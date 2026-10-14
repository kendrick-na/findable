"use server";

import { extractListedBrands } from "@repo/ai/lib/answer-brands";
import { queryEngine } from "@repo/ai/lib/engines";
import { parseKnownCompetitors } from "@repo/audit/competitor-extract";
import {
  isQuestionPrerunEnabled,
  PRERUN_ENGINE,
  PRERUN_MAX_QUESTIONS,
  type PrerunSignal,
  prerunQuestions,
} from "@repo/audit/question-prerun";
import { log } from "@repo/observability/log";
import { requireOrg, scopedBrandById } from "@/lib/db/scoped";
import { getAppDictionary } from "@/lib/i18n";

/**
 * 질문 미리 돌려 보기(2026-10-14 · 대표 승인) — 고른 질문을 엔진 1곳에 1번씩 돌려 브랜드가 나열되는지 보여 준다.
 * 저장·점수 반영 없음. 기본 off(`QUESTION_PRERUN_ENABLED`), Preview 에서는 실행하지 않는다.
 * 🔒 org 는 세션에서 정하고 브랜드 소유를 확인한다. 질문은 3~200자, 최대 20개로 서버가 다시 거른다.
 */
export type PrerunResult =
  | { ok: true; signals: PrerunSignal[] }
  | { error: string };

const MIN_LEN = 3;
const MAX_LEN = 200;

export const prerunQuestionsAction = async (input: {
  brandId: string;
  questions: string[];
}): Promise<PrerunResult> => {
  const errors = (await getAppDictionary()).brandErrors;
  try {
    await requireOrg();
  } catch {
    return { error: errors.signInOrg };
  }
  if (!isQuestionPrerunEnabled()) {
    return { error: errors.prerunDisabled };
  }
  const brand = await scopedBrandById(input.brandId);
  if (!brand) {
    return { error: errors.brandNotFound };
  }
  const questions = [
    ...new Set(
      (Array.isArray(input.questions) ? input.questions : [])
        .filter((q): q is string => typeof q === "string")
        .map((q) => q.trim())
        .filter((q) => q.length >= MIN_LEN && q.length <= MAX_LEN)
    ),
  ].slice(0, PRERUN_MAX_QUESTIONS);
  if (questions.length === 0) {
    return { ok: true, signals: [] };
  }
  const variants = Array.isArray(brand.entityVariants)
    ? brand.entityVariants.filter((v): v is string => typeof v === "string")
    : [];
  try {
    const signals = await prerunQuestions(
      questions,
      {
        name: brand.name,
        variants,
        competitors: parseKnownCompetitors(brand.competitors),
      },
      async ({ language, prompt, signal }) => {
        const res = await queryEngine({
          engineId: PRERUN_ENGINE,
          language,
          prompt,
          brandName: brand.name,
          brandVariants: variants,
          brandDomain: brand.domain,
          signal,
        });
        return {
          errorMessage: res.errorMessage,
          isStub: res.isStub,
          rawResponse: res.rawResponse,
        };
      },
      extractListedBrands
    );
    return { ok: true, signals };
  } catch (error) {
    log.warn("brand.prerun_questions.failed", {
      brandId: brand.id,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { error: errors.prerunFailed };
  }
};
