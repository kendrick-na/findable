import { describe, expect, it } from "vitest";
import { verifyMentions } from "./mention-verdict";

describe("verifyMentions observation", () => {
  it("reports each six-response chunk without changing results", async () => {
    const events: unknown[] = [];
    const responses = Array.from({ length: 7 }, () => ({
      brandMentioned: false,
      errorMessage: "adapter failed",
      rawResponse: "",
    }));
    const result = await verifyMentions(
      responses,
      { brandName: "Test" },
      (event) => events.push(event)
    );
    expect(result).toHaveLength(7);
    expect(events).toEqual([
      { chunkIndex: 0, responseCount: 6, phase: "started" },
      { chunkIndex: 0, responseCount: 6, phase: "finished" },
      { chunkIndex: 1, responseCount: 1, phase: "started" },
      { chunkIndex: 1, responseCount: 1, phase: "finished" },
    ]);
  });
});
