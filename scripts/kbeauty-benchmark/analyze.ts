import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BRANDS } from "./config";

const LEADING_WWW = /^www\./;

interface Row {
  citedSources: Array<{ domain: string; title?: string; url: string }>;
  engineId: string;
  errorMessage: string | null;
  isStub: boolean;
  mentions: Array<{ brandId: string; order: number }>;
  promptId: string;
  repeat: number;
}

interface RawBenchmark {
  benchmarkVersion: string;
  measuredAt: string;
  methodology: {
    engines: string[];
    promptCount: number;
    repeats: number;
  };
  rows: Row[];
}

function option(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return (
    process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ??
    fallback
  );
}

function percent(value: number): number {
  return Math.round(value * 1000) / 10;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLocaleLowerCase("en-US").replace(LEADING_WWW, "");
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) {
    return 1;
  }
  const intersection = [...left].filter((value) => right.has(value)).length;
  return intersection / union.size;
}

function responseStability(rows: Row[]): {
  averagePairwiseJaccard: number;
  identicalGroups: number;
  promptEngineGroups: number;
} {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row.engineId}:${row.promptId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const similarities: number[] = [];
  let identicalGroups = 0;
  for (const group of groups.values()) {
    const sets = group.map(
      (row) => new Set(row.mentions.map((mention) => mention.brandId))
    );
    const groupSimilarities: number[] = [];
    for (let left = 0; left < sets.length; left += 1) {
      for (let right = left + 1; right < sets.length; right += 1) {
        groupSimilarities.push(jaccard(sets[left], sets[right]));
      }
    }
    similarities.push(...groupSimilarities);
    if (
      groupSimilarities.length > 0 &&
      groupSimilarities.every((value) => value === 1)
    ) {
      identicalGroups += 1;
    }
  }
  return {
    averagePairwiseJaccard: similarities.length
      ? percent(
          similarities.reduce((sum, value) => sum + value, 0) /
            similarities.length
        )
      : 0,
    identicalGroups,
    promptEngineGroups: groups.size,
  };
}

const input = resolve(option("in", "/tmp/findable-kbeauty-benchmark/raw.json"));
const output = resolve(
  option("out", "/tmp/findable-kbeauty-benchmark/summary.json")
);
const raw = JSON.parse(await readFile(input, "utf8")) as RawBenchmark;
const valid = raw.rows.filter((row) => !(row.errorMessage || row.isStub));
const totalBrandMentions = valid.reduce(
  (sum, row) => sum + row.mentions.length,
  0
);

const brands = BRANDS.map((brand) => {
  const mentionedRows = valid.filter((row) =>
    row.mentions.some((mention) => mention.brandId === brand.id)
  );
  const orders = mentionedRows.flatMap((row) =>
    row.mentions
      .filter((mention) => mention.brandId === brand.id)
      .map((mention) => mention.order)
  );
  const engineRates = Object.fromEntries(
    raw.methodology.engines.map((engineId) => {
      const engineRows = valid.filter((row) => row.engineId === engineId);
      const count = engineRows.filter((row) =>
        row.mentions.some((mention) => mention.brandId === brand.id)
      ).length;
      return [
        engineId,
        {
          mentions: count,
          responses: engineRows.length,
          rate: engineRows.length ? percent(count / engineRows.length) : null,
        },
      ];
    })
  );
  const promptCoverage = new Set(mentionedRows.map((row) => row.promptId)).size;
  const groups = new Map<string, number>();
  for (const row of valid) {
    const key = `${row.promptId}:${row.engineId}`;
    if (!groups.has(key)) {
      groups.set(key, 0);
    }
    if (row.mentions.some((mention) => mention.brandId === brand.id)) {
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
  }
  const stableGroups = [...groups.values()].filter(
    (count) => count === raw.methodology.repeats
  ).length;
  return {
    brandId: brand.id,
    name: brand.name,
    mentions: mentionedRows.length,
    mentionRate: valid.length
      ? percent(mentionedRows.length / valid.length)
      : 0,
    competitiveShare: totalBrandMentions
      ? percent(mentionedRows.length / totalBrandMentions)
      : 0,
    averageMentionOrder: orders.length
      ? Math.round((orders.reduce((a, b) => a + b, 0) / orders.length) * 10) /
        10
      : null,
    promptCoverage,
    stablePromptEngineGroups: stableGroups,
    engineRates,
  };
}).sort(
  (a, b) =>
    b.mentions - a.mentions ||
    (a.averageMentionOrder ?? 99) - (b.averageMentionOrder ?? 99)
);

const sourceCounts = new Map<
  string,
  { citations: number; responseKeys: Set<string> }
>();
for (const row of valid) {
  const responseKey = `${row.engineId}:${row.promptId}:${row.repeat}`;
  for (const source of row.citedSources) {
    const domain = normalizeDomain(source.domain);
    const current = sourceCounts.get(domain) ?? {
      citations: 0,
      responseKeys: new Set<string>(),
    };
    current.citations += 1;
    current.responseKeys.add(responseKey);
    sourceCounts.set(domain, current);
  }
}

const engines = raw.methodology.engines.map((engineId) => {
  const rows = valid.filter((row) => row.engineId === engineId);
  const mentionCount = rows.reduce((sum, row) => sum + row.mentions.length, 0);
  const citationCount = rows.reduce(
    (sum, row) => sum + row.citedSources.length,
    0
  );
  return {
    engineId,
    responses: rows.length,
    candidateMentions: mentionCount,
    averageCandidateMentions: rows.length
      ? Math.round((mentionCount / rows.length) * 10) / 10
      : 0,
    responsesWithCitations: rows.filter((row) => row.citedSources.length > 0)
      .length,
    citations: citationCount,
    averageCitations: rows.length
      ? Math.round((citationCount / rows.length) * 10) / 10
      : 0,
    stability: responseStability(rows),
  };
});

const summary = {
  benchmarkVersion: raw.benchmarkVersion,
  measuredAt: raw.measuredAt,
  responseQuality: {
    requested: raw.rows.length,
    valid: valid.length,
    errors: raw.rows.filter((row) => row.errorMessage).length,
    stubs: raw.rows.filter((row) => row.isStub).length,
  },
  methodology: raw.methodology,
  engines,
  totalCandidateBrandMentions: totalBrandMentions,
  brands,
  topCitedDomains: [...sourceCounts.entries()]
    .map(([domain, stats]) => ({
      domain,
      citations: stats.citations,
      responses: stats.responseKeys.size,
    }))
    .sort((a, b) => b.responses - a.responses || b.citations - a.citations)
    .slice(0, 20),
  caveats: [
    "브랜드 표본은 시장점유율 대표표본이 아닌 목적표본이다.",
    "API 모델 응답은 각 서비스의 소비자용 웹 UI와 다를 수 있다.",
    "생성형 AI 응답은 확률적이므로 단발 순위가 아니라 반복 등장률로 해석해야 한다.",
    `경쟁 점유율은 사전에 정한 ${BRANDS.length}개 후보 브랜드의 전체 언급 중 비중이며 전체 시장점유율이 아니다.`,
    "평균 등장 순서는 응답에 나타난 후보 브랜드끼리의 텍스트상 첫 등장 순서이며 제품 순위나 추천 강도를 뜻하지 않는다.",
    "출처 빈도는 응답이 제공한 인용 URL의 도메인 빈도이며 특정 브랜드 언급의 직접 근거로 귀속하지 않는다.",
  ],
};

await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary.responseQuality));
console.log(`Saved summary to ${output}`);
