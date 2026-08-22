import "server-only";

import { buildGeoActions } from "@repo/audit/actions";
import { database } from "@repo/database";
import { buildSourcesAnalysis } from "@/app/(authenticated)/lib/analysis-data";
import { scopedLatestRunTracking } from "@/lib/db/scoped";

export async function latestContentBrief(brandId: string) {
  const rows = await scopedLatestRunTracking(brandId);
  const first = rows[0];
  if (!first) {
    return null;
  }

  const byPrompt = new Map<string, { hit: number; total: number }>();
  for (const row of rows) {
    const entry = byPrompt.get(row.promptId) ?? { hit: 0, total: 0 };
    entry.total += 1;
    if (row.brandMentioned) {
      entry.hit += 1;
    }
    byPrompt.set(row.promptId, entry);
  }
  const promptRows = await database.prompt.findMany({
    where: { id: { in: [...byPrompt.keys()] } },
    select: { id: true, text: true },
  });
  const prompts = promptRows.map((prompt) => ({
    text: prompt.text,
    hit: byPrompt.get(prompt.id)?.hit ?? 0,
    total: byPrompt.get(prompt.id)?.total ?? 0,
  }));
  const sources = buildSourcesAnalysis(rows);
  const mix = (sources?.kinds ?? []).reduce(
    (acc, item) => {
      acc[item.kind] = item.citations;
      return acc;
    },
    { owned: 0, community: 0, reference: 0, media: 0, other: 0 } as Record<
      string,
      number
    >
  );
  const enginesMeasured = new Set(rows.map((row) => row.engineId)).size;
  const enginesMentioned = new Set(
    rows.filter((row) => row.brandMentioned).map((row) => row.engineId)
  ).size;
  const actions = buildGeoActions({
    brandName: first.brand.name || first.brand.domain,
    averageMentionPosition: null,
    enginesMeasured,
    enginesMentioned,
    prompts,
    sourceMix: {
      owned: mix.owned ?? 0,
      community: mix.community ?? 0,
      reference: mix.reference ?? 0,
      media: mix.media ?? 0,
      other: mix.other ?? 0,
    },
    topDomains: (sources?.domains ?? []).map((domain) => ({
      domain: domain.domain,
      count: domain.citations,
      owned: domain.owned,
    })),
  });
  const action = actions.find((item) => item.kind === "content_fix");
  if (!action) {
    return null;
  }
  const shareOfVoice =
    rows.length === 0
      ? null
      : Math.round(
          (rows.filter((row) => row.brandMentioned).length / rows.length) * 100
        );

  return {
    action,
    brand: first.brand,
    measurement: {
      enginesMeasured,
      enginesMentioned,
      measuredAt: first.trackedAt,
      shareOfVoice,
      sourceDomains: (sources?.domains ?? [])
        .slice(0, 8)
        .map((item) => item.domain),
      weakPrompts: prompts
        .filter((prompt) => prompt.total > 0 && prompt.hit / prompt.total < 0.5)
        .slice(0, 8)
        .map((prompt) => prompt.text),
    },
  };
}
