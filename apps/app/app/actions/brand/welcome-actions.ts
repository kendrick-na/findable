"use server";

import type { SuggestedPrompt } from "@repo/ai/lib/prompt-suggestions";
import { loadBrandSetupReadiness } from "@repo/audit/brand-setup";
import { requireOrg, scopedBrandById } from "@/lib/db/scoped";
import { startOrgTracking } from "./start-tracking";
import {
  saveApprovedPromptsAction,
  suggestPromptsAction,
} from "./suggest-prompts";

/**
 * 온보딩(`/welcome`)이 쓰는 서버 동작 묶음(2026-10-13).
 *
 * 뷰(`WelcomeFlow`)는 서버액션을 직접 import 하지 않고(Storybook 주입 패턴) 이 모양으로 주입받는다.
 * 여기는 **얇은 접착층**이다 — 질문 제안·저장·측정 시작은 기존 액션을 그대로 부른다
 * (재측정 정책·플랜 상한·org 스코프 검증을 복제하지 않는다).
 */

/** 지금 설정에서 비어 있는 항목 코드(필수+권장). 준비도 규칙(`@repo/audit/setup-readiness`) 한 곳으로 판정한다. */
export const checkBrandSetup = async (
  brandId: string
): Promise<{ missing: string[] } | null> => {
  try {
    await requireOrg();
  } catch {
    return null;
  }
  // 🔒 현재 org 소속 브랜드만 읽는다.
  if (!(await scopedBrandById(brandId))) {
    return null;
  }
  const loaded = await loadBrandSetupReadiness(brandId);
  if (!loaded) {
    return null;
  }
  return {
    missing: [
      ...loaded.readiness.missingRequired,
      ...loaded.readiness.missingRecommended,
    ],
  };
};

export const saveWelcomeQuestions = async (input: {
  brandId: string;
  prompts: SuggestedPrompt[];
}): Promise<
  | { code?: "prompt_limit"; error: string; limit?: number }
  | {
      capped?: boolean;
      limit?: number;
      ok: true;
      requested?: number;
      saved: number;
    }
> => {
  const result = await saveApprovedPromptsAction(input);
  // 한도 정보(capped·requested·limit·code)를 **버리지 않고** 화면까지 전달한다 —
  //   예전엔 {ok, saved} 만 돌려줘서 일부만 저장돼도 화면이 모르는 채 다음 단계로 넘어갔다(2026-10-14).
  return result;
};

export const suggestWelcomeQuestions = async (
  brandId: string,
  siteNote?: string
): Promise<
  | { error: string }
  | {
      ok: true;
      prompts: SuggestedPrompt[];
      remaining: number;
      siteThin?: boolean;
    }
> => {
  const result = await suggestPromptsAction({ brandId, siteNote });
  return "error" in result
    ? { error: result.error }
    : {
        ok: true,
        prompts: result.suggestions.prompts,
        remaining: result.remaining,
        ...(result.siteThin ? { siteThin: true } : {}),
      };
};

export const startWelcomeMeasurement = async (input: {
  brandName: string;
  domain: string;
  skippedSetup: boolean;
}): Promise<{ code?: string; error: string } | { jobId: string; ok: true }> => {
  const result = await startOrgTracking({
    brandName: input.brandName,
    domain: input.domain,
    skippedSetup: input.skippedSetup,
  });
  if ("error" in result) {
    return { code: result.code, error: result.error };
  }
  return { jobId: result.jobId, ok: true };
};
