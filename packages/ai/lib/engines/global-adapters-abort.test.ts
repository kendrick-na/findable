import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeAdapter } from "./global-adapters";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("global engine abort propagation", () => {
  it("does not fall back from an aborted Claude web-search request", async () => {
    vi.stubEnv("LETSUR_API_KEY", "test-key");
    vi.stubEnv("FINDABLE_CLAUDE_WEB_SEARCH", "1");
    const controller = new AbortController();
    const abort = new DOMException("deadline", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));

    await expect(
      claudeAdapter({
        brandName: "Test",
        engineId: "claude",
        language: "en",
        prompt: "Test",
        signal: controller.signal,
      })
    ).rejects.toThrow("deadline");
  });
});
