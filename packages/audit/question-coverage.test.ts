import { describe, expect, it } from "vitest";
import { MENTION_VERDICT_VERSION } from "../ai/lib/mention-verdict-version";
import {
  auditPublicationIssue,
  auditPublicationStatus,
  withRecomputedAuditMetrics,
} from "./normalize-stored-metrics";
import { questionCoverage } from "./question-coverage";

describe("questionCoverage", () => {
  it("counts distinct plan indexes even when question text is duplicated", () => {
    const result = questionCoverage({
      promptsCount: 2,
      engineResponses: [
        {
          promptIndex: 0,
          promptText: "same",
          engineId: "chatgpt",
          errorMessage: null,
        },
        {
          promptIndex: 1,
          promptText: "same",
          engineId: "claude",
          errorMessage: null,
        },
      ],
    });
    expect(result?.brand).toEqual({
      attempted: 2,
      planned: 2,
      withSuccessfulAiAnswer: 2,
    });
  });

  it("does not turn search or failed AI calls into completed questions", () => {
    const result = questionCoverage({
      promptsCount: 3,
      measurementContext: { discoveryPromptCount: 1 },
      engineResponses: [
        { promptIndex: 0, engineId: "chatgpt", errorMessage: null },
        { promptIndex: 1, engineId: "naver", errorMessage: null },
        { promptIndex: 1, engineId: "gemini", errorMessage: "ENGINE_TIMEOUT" },
        {
          promptIndex: 2,
          promptKind: "discovery",
          engineId: "claude",
          errorMessage: null,
        },
      ],
    });
    expect(result).toEqual({
      brand: { attempted: 2, planned: 2, withSuccessfulAiAnswer: 1 },
      discovery: { attempted: 1, planned: 1, withSuccessfulAiAnswer: 1 },
    });
  });

  it("ignores on-demand briefing rows without a planned question identity", () => {
    const result = questionCoverage({
      promptsCount: 2,
      engineResponses: [
        { promptIndex: 0, engineId: "chatgpt", errorMessage: null },
        { promptIndex: 1, engineId: "gemini", errorMessage: "ENGINE_TIMEOUT" },
        { engineId: "naver-briefing", errorMessage: null },
      ],
    });
    expect(result?.brand).toEqual({
      attempted: 2,
      planned: 2,
      withSuccessfulAiAnswer: 1,
    });
  });

  it("keeps an incomplete brand run provisional even after an unplanned briefing row is appended", () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      promptIndex: index < 5 ? 0 : 1,
      promptText: index < 5 ? "q1" : "q2",
      promptKind: "brand",
      engineId: ["chatgpt", "claude", "gemini", "perplexity"][index % 4],
      brandMentioned: false,
      mentionQuality: "absent",
      errorMessage: null,
      isStub: false,
    }));
    const result = withRecomputedAuditMetrics({
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      promptsCount: 4,
      measurementContext: { discoveryPromptCount: 0 },
      metrics: { sov: 0 },
      engineResponses: [
        ...rows,
        { engineId: "naver-briefing", errorMessage: null, isStub: false },
      ],
    });
    expect(auditPublicationIssue(result)).toBe("incomplete_execution");
    expect(auditPublicationStatus(result)).toBe("provisional");
  });

  it("withholds plan-bearing runs when core question identity is missing", () => {
    const result = withRecomputedAuditMetrics({
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      promptsCount: 4,
      metrics: { sov: 0 },
      engineResponses: Array.from({ length: 10 }, () => ({
        engineId: "chatgpt",
        brandMentioned: false,
        mentionQuality: "absent",
        errorMessage: null,
        isStub: false,
      })),
    });
    expect(auditPublicationIssue(result)).toBe("question_plan_unverified");
    expect(auditPublicationStatus(result)).toBe("provisional");
  });
});
