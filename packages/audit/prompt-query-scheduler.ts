/**
 * One audit asks several prompts. Run prompt batches in order so a single
 * provider receives at most one request from that audit at a time. Engines
 * inside an individual batch remain parallel, preserving the normal latency.
 */
export async function queryPromptsSequentially<TPrompt, TResult>(
  prompts: readonly TPrompt[],
  query: (prompt: TPrompt, index: number) => Promise<TResult>,
  options: {
    completed?: readonly TResult[];
    onCompleted?: (results: readonly TResult[]) => Promise<void>;
  } = {}
): Promise<TResult[]> {
  if ((options.completed?.length ?? 0) > prompts.length) {
    throw new Error("Saved audit responses exceed the prompt plan");
  }
  const results: TResult[] = [...(options.completed ?? [])];
  for (const [index, prompt] of prompts.entries()) {
    if (index < results.length) {
      continue;
    }
    results.push(await query(prompt, index));
    await options.onCompleted?.(results);
  }
  return results;
}
