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
});
