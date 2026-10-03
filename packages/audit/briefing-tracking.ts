import type { EngineResponse } from "@repo/ai/lib/engines";
import type { TaggedEngineResponse } from "./tracking";

/** Preserve the chosen briefing prompt and its stable ordinal for Tracking CAS. */
export function toBriefingTaggedResponses(
  responses: EngineResponse[],
  adoptedPrompt: string,
  language: "ko" | "en"
): TaggedEngineResponse[] {
  return responses.map((response, promptIndex) => ({
    ...response,
    promptIndex,
    promptText: adoptedPrompt,
    promptLang: language,
  }));
}
