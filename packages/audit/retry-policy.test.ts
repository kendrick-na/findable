import { describe, expect, it } from "vitest";
import { newAuditAttemptBlockReason } from "./retry-policy";

const failed = (progress: number) => ({
  status: "failed",
  checkpoint: { responses: Array.from({ length: progress }, () => [{}]) },
});

describe("new audit job retry policy", () => {
  it("allows one failure but stops two consecutive no-progress runs", () => {
    expect(newAuditAttemptBlockReason([failed(0)])).toBeNull();
    expect(newAuditAttemptBlockReason([failed(0), failed(0)])).toBe(
      "no_progress"
    );
  });

  it("caps three failed jobs even if every job saved a question", () => {
    expect(newAuditAttemptBlockReason([failed(1), failed(1)])).toBeNull();
    expect(newAuditAttemptBlockReason([failed(1), failed(1), failed(1)])).toBe(
      "failed_attempt_cap"
    );
  });
  it("resets the streak after a completed run", () => {
    expect(
      newAuditAttemptBlockReason([
        failed(0),
        { status: "completed", checkpoint: null },
        failed(0),
        failed(0),
      ])
    ).toBeNull();
  });
});
