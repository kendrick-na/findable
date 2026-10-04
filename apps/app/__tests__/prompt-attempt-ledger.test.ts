/* @vitest-environment node */

import {
  finishPromptAttempt,
  isDispatchAttempt,
  isSuccessfulMeasurement,
  markPromptAttemptStarted,
  type PromptAttempt,
  reservePromptPlan,
} from "@repo/audit/prompt-attempt-ledger";
import { describe, expect, test } from "vitest";

const prompts = Array.from({ length: 9 }, (_, index) => ({
  id: `p${index + 1}`,
}));

const reserve = (
  auditJobId: string,
  attempts: PromptAttempt[] = [],
  limit = 8
) =>
  reservePromptPlan({
    auditJobId,
    attempts,
    brandId: "brand-1",
    leaseToken: `${auditJobId}-lease`,
    limit,
    prompts,
    selectedAt: new Date("2026-10-04T09:00:00.000Z"),
  });

describe("prompt attempt ledger state model", () => {
  test("8개가 실패해도 다음 Job은 9번째 질문에 도달한다", () => {
    const first = reserve("job-1");
    const failed = first.map((attempt) => {
      const started = markPromptAttemptStarted(
        attempt,
        "job-1-lease",
        new Date("2026-10-04T09:01:00.000Z")
      );
      return finishPromptAttempt(
        started,
        "job-1-lease",
        new Date("2026-10-04T09:02:00.000Z"),
        "failed"
      );
    });

    expect(
      reserve("job-2", failed).map((attempt) => attempt.promptId)
    ).toContain("p9");
  });

  test("같은 Job 예약 재시도는 기존 계획을 그대로 재개하고 중복 생성하지 않는다", () => {
    const first = reserve("job-1", [], 3);
    const resumed = reserve("job-1", first, 3);

    expect(resumed).toEqual(first);
  });

  test("선택 의도만으로 dispatch 또는 성공 측정으로 세지 않는다", () => {
    const [selected] = reserve("job-1", [], 1);

    expect(isDispatchAttempt(selected)).toBe(false);
    expect(isSuccessfulMeasurement(selected)).toBe(false);
  });

  test("현재 lease만 started/finished를 단조 갱신한다", () => {
    const [selected] = reserve("job-1", [], 1);
    const staleStart = markPromptAttemptStarted(
      selected,
      "stale-lease",
      new Date("2026-10-04T09:01:00.000Z")
    );
    expect(staleStart).toEqual(selected);

    const started = markPromptAttemptStarted(
      selected,
      "job-1-lease",
      new Date("2026-10-04T09:01:00.000Z")
    );
    expect(isDispatchAttempt(started)).toBe(true);
    expect(
      markPromptAttemptStarted(
        started,
        "job-1-lease",
        new Date("2026-10-04T09:03:00.000Z")
      )
    ).toEqual(started);

    expect(
      finishPromptAttempt(
        started,
        "stale-lease",
        new Date("2026-10-04T09:02:00.000Z"),
        "completed"
      )
    ).toEqual(started);

    const finished = finishPromptAttempt(
      started,
      "job-1-lease",
      new Date("2026-10-04T09:02:00.000Z"),
      "completed"
    );
    expect(isSuccessfulMeasurement(finished)).toBe(true);
  });

  test("시작 전 finish와 failed/unverified 성공 집계를 거부한다", () => {
    const [selected] = reserve("job-1", [], 1);
    expect(
      finishPromptAttempt(
        selected,
        "job-1-lease",
        new Date("2026-10-04T09:02:00.000Z"),
        "completed"
      )
    ).toEqual(selected);

    for (const outcome of ["failed", "unverified"] as const) {
      const started = markPromptAttemptStarted(
        selected,
        "job-1-lease",
        new Date("2026-10-04T09:01:00.000Z")
      );
      const finished = finishPromptAttempt(
        started,
        "job-1-lease",
        new Date("2026-10-04T09:02:00.000Z"),
        outcome
      );
      expect(isSuccessfulMeasurement(finished)).toBe(false);
    }
  });

  test("순환은 Tracking 시각이 아니라 내구 selectionSeq를 따른다", () => {
    const first = reserve("job-1", [], 2);
    const second = reserve("job-2", first, 2);

    expect(first.map((attempt) => attempt.promptId)).toEqual(["p1", "p2"]);
    expect(second.map((attempt) => attempt.promptId)).toEqual(["p3", "p4"]);
    expect(second.map((attempt) => attempt.selectionSeq)).toEqual([3, 4]);
  });
});
