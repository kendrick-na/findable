type EngineCount = { engineId: string; attempts: number; failures: number };

export function summarizeAuditEngineFailures(
  jobs: Array<{ result: unknown }>
): EngineCount[] {
  const counts = new Map<string, EngineCount>();

  for (const job of jobs) {
    const result = job.result;
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      continue;
    }
    const responses = (result as { engineResponses?: unknown }).engineResponses;
    if (!Array.isArray(responses)) {
      continue;
    }
    for (const response of responses) {
      if (!response || typeof response !== "object" || Array.isArray(response)) {
        continue;
      }
      const { engineId, errorMessage, isStub } = response as {
        engineId?: unknown;
        errorMessage?: unknown;
        isStub?: unknown;
      };
      if (typeof engineId !== "string" || !engineId) {
        continue;
      }
      const row = counts.get(engineId) ?? {
        engineId,
        attempts: 0,
        failures: 0,
      };
      row.attempts += 1;
      if ((typeof errorMessage === "string" && errorMessage.length > 0) || isStub === true) {
        row.failures += 1;
      }
      counts.set(engineId, row);
    }
  }

  return [...counts.values()]
    .filter((row) => row.failures > 0)
    .sort((a, b) => b.failures - a.failures || a.engineId.localeCompare(b.engineId));
}
