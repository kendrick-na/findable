import "server-only";

import { suggestCompetitors } from "@repo/ai/lib/competitor-suggest";
import {
  type ContentDraftInput,
  fallbackDraft,
  type GeneratedContentDraft,
  generateContentDraft,
} from "@repo/ai/lib/content-draft";
import { isVercelPreview } from "@repo/audit/preview-guard";

// Vercel Preview paid-AI guards for apps/app call sites that are not inside
// the stubbed audit runner (2026-10-05). On Preview each returns a
// deterministic local value and makes no provider call; everywhere else it
// delegates unchanged.

/** Onboarding competitor candidates. Preview → no candidates (no LLM). */
export function suggestCompetitorsUnlessPreview(
  input: Parameters<typeof suggestCompetitors>[0]
): Promise<string[]> {
  if (isVercelPreview()) {
    return Promise.resolve([]);
  }
  return suggestCompetitors(input);
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
