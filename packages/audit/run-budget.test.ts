import { describe, expect, it, vi } from "vitest";
import {
  AUDIT_BRIEFING_WORST_CASE_MS,
  AUDIT_MIN_NEXT_PROMPT_BUDGET_MS,
  AUDIT_PDF_WORST_CASE_MS,
  AUDIT_POST_PROCESSING_RESERVE_MS,
  AUDIT_RUN_TIME_BUDGET_MS,
  createAuditRunBudget,
} from "./run-budget";

describe("audit run budget", () => {
  it("shares one deadline and abort signal with prompt and post-result work", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const budget = createAuditRunBudget(1000);
    expect(budget.stopStartingAtMs).toBe(1000 + AUDIT_RUN_TIME_BUDGET_MS);
    expect(budget.signal.aborted).toBe(false);
    vi.advanceTimersByTime(AUDIT_RUN_TIME_BUDGET_MS);
    expect(budget.signal.aborted).toBe(true);
    budget.dispose();
    vi.useRealTimers();
  });

  it("reserves time for post-result work", () => {
    const now = vi.fn().mockReturnValue(100_000);
    const budget = createAuditRunBudget(0, now);
    expect(AUDIT_MIN_NEXT_PROMPT_BUDGET_MS).toBeGreaterThan(
      AUDIT_POST_PROCESSING_RESERVE_MS
    );
    expect(budget.hasPostProcessingBudget()).toBe(true);
    now.mockReturnValue(
      AUDIT_RUN_TIME_BUDGET_MS - AUDIT_POST_PROCESSING_RESERVE_MS
    );
    expect(budget.hasPostProcessingBudget()).toBe(false);
    budget.dispose();
  });

  it("requires worst-case time before starting optional post-processing", () => {
    const now = vi.fn().mockReturnValue(0);
    const budget = createAuditRunBudget(0, now);
    expect(budget.hasBudgetFor(AUDIT_PDF_WORST_CASE_MS)).toBe(true);
    expect(budget.hasBudgetFor(AUDIT_BRIEFING_WORST_CASE_MS)).toBe(true);
    now.mockReturnValue(
      AUDIT_RUN_TIME_BUDGET_MS -
        AUDIT_BRIEFING_WORST_CASE_MS -
        AUDIT_POST_PROCESSING_RESERVE_MS
    );
    expect(budget.hasBudgetFor(AUDIT_BRIEFING_WORST_CASE_MS)).toBe(false);
    budget.dispose();
  });
});
