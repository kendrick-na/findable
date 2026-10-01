import { describe, expect, it, vi } from "vitest";
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

  it("각 질문의 0-based index를 순서대로 전달한다", async () => {
    const indexes: number[] = [];
    await queryPromptsSequentially(["a", "b"], (_prompt, index) => {
      indexes.push(index);
      return Promise.resolve(index);
    });
    expect(indexes).toEqual([0, 1]);
  });

  it("저장된 앞 질문을 재호출하지 않고 새 결과를 질문마다 저장한다", async () => {
    const queried: string[] = [];
    const saved: string[][] = [];
    const results = await queryPromptsSequentially(
      ["a", "b", "c"],
      (prompt) => {
        queried.push(prompt);
        return Promise.resolve(`${prompt}-done`);
      },
      {
        completed: ["a-done"],
        onCompleted: (all) => {
          saved.push([...all]);
          return Promise.resolve();
        },
      }
    );
    expect(queried).toEqual(["b", "c"]);
    expect(saved).toEqual([
      ["a-done", "b-done"],
      ["a-done", "b-done", "c-done"],
    ]);
    expect(results).toEqual(["a-done", "b-done", "c-done"]);
  });

  it("저장 실패 시 다음 유료 질문을 시작하지 않는다", async () => {
    const queried: string[] = [];
    await expect(
      queryPromptsSequentially(
        ["a", "b"],
        (prompt) => {
          queried.push(prompt);
          return Promise.resolve(prompt);
        },
        {
          onCompleted: () =>
            Promise.reject(new Error("checkpoint write failed")),
        }
      )
    ).rejects.toThrow("checkpoint write failed");
    expect(queried).toEqual(["a"]);
  });

  it("모든 질문이 저장돼 있으면 외부 엔진을 다시 호출하지 않는다", async () => {
    const query = vi.fn(() => Promise.resolve("unexpected"));
    const result = await queryPromptsSequentially(["a", "b"], query, {
      completed: ["a-done", "b-done"],
    });
    expect(query).not.toHaveBeenCalled();
    expect(result).toEqual(["a-done", "b-done"]);
  });

  it("중간 강제 종료 후 저장된 질문 다음부터 재개한다", async () => {
    let persisted: string[] = [];
    await expect(
      queryPromptsSequentially(
        ["a", "b", "c"],
        (prompt) =>
          prompt === "b"
            ? Promise.reject(new Error("simulated timeout"))
            : Promise.resolve(`${prompt}-done`),
        {
          onCompleted: (results) => {
            persisted = [...results];
            return Promise.resolve();
          },
        }
      )
    ).rejects.toThrow("simulated timeout");
    expect(persisted).toEqual(["a-done"]);

    const queried: string[] = [];
    const resumed = await queryPromptsSequentially(
      ["a", "b", "c"],
      (prompt) => {
        queried.push(prompt);
        return Promise.resolve(`${prompt}-done`);
      },
      { completed: persisted }
    );
    expect(queried).toEqual(["b", "c"]);
    expect(resumed).toEqual(["a-done", "b-done", "c-done"]);
  });
});
