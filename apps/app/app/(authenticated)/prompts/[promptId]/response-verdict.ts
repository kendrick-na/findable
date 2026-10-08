/** Tracking rows predate the current entity-verdict schema. Never call them confirmed. */
export function responseVerdict(
  response: {
    brandMentioned: boolean;
    errorMessage: string | null;
  },
  /** 사전 `app.promptResponses.verdict*`. */
  t: {
    verdictCandidate: string;
    verdictError: string;
    verdictNotConfirmed: string;
  }
) {
  if (response.errorMessage) {
    return { label: t.verdictError, tone: "text-amber-300 text-xs" };
  }
  if (response.brandMentioned) {
    return {
      label: t.verdictCandidate,
      tone: "text-emerald-300 text-xs",
    };
  }
  return {
    label: t.verdictNotConfirmed,
    tone: "text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs",
  };
}
