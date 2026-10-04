/** @vitest-environment node */

import { describe, expect, it } from "vitest";

// These are persisted AuditJob.result shapes produced by the current runner
// and briefing runner. No provider, database, or runner implementation is
// mocked here; this test only checks what a later replay worker can recover
// from the stored snapshot.
interface StoredResponse {
  engineId: string;
  promptIndex?: number;
  promptText?: string;
}

function coreKey(row: StoredResponse): string | null {
  if (row.promptIndex === undefined) {
    return null;
  }
  return `core|${row.promptIndex}|${row.engineId}`;
}

function briefingKeys(
  jobId: string,
  result: { briefingPrompt?: string; engineResponses: StoredResponse[] }
): string[] {
  const rows = result.engineResponses.filter(
    (candidate) => candidate.engineId === "naver-briefing"
  );
  if (rows.length === 0 || !result.briefingPrompt) {
    return [];
  }
  return rows.map(
    (row, ordinal) => `${jobId}|briefing|${ordinal}|${row.engineId}`
  );
}

describe("reconstructing a Tracking row key from persisted AuditJob.result", () => {
  it("reconstructs distinct core prompt indexes when the runner saved them", () => {
    const result = {
      engineResponses: [
        { engineId: "chatgpt", promptText: "같은 질문", promptIndex: 0 },
        { engineId: "chatgpt", promptText: "같은 질문", promptIndex: 1 },
      ],
    };

    const keys = result.engineResponses.map(coreKey);

    expect(keys).toEqual(["core|0|chatgpt", "core|1|chatgpt"]);
    expect(new Set(keys).size).toBe(2);
  });

  it("reconstructs a briefing ordinal but cannot distinguish replay from a legitimate rerun", () => {
    const firstCommit = {
      briefingPrompt: "브랜드 효과",
      engineResponses: [
        { engineId: "chatgpt", promptIndex: 0, promptText: "core" },
        { engineId: "naver-briefing", promptText: "브랜드 효과" },
        { engineId: "naver-briefing", promptText: "브랜드 효과" },
      ],
    };
    const changedCommit = {
      briefingPrompt: "브랜드 후기",
      engineResponses: [
        { engineId: "chatgpt", promptIndex: 0, promptText: "core" },
        { engineId: "naver-briefing", promptText: "브랜드 후기" },
        { engineId: "naver-briefing", promptText: "브랜드 후기" },
      ],
    };

    const firstKeys = briefingKeys("job-1", firstCommit);
    const changedKeys = briefingKeys("job-1", changedCommit);

    // The completed snapshot has enough shape to derive a stable ordinal key.
    expect(firstKeys).toEqual([
      "job-1|briefing|0|naver-briefing",
      "job-1|briefing|1|naver-briefing",
    ]);
    expect(new Set(firstKeys).size).toBe(2);
    expect(changedKeys).toEqual(firstKeys);

    // RED characterization: the attempt id is removed on terminal commit, so
    // the same key cannot tell a replay from a legitimate rerun whose payload
    // changed. First-write immutability must therefore raise a conflict.
    expect(firstCommit.briefingPrompt).not.toBe(changedCommit.briefingPrompt);
  });
});
