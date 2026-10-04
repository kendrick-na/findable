/* @vitest-environment node */

import {
  type AuthoritativeJobLease,
  finishPromptAttempt,
  isDispatchAttempt,
  isSuccessfulMeasurement,
  markPromptAttemptStarted,
  type PromptAttempt,
  reservePromptPlan,
  takeOverPromptPlan,
} from "@repo/audit/prompt-attempt-ledger";
import { describe, expect, test } from "vitest";

const prompts = Array.from({ length: 9 }, (_, index) => ({
  id: `p${index + 1}`,
}));

const lease = (
  leaseToken: string,
  leaseUntil = "2026-10-04T09:10:00.000Z"
): AuthoritativeJobLease => ({ leaseToken, leaseUntil: new Date(leaseUntil) });

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
        lease("job-1-lease"),
        new Date("2026-10-04T09:01:00.000Z")
      );
      return finishPromptAttempt(
        started,
        lease("job-1-lease"),
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
      lease("stale-lease"),
      new Date("2026-10-04T09:01:00.000Z")
    );
    expect(staleStart).toEqual(selected);

    const started = markPromptAttemptStarted(
      selected,
      lease("job-1-lease"),
      new Date("2026-10-04T09:01:00.000Z")
    );
    expect(isDispatchAttempt(started)).toBe(true);
    expect(
      markPromptAttemptStarted(
        started,
        lease("job-1-lease"),
        new Date("2026-10-04T09:03:00.000Z")
      )
    ).toEqual(started);

    expect(
      finishPromptAttempt(
        started,
        lease("stale-lease"),
        new Date("2026-10-04T09:02:00.000Z"),
        "completed"
      )
    ).toEqual(started);

    const finished = finishPromptAttempt(
      started,
      lease("job-1-lease"),
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
        lease("job-1-lease"),
        new Date("2026-10-04T09:02:00.000Z"),
        "completed"
      )
    ).toEqual(selected);

    for (const outcome of ["failed", "unverified"] as const) {
      const started = markPromptAttemptStarted(
        selected,
        lease("job-1-lease"),
        new Date("2026-10-04T09:01:00.000Z")
      );
      const finished = finishPromptAttempt(
        started,
        lease("job-1-lease"),
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

  test("원자 예약으로 생길 수 없는 부분·중복 sequence 계획은 fail-closed한다", () => {
    const plan = reserve("job-1", [], 3);

    expect(() => reserve("job-1", plan.slice(0, 2), 3)).toThrow(
      "Incomplete prompt plan"
    );
    expect(() =>
      reserve("job-2", [
        plan[0],
        { ...plan[1], auditJobId: "job-other", selectionSeq: 1 },
      ])
    ).toThrow("Duplicate brand selection sequence");
  });

  test("같은 auditJobId가 다른 브랜드에 나타나면 새 계획을 만들지 않는다", () => {
    const [foreign] = reserve("job-1", [], 1);

    expect(() =>
      reservePromptPlan({
        attempts: [foreign],
        auditJobId: "job-1",
        brandId: "brand-2",
        leaseToken: "brand-2-lease",
        limit: 1,
        prompts,
        selectedAt: new Date("2026-10-04T09:00:00.000Z"),
      })
    ).toThrow("Audit job belongs to another brand");
  });

  test("만료 lease 인계는 미완료 행을 새 fence로 옮겨 zombie write를 막는다", () => {
    const [selected, selectedLater] = reserve("job-1", [], 2);
    const started = markPromptAttemptStarted(
      selected,
      lease("job-1-lease"),
      new Date("2026-10-04T09:01:00.000Z")
    );
    const takenOver = takeOverPromptPlan({
      attempts: [started, selectedLater],
      auditJobId: "job-1",
      brandId: "brand-1",
      expiredLease: lease("job-1-lease", "2026-10-04T09:01:00.000Z"),
      currentLease: lease("job-1-lease-2", "2026-10-04T09:10:00.000Z"),
      now: new Date("2026-10-04T09:02:00.000Z"),
    });

    expect(takenOver.map((attempt) => attempt.leaseToken)).toEqual([
      "job-1-lease-2",
      "job-1-lease-2",
    ]);
    expect(
      finishPromptAttempt(
        takenOver[0],
        lease("job-1-lease"),
        new Date("2026-10-04T09:02:00.000Z"),
        "completed"
      )
    ).toEqual(takenOver[0]);
    expect(
      finishPromptAttempt(
        takenOver[0],
        lease("job-1-lease-2"),
        new Date("2026-10-04T09:02:00.000Z"),
        "completed"
      )
    ).toEqual(takenOver[0]);
    expect(
      finishPromptAttempt(
        takenOver[0],
        lease("job-1-lease-2"),
        new Date("2026-10-04T09:02:00.000Z"),
        "abandoned"
      ).outcome
    ).toBe("abandoned");
    expect(
      markPromptAttemptStarted(
        takenOver[1],
        lease("job-1-lease-2"),
        new Date("2026-10-04T09:02:00.000Z")
      ).startedAt
    ).toEqual(new Date("2026-10-04T09:02:00.000Z"));
  });

  test("만료된 권위 lease는 인계 전에도 started/finished를 쓸 수 없다", () => {
    const [selected] = reserve("job-1", [], 1);
    const expired = lease("job-1-lease", "2026-10-04T09:00:30.000Z");

    expect(
      markPromptAttemptStarted(
        selected,
        expired,
        new Date("2026-10-04T09:01:00.000Z")
      )
    ).toEqual(selected);
  });

  test("아직 살아 있는 lease나 만료된 새 lease로 takeover하지 않는다", () => {
    const plan = reserve("job-1", [], 1);
    const now = new Date("2026-10-04T09:02:00.000Z");

    expect(() =>
      takeOverPromptPlan({
        attempts: plan,
        auditJobId: "job-1",
        brandId: "brand-1",
        expiredLease: lease("job-1-lease", "2026-10-04T09:03:00.000Z"),
        currentLease: lease("job-1-lease-2"),
        now,
      })
    ).toThrow("expired old lease and live current lease");
    expect(() =>
      takeOverPromptPlan({
        attempts: plan,
        auditJobId: "job-1",
        brandId: "brand-1",
        expiredLease: lease("job-1-lease", "2026-10-04T09:01:00.000Z"),
        currentLease: lease("job-1-lease-2", "2026-10-04T09:01:30.000Z"),
        now,
      })
    ).toThrow("expired old lease and live current lease");
  });

  test("resume은 삭제 질문·축소 limit·혼합 unfinished lease를 fail-closed한다", () => {
    const plan = reserve("job-1", [], 2);
    expect(() =>
      reservePromptPlan({
        attempts: plan,
        auditJobId: "job-1",
        brandId: "brand-1",
        leaseToken: "job-1-lease",
        limit: 2,
        prompts: prompts.slice(1),
        selectedAt: new Date("2026-10-04T09:00:00.000Z"),
      })
    ).toThrow("missing prompt");
    expect(() => reserve("job-1", plan, 1)).toThrow("exceeds current limit");
    expect(() =>
      reserve("job-1", [{ ...plan[0], leaseToken: "lease-a" }, plan[1]], 2)
    ).toThrow("multiple unfinished leases");
  });
});
