import { describe, expect, it } from "vitest";
import {
  type AuditCheckpoint,
  makeAuditCheckpoint,
  nextAuditCheckpointAttempt,
  readAuditCheckpoint,
} from "./checkpoint";
import { runCheckpointedQuestions } from "./run-checkpointed-questions";

const scope = {
  brandId: "brand-1",
  domain: "example.com",
  language: "both" as const,
  organizationId: "org-1",
};

const initial = () =>
  makeAuditCheckpoint(
    scope,
    {
      brandName: "Example",
      brandVariants: [],
      identityGrounded: true,
      officialSiteIdentity: {
        finalUrl: "https://example.com",
        title: "Example",
        description: null,
        h1: null,
        siteName: null,
      },
    },
    [
      { text: "first", lang: "ko" },
      { text: "second", lang: "en" },
      { text: "third", lang: "ko" },
    ]
  );

const fakeBatch = (checkpoint: AuditCheckpoint, index: number) =>
  checkpoint.enginePlan[index].map((engineId) => ({
    engineId,
    rawResponse: "Synthetic test answer",
    brandMentioned: false,
    citedSources: [],
    durationMs: 1,
    isStub: false,
    errorMessage: null,
  })) as never;

describe("runner checkpointed question phase", () => {
  it("persists a full prefix and resumes only unpaid questions after timeout", async () => {
    const plan = initial();
    let durable: AuditCheckpoint = plan;
    const firstQueries: number[] = [];
    await expect(
      runCheckpointedQuestions(
        plan,
        (index) => {
          firstQueries.push(index);
          if (index === 1) {
            return Promise.reject(new Error("synthetic timeout"));
          }
          return Promise.resolve(fakeBatch(plan, index));
        },
        (saved) => {
          durable = saved;
          return Promise.resolve();
        }
      )
    ).rejects.toThrow("synthetic timeout");
    expect(firstQueries).toEqual([0, 1]);
    expect(durable.responses).toHaveLength(1);

    const validated = readAuditCheckpoint(durable, scope);
    if (!validated) {
      throw new Error("saved checkpoint did not validate");
    }
    const retry = nextAuditCheckpointAttempt(validated);
    expect(retry?.retry.attempt).toBe(2);
    if (!retry) {
      throw new Error("retry was not available");
    }
    const resumedQueries: number[] = [];
    const result = await runCheckpointedQuestions(
      retry,
      (index) => {
        resumedQueries.push(index);
        return Promise.resolve(fakeBatch(retry, index));
      },
      (saved) => {
        durable = saved;
        return Promise.resolve();
      }
    );
    expect(resumedQueries).toEqual([1, 2]);
    expect(result).toHaveLength(3);
    expect(durable.responses).toHaveLength(3);
    expect(readAuditCheckpoint(durable, scope)?.retry.attempt).toBe(2);
  });

  it("does not start a new question right before the deadline and resumes the rest later", async () => {
    const plan = initial();
    let durable: AuditCheckpoint = plan;
    let now = 1_000_000;
    const realNow = Date.now;
    Date.now = () => now;
    const firstQueries: number[] = [];
    try {
      const partial = await runCheckpointedQuestions(
        plan,
        (index) => {
          firstQueries.push(index);
          // Question 0 finishes 34s before the cutoff — less than the 35s
          // needed to start another paid question.
          now += 270_000 - 34_000;
          return Promise.resolve(fakeBatch(plan, index));
        },
        (saved) => {
          durable = saved;
          return Promise.resolve();
        },
        { invocationStartedAtMs: 1_000_000, stopStartingAtMs: 1_270_000 }
      );
      expect(firstQueries).toEqual([0]);
      expect(partial).toHaveLength(1);
      expect(durable.responses).toHaveLength(1);
    } finally {
      Date.now = realNow;
    }

    const validated = readAuditCheckpoint(durable, scope);
    const retry = validated ? nextAuditCheckpointAttempt(validated) : null;
    if (!retry) {
      throw new Error("budget-cut checkpoint was not resumable");
    }
    const resumedQueries: number[] = [];
    const started = Date.now();
    const result = await runCheckpointedQuestions(
      retry,
      (index) => {
        resumedQueries.push(index);
        return Promise.resolve(fakeBatch(retry, index));
      },
      (saved) => {
        durable = saved;
        return Promise.resolve();
      },
      { invocationStartedAtMs: started, stopStartingAtMs: started + 270_000 }
    );
    expect(resumedQueries).toEqual([1, 2]);
    expect(result).toHaveLength(3);
    expect(durable.responses).toHaveLength(3);
  });
});
