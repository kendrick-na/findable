import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  type EngineId,
  type EngineResponse,
  queryEngine,
} from "../../packages/ai/lib/engines";
import { BENCHMARK_VERSION, BRANDS, DEFAULT_ENGINES, PROMPTS } from "./config";

interface Mention {
  brandId: string;
  firstIndex: number;
  name: string;
  order: number;
}

interface BenchmarkRow {
  citedSources: EngineResponse["citedSources"];
  durationMs: number;
  engineId: EngineId;
  errorMessage: string | null;
  isStub: boolean;
  mentions: Mention[];
  promptId: string;
  promptText: string;
  rawResponse: string;
  repeat: number;
  usage: EngineResponse["usage"] | null;
}

function option(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return (
    process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ??
    fallback
  );
}

function mentionIndex(text: string, variants: string[]): number | null {
  const lowered = text.toLocaleLowerCase("ko-KR");
  let first: number | null = null;
  for (const variant of variants) {
    const candidate = variant.toLocaleLowerCase("ko-KR");
    const index = lowered.indexOf(candidate);
    if (index >= 0 && (first === null || index < first)) {
      first = index;
    }
  }
  return first;
}

function extractMentions(text: string): Mention[] {
  const found = BRANDS.flatMap((brand) => {
    const firstIndex = mentionIndex(text, brand.variants);
    return firstIndex === null
      ? []
      : [{ brandId: brand.id, firstIndex, name: brand.name }];
  }).sort((a, b) => a.firstIndex - b.firstIndex);
  return found.map((mention, index) => ({ ...mention, order: index + 1 }));
}

async function measure(
  engineId: EngineId,
  promptId: string,
  promptText: string,
  repeat: number
): Promise<BenchmarkRow> {
  const response = await queryEngine({
    engineId,
    language: "ko",
    prompt: promptText,
  });
  return {
    promptId,
    promptText,
    repeat,
    engineId,
    rawResponse: response.rawResponse,
    mentions: extractMentions(response.rawResponse),
    citedSources: response.citedSources,
    durationMs: response.durationMs,
    errorMessage: response.errorMessage,
    isStub: response.isStub,
    usage: response.usage ?? null,
  };
}

function rowStatus(row: BenchmarkRow): string {
  if (row.errorMessage) {
    return "error";
  }
  if (row.isStub) {
    return "stub";
  }
  return `${row.mentions.length} mentions`;
}

async function main() {
  const limit = Math.max(
    1,
    Number.parseInt(option("limit", String(PROMPTS.length)), 10)
  );
  const repeats = Math.max(1, Number.parseInt(option("repeats", "3"), 10));
  const engines = option("engines", DEFAULT_ENGINES.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as EngineId[];
  const output = resolve(
    option("out", "/tmp/findable-kbeauty-benchmark/raw.json")
  );
  const prompts = PROMPTS.slice(0, limit);
  const rows: BenchmarkRow[] = [];

  console.log(
    `K-beauty benchmark: ${prompts.length} prompts × ${engines.length} engines × ${repeats} repeats`
  );

  // 같은 질문의 엔진 3개만 병렬 실행한다. 반복까지 한꺼번에 보내면 공급자 rate limit과
  // 일시 오류가 데이터 편향으로 이어질 수 있다.
  for (const prompt of prompts) {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      const measured = await Promise.all(
        engines.map((engineId) =>
          measure(engineId, prompt.id, prompt.text, repeat)
        )
      );
      rows.push(...measured);
      const status = measured
        .map((row) => `${row.engineId}:${rowStatus(row)}`)
        .join(" | ");
      console.log(`${prompt.id} #${repeat} — ${status}`);
    }
  }

  const payload = {
    benchmarkVersion: BENCHMARK_VERSION,
    measuredAt: new Date().toISOString(),
    methodology: {
      brands: BRANDS,
      engines,
      promptCount: prompts.length,
      prompts,
      repeats,
      sampleType:
        "purposive public-brand pilot; not market-share representative",
    },
    rows,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Saved ${rows.length} rows to ${output}`);
}

await main();
