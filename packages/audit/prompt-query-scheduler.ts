/**
 * One audit asks several prompts. Run prompt batches in order so a single
 * provider receives at most one request from that audit at a time. Engines
 * inside an individual batch remain parallel, preserving the normal latency.
 */
export async function queryPromptsSequentially<TPrompt, TResult>(
  prompts: readonly TPrompt[],
  query: (prompt: TPrompt, index: number) => Promise<TResult>
): Promise<TResult[]> {
  const results: TResult[] = [];
  for (const [index, prompt] of prompts.entries()) {
    results.push(await query(prompt, index));
  }
  return results;
}
