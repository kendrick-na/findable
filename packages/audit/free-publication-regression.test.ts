import { describe, expect, it } from "vitest";
import { MENTION_VERDICT_VERSION } from "../ai/lib/mention-verdict-version";
import type { AnswerBucketSummary } from "./answer-buckets";
import { generateAuditPrompts } from "./audit-prompts";
import {
  auditPublicationStatus,
  isPublishableAuditResult,
  withRecomputedAuditMetrics,
} from "./normalize-stored-metrics";

const names = { ko: "샘플", en: "Sample" };
const aiEngines = ["chatgpt", "claude", "perplexity", "gemini"];
const searchEngines = ["naver", "daum"];
const seedMetrics = () => ({
  sov: 0,
  verifiedCount: 0,
  answerBuckets: undefined as AnswerBucketSummary | undefined,
});

function success(engineId: string, promptText: string, promptKind: string) {
  return {
    engineId,
    promptText,
    promptKind,
    rawResponse: "synthetic answer",
    brandMentioned: false,
    mentionQuality: "absent",
    errorMessage: null,
    isStub: false,
  };
}

describe("free completion and saved-prompt publication regression", () => {
  for (const language of ["ko", "en", "both"] as const) {
    it(`keeps a fully answered free ${language} run published with four brand questions`, () => {
      // runner.resolveBrandPrompts(!brandId) calls generateAuditPrompts and
      // runner tags each fallback prompt with kind ?? "brand".
      const prompts = generateAuditPrompts(names, language);
      expect(prompts).toHaveLength(4);
      for (const prompt of prompts) {
        expect(prompt.text).toContain(
          prompt.lang === "ko" ? names.ko : names.en
        );
      }
      const rows = prompts.flatMap((prompt) => [
        ...aiEngines.map((engine) => success(engine, prompt.text, "brand")),
        ...(prompt.lang === "ko"
          ? searchEngines.map((engine) => success(engine, prompt.text, "brand"))
          : []),
      ]);
      const result = withRecomputedAuditMetrics({
        mentionVerdictVersion: MENTION_VERDICT_VERSION,
        metrics: seedMetrics(),
        promptsCount: prompts.length,
        engineResponses: rows,
      });

      // Previous mixed-counter gate: verifiedCount >= 10. The new gate must
      // retain the same published status for a fully answered free run.
      expect(result.metrics.verifiedCount).toBeGreaterThanOrEqual(10);
      expect(result.metrics.answerBuckets?.ai.adjudicated).toBe(16);
      expect(auditPublicationStatus(result)).toBe("published");
      expect(isPublishableAuditResult(result)).toBe(true);
    });
  }

  it("records a real saved-question composition that changes from mixed published to AI provisional", () => {
    const rows = ["brand-1", "brand-2"].flatMap((prompt) => [
      ...aiEngines.map((engine) => success(engine, prompt, "brand")),
      ...searchEngines.map((engine) => success(engine, prompt, "brand")),
    ]);
    const result = withRecomputedAuditMetrics({
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: seedMetrics(),
      promptsCount: 7,
      engineResponses: rows,
    });

    expect(result.metrics.verifiedCount).toBe(12); // old mixed gate: published
    expect(result.metrics.answerBuckets?.ai.adjudicated).toBe(8);
    expect(result.metrics.answerBuckets?.search?.adjudicated).toBe(4);
    expect(auditPublicationStatus(result)).toBe("provisional");
  });
});
