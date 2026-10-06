/** Low-cardinality audit timing events. Never add prompt or response text here. */
type Stage =
  | "job"
  | "mark_processing"
  | "brand_identity"
  | "official_site"
  | "competitors"
  | "resolve_prompts"
  | "prompt_query"
  | "engine_query"
  | "verify_mentions"
  | "verdict_chunk"
  | "aggregate"
  | "continuation_request"
  | "db_commit";
interface Detail {
  chunkIndex?: number;
  engineCount?: number;
  engineId?: string;
  promptCount?: number;
  promptIndex?: number;
  responseCount?: number;
}

export function createRunTiming(
  jobId: string,
  info: (event: string, fields: Record<string, unknown>) => void,
  now: () => number = () => performance.now()
) {
  const origin = now();
  const emit = (fields: Record<string, unknown>) => {
    try {
      info("audit.run.stage", { jobId, ...fields });
    } catch {
      // Observability must not alter the measurement or DB lifecycle.
    }
  };
  return {
    start(stage: Stage, detail: Detail = {}) {
      const started = now();
      emit({
        stage,
        phase: "started",
        elapsedMs: Math.round(started - origin),
        ...detail,
      });
      return (status: "fulfilled" | "rejected" = "fulfilled") => {
        const finished = now();
        emit({
          stage,
          phase: "finished",
          elapsedMs: Math.round(finished - origin),
          durationMs: Math.round(finished - started),
          ...detail,
          status,
        });
      };
    },
  };
}
