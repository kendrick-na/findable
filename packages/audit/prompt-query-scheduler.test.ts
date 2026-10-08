import { describe, expect, it } from "vitest";
import { queryPromptsSequentially } from "./prompt-query-scheduler";

describe("queryPromptsSequentially", () => {
  it("같은 측정의 질문 묶음을 겹치지 않게 실행한다", async () => {
    let active = 0;
    let peak = 0;
    const started: string[] = [];

    const result = await queryPromptsSequentially(
      ["q1", "q2", "q3"],
      async (prompt) => {
        active += 1;
        peak = Math.max(peak, active);
        started.push(prompt);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return `${prompt}-done`;
      }
    );

    expect(peak).toBe(1);
    expect(started).toEqual(["q1", "q2", "q3"]);
    expect(result).toEqual(["q1-done", "q2-done", "q3-done"]);
  });

  it("does not rerun checkpointed questions and awaits persistence before the next one", async () => {
    const started: string[] = [];
    const indices: number[] = [];
    const snapshots: (readonly string[])[] = [];
    let releasePersistence: (() => void) | undefined;
    const persisted = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const run = queryPromptsSequentially(
      ["q1", "q2", "q3"],
      (prompt, absoluteIndex) => {
        started.push(prompt);
        indices.push(absoluteIndex);
        return Promise.resolve(`${prompt}-answer`);
      },
      {
        completed: ["q1-answer"],
        completedPlanKey: "plan-v1",
        onCompleted: async (all) => {
          snapshots.push(all);
          if (all.length === 2) {
            await persisted;
          }
        },
        planKey: "plan-v1",
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(["q2"]);
    expect(snapshots).toEqual([["q1-answer", "q2-answer"]]);
    releasePersistence?.();
    expect(await run).toEqual(["q1-answer", "q2-answer", "q3-answer"]);
    expect(started).toEqual(["q2", "q3"]);
    expect(indices).toEqual([1, 2]);
    expect(snapshots[0]).toEqual(["q1-answer", "q2-answer"]);
  });

  it("fails closed when a checkpoint is paired with a different question plan", async () => {
    const started: string[] = [];
    await expect(
      queryPromptsSequentially(
        ["changed-q1", "q2"],
        (prompt) => {
          started.push(prompt);
          return Promise.resolve(prompt);
        },
        {
          completed: ["old-q1-answer"],
          completedPlanKey: "old-plan",
          planKey: "new-plan",
        }
      )
    ).rejects.toThrow("Checkpoint prompt plan does not match current plan");
    expect(started).toEqual([]);
  });

  it("rejects a stop time without an explicit minimum question budget", async () => {
    await expect(
      queryPromptsSequentially(["q1"], async (prompt) => prompt, {
        stopStartingAtMs: Date.now() + 1,
      })
    ).rejects.toThrow("A question budget is required with a stop time");
  });

  it("stops paid work if checkpoint persistence fails", async () => {
    const started: string[] = [];
    await expect(
      queryPromptsSequentially(
        ["q1", "q2"],
        (prompt) => {
          started.push(prompt);
          return Promise.resolve(`${prompt}-answer`);
        },
        {
          onCompleted: () =>
            Promise.reject(new Error("checkpoint write failed")),
        }
      )
    ).rejects.toThrow("checkpoint write failed");
    expect(started).toEqual(["q1"]);
  });
});
