import { describe, expect, it, vi } from "vitest";

// questionLanguagesOf 가 ko·en·섞임이 아닌 값을 낼 때(저장 기록 이상)를 고정한다.
// 「언어를 모름」은 mixed 가 아니라 unknown 이고, 어떤 코호트에도 합치지 않는다.
vi.mock("./search-sampling-version", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./search-sampling-version")>();
  return { ...actual, questionLanguagesOf: () => "zz" };
});

import { aggregateRepeats } from "./repeat-aggregate";

describe("aggregateRepeats 언어 unknown", () => {
  it("언어를 알 수 없는 회차는 코호트에 넣지 않고 not_recorded 로 따로 표기", () => {
    const result = aggregateRepeats(
      [
        {
          completed_at: "2026-10-21T01:00:00Z",
          job_id: "u1",
          result: { engineResponses: [] },
        },
      ],
      {
        is_publishable: () => true,
        min_repeats: 1,
        suppression_threshold: null,
      }
    );
    expect(result.cohorts).toHaveLength(0);
    expect(result.excluded_runs[0]).toMatchObject({
      job_id: "u1",
      reason: "not_recorded",
    });
  });
});
