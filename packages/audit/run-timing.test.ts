import { describe, expect, it, vi } from "vitest";
import { createRunTiming } from "./run-timing";

describe("createRunTiming", () => {
  it("records a start and finish with only structured identifiers and durations", () => {
    const info = vi.fn();
    let now = 100;
    const timing = createRunTiming("job-1", info, () => now);
    const finish = timing.start("engine_query", {
      promptIndex: 2,
      engineId: "gemini",
    });
    now = 145;
    finish("fulfilled");
    expect(info.mock.calls).toEqual([
      [
        "audit.run.stage",
        {
          jobId: "job-1",
          stage: "engine_query",
          phase: "started",
          elapsedMs: 0,
          promptIndex: 2,
          engineId: "gemini",
        },
      ],
      [
        "audit.run.stage",
        {
          jobId: "job-1",
          stage: "engine_query",
          phase: "finished",
          elapsedMs: 45,
          durationMs: 45,
          promptIndex: 2,
          engineId: "gemini",
          status: "fulfilled",
        },
      ],
    ]);
  });

  it("does not let logging failures change the audit", () => {
    const timing = createRunTiming(
      "job-1",
      () => {
        throw new Error("logger");
      },
      () => 0
    );
    expect(() => timing.start("db_commit")()).not.toThrow();
  });
});
