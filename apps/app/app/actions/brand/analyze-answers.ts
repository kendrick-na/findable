"use server";

import { extractListedBrands } from "@repo/ai/lib/answer-brands";
import { isPaid } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { log } from "@repo/observability/log";
import { revalidatePath } from "next/cache";
import {
  requireOrg,
  scopedBrandById,
  scopedLatestCompletedAudit,
} from "@/lib/db/scoped";
import {
  extractMissing,
  loadAnswerBrands,
  saveAnswerBrands,
} from "@/lib/gap/answer-brand-store";
import { answerRowsOf } from "@/lib/gap/gap-analysis";
import { getAppDictionary } from "@/lib/i18n";

/**
 * 경쟁사 빈틈 분석 실행(2026-10-15) — 최근 측정의 AI 답변에서 브랜드 이름을 뽑아 캐시에 저장한다.
 * 점수·측정 결과는 바꾸지 않는다. 유료(Growth 이상) 전용, 브랜드는 세션 org 소유만.
 * 한 번에 최대 60개 답변까지(원가 상한), 못 한 답변은 다음 실행에서 이어서 한다.
 */
export type AnalyzeAnswersResult =
  | { done: boolean; extracted: number; ok: true; remaining: number }
  | { error: string };

export const analyzeAnswersAction = async (input: {
  brandId: string;
}): Promise<AnalyzeAnswersResult> => {
  const errors = (await getAppDictionary()).brandErrors;
  try {
    await requireOrg();
  } catch {
    return { error: errors.signInOrg };
  }
  if (!isPaid(await getCurrentPlan())) {
    return { error: errors.gapPaidOnly };
  }
  const brand = await scopedBrandById(input.brandId);
  if (!brand) {
    return { error: errors.brandNotFound };
  }
  try {
    const latest = await scopedLatestCompletedAudit(brand.id);
    if (!latest) {
      return { error: errors.gapNoRun };
    }
    const rows = answerRowsOf(latest.result);
    const existing = await loadAnswerBrands(latest.id);
    if (!existing) {
      return { error: errors.gapNotReady };
    }
    const fresh = await extractMissing(rows, existing, extractListedBrands);
    const saved = await saveAnswerBrands(latest.id, fresh);
    if (!saved) {
      return { error: errors.gapNotReady };
    }
    revalidatePath("/compare");
    const remaining = Math.max(0, rows.length - existing.size - fresh.length);
    return {
      ok: true,
      extracted: fresh.length,
      remaining,
      done: remaining === 0,
    };
  } catch (error) {
    log.warn("brand.analyze_answers.failed", {
      brandId: brand.id,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { error: errors.gapFailed };
  }
};
