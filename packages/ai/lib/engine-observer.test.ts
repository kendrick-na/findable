import { describe, expect, it } from "vitest";
import { queryAllEngines } from "./engines";
import type { EngineId } from "./engines/types";

describe("queryAllEngines observation", () => {
  it("emits start and finish without changing allSettled output", async () => {
    const events: unknown[] = [];
    const responses = await queryAllEngines(
      { prompt: "test", language: "en", brandName: "Test" },
      ["unknown" as EngineId],
      (event) => events.push(event)
    );
    expect(responses).toHaveLength(1);
    expect(responses[0]?.errorMessage).toContain("Unknown engine");
    expect(events).toEqual([
      { engineId: "unknown", phase: "started" },
      { engineId: "unknown", phase: "finished", status: "fulfilled" },
    ]);
  });
});
