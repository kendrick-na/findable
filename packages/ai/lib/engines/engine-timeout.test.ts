import { afterEach, describe, expect, it, vi } from "vitest";

import type { EngineQuery, EngineResponse } from "./types";

const ok = (engineId: EngineQuery["engineId"]): EngineResponse => ({
  brandMentioned: true,
  citedSources: [],
  durationMs: 10,
  engineId,
  errorMessage: null,
  isStub: false,
  mentionListSize: null,
  mentionPosition: 1,
  rawResponse: "answer",
  sentiment: null,
  shareOfVoice: null,
});

const seenSignals: AbortSignal[] = [];
// Claude never answers on its own; it only stops when its signal is aborted,
// the same way the real adapters rethrow aborts.
const hangUntilAborted = (query: EngineQuery) =>
  new Promise<EngineResponse>((_, reject) => {
    if (query.signal) {
      seenSignals.push(query.signal);
    }
    query.signal?.addEventListener("abort", () => reject(query.signal?.reason));
  });

vi.mock("./global-adapters", () => ({
  chatgptAdapter: (query: EngineQuery) => Promise.resolve(ok(query.engineId)),
  claudeAdapter: (query: EngineQuery) => hangUntilAborted(query),
  geminiAdapter: (query: EngineQuery) => Promise.resolve(ok(query.engineId)),
  perplexityAdapter: (query: EngineQuery) =>
    Promise.resolve(ok(query.engineId)),
}));

const { ENGINE_CALL_TIMEOUT_MS, queryAllEngines } = await import("./index");

afterEach(() => {
  vi.useRealTimers();
  seenSignals.length = 0;
});

describe("per-engine call timeout", () => {
  it("caps every LLM engine at 60s and leaves search engines to their own limits", () => {
    expect(ENGINE_CALL_TIMEOUT_MS).toEqual({
      chatgpt: 60_000,
      claude: 60_000,
      gemini: 60_000,
      perplexity: 60_000,
    });
  });

  it("turns a hung engine into an ordinary failed response and keeps the others", async () => {
    vi.useFakeTimers();
    const pending = queryAllEngines({ prompt: "q", language: "ko" }, [
      "chatgpt",
      "claude",
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    const [chatgpt, claude] = await pending;

    expect(chatgpt?.errorMessage).toBeNull();
    expect(chatgpt?.brandMentioned).toBe(true);
    expect(claude).toMatchObject({
      engineId: "claude",
      brandMentioned: false,
      rawResponse: "",
      isStub: false,
      errorMessage: "Engine claude timed out after 60000ms",
      durationMs: 60_000,
    });
    // The adapter's own call is cancelled, not left running in the background.
    expect(seenSignals[0]?.aborted).toBe(true);
  });

  it("still follows the run deadline signal before the engine cap", async () => {
    const controller = new AbortController();
    const pending = queryAllEngines(
      { prompt: "q", language: "ko", signal: controller.signal },
      ["claude"]
    );
    controller.abort(
      new DOMException("Audit run deadline exceeded", "AbortError")
    );
    const [claude] = await pending;

    expect(claude?.errorMessage).toBe("Audit run deadline exceeded");
    expect(claude?.durationMs).toBe(0);
  });
});
