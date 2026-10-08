/** Budget shared by prompt collection and post-result work in one invocation. */
export const AUDIT_RUN_TIME_BUDGET_MS = 270_000;
export const AUDIT_MIN_NEXT_PROMPT_BUDGET_MS = 35_000;
export const AUDIT_POST_PROCESSING_RESERVE_MS = 20_000;
// Firecrawl permits up to 60s per briefing scrape and the main flow may try
// three candidate prompts sequentially. Do not start that optional work unless
// the invocation can absorb its documented worst case plus the final reserve.
export const AUDIT_BRIEFING_WORST_CASE_MS = 180_000;
export const AUDIT_PDF_WORST_CASE_MS = 30_000;

export interface AuditRunBudget {
  dispose: () => void;
  hasBudgetFor: (durationMs: number) => boolean;
  hasPostProcessingBudget: () => boolean;
  invocationStartedAtMs: number;
  signal: AbortSignal;
  stopStartingAtMs: number;
}

export function createAuditRunBudget(
  invocationStartedAtMs = Date.now(),
  now: () => number = Date.now
): AuditRunBudget {
  const controller = new AbortController();
  const stopStartingAtMs = invocationStartedAtMs + AUDIT_RUN_TIME_BUDGET_MS;
  const timer = setTimeout(
    () => {
      controller.abort(
        new DOMException("Audit run deadline exceeded", "AbortError")
      );
    },
    Math.max(0, stopStartingAtMs - now())
  );
  timer.unref?.();

  return {
    invocationStartedAtMs,
    stopStartingAtMs,
    signal: controller.signal,
    hasBudgetFor: (durationMs) =>
      Number.isFinite(durationMs) &&
      stopStartingAtMs - now() > durationMs + AUDIT_POST_PROCESSING_RESERVE_MS,
    hasPostProcessingBudget: () =>
      stopStartingAtMs - now() > AUDIT_POST_PROCESSING_RESERVE_MS,
    dispose: () => clearTimeout(timer),
  };
}
