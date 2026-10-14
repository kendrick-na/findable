import "server-only";

import {
  suggestCompetitors,
  suggestCompetitorsGrounded,
} from "@repo/ai/lib/competitor-suggest";
import {
  type ContentDraftInput,
  fallbackDraft,
  type GeneratedContentDraft,
  generateContentDraft,
} from "@repo/ai/lib/content-draft";
import { isVercelPreview } from "@repo/audit/preview-guard";
import { readSiteProfile } from "@repo/audit/site-profile";

// Vercel Preview paid-AI guards for apps/app call sites that are not inside
// the stubbed audit runner (2026-10-05). On Preview each returns a
// deterministic local value and makes no provider call; everywhere else it
// delegates unchanged.

/** 모델 기억만으로 이만큼 나오면 충분하다고 본다(그 아래면 웹 검색으로 근거를 보강한다). */
const ENOUGH_FROM_MEMORY = 3;

/**
 * Onboarding competitor candidates. Preview → no candidates (no LLM).
 * 1) 모델 기억(싼 호출) → 2) 3곳 미만이면 사이트를 읽어 서비스 분야를 정하고 웹 검색 엔진으로 실제 경쟁사를 찾는다
 *    (2026-10-15: 신생 카테고리는 기억만으로는 항상 0곳이었다). 후보일 뿐 — 저장은 사람이 고른 것만.
 */
export async function suggestCompetitorsUnlessPreview(
  input: Parameters<typeof suggestCompetitors>[0] & {
    marketScope?: string | null;
  }
): Promise<string[]> {
  if (isVercelPreview()) {
    return [];
  }
  const fromMemory = await suggestCompetitors(input);
  if (fromMemory.length >= ENOUGH_FROM_MEMORY) {
    return fromMemory;
  }
  const site = await readSiteProfile(input.domain);
  if (!site) {
    return fromMemory;
  }
  const grounded = await suggestCompetitorsGrounded({ ...input, site });
  const seen = new Set(fromMemory.map((n) => n.toLowerCase()));
  return [
    ...fromMemory,
    ...grounded.filter((n) => !seen.has(n.toLowerCase())),
  ].slice(0, 6);
}

/** Content draft. Preview → the existing deterministic evidence template. */
export function generateContentDraftUnlessPreview(
  input: ContentDraftInput
): Promise<GeneratedContentDraft> {
  if (isVercelPreview()) {
    return Promise.resolve(fallbackDraft(input));
  }
  return generateContentDraft(input);
}
