import { describe, expect, it } from "vitest";
import { countBrandAiRecognition } from "./brand-ai-recognition";

describe("brand AI recognition for AI-labelled claims", () => {
  it("excludes search, briefing, retired and discovery rows from both counts", () => {
    expect(
      countBrandAiRecognition([
        { engineId: "chatgpt", brandMentioned: false, promptKind: "brand" },
        { engineId: "naver", brandMentioned: true, promptKind: "brand" },
        { engineId: "daum", brandMentioned: true, promptKind: "brand" },
        { engineId: "naver-briefing", brandMentioned: true },
        { engineId: "hyperclova", brandMentioned: true },
        {
          engineId: "perplexity",
          brandMentioned: true,
          promptKind: "discovery",
        },
      ])
    ).toEqual({ measured: 1, mentioned: 0 });
  });

  it("counts only successful, confirmed brand responses, once per engine", () => {
    expect(
      countBrandAiRecognition([
        { engineId: "chatgpt", brandMentioned: true, promptKind: "brand" },
        { engineId: "chatgpt", brandMentioned: false, promptKind: "brand" },
        {
          engineId: "gemini",
          brandMentioned: true,
          mentionQuality: "different_entity",
        },
        { engineId: "perplexity", brandMentioned: true, isStub: true },
        { engineId: "claude", brandMentioned: true, errorMessage: "429" },
      ])
    ).toEqual({ measured: 2, mentioned: 1 });
  });
});
