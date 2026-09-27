import { describe, expect, it } from "vitest";
import { summarizeAuditEngineFailures } from "./audit-engine-failures";

describe("summarizeAuditEngineFailures", () => {
  it("counts failed engine responses inside completed audit jobs", () => {
    expect(
      summarizeAuditEngineFailures([
        {
          result: {
            engineResponses: [
              { engineId: "perplexity", errorMessage: "quota exceeded" },
              { engineId: "perplexity", errorMessage: "quota exceeded" },
              { engineId: "claude", errorMessage: null },
            ],
          },
        },
      ])
    ).toEqual([{ engineId: "perplexity", attempts: 2, failures: 2 }]);
  });

  it("ignores malformed results and counts stubs as unavailable", () => {
    expect(
      summarizeAuditEngineFailures([
        { result: null },
        { result: { engineResponses: "bad" } },
        { result: { engineResponses: [{ engineId: "gemini", isStub: true }] } },
      ])
    ).toEqual([{ engineId: "gemini", attempts: 1, failures: 1 }]);
  });
});
