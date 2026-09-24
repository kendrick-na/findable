import type { EngineId, EngineResponse } from "./types";

/** Shared, adapter-free audit aggregation for measurement and saved reports. */
export interface AuditMetrics {
  averageMentionListSize: number | null;
  averageMentionPosition: number | null;
  averageRelativePosition: number | null;
  enginesCovered: EngineId[];
  enginesWithMention: EngineId[];
  errors: Array<{ engineId: EngineId; message: string }>;
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
  };
  sov: number;
  stubCount: number;
  topCitedDomains: Array<{ domain: string; count: number }>;
}

export function aggregateAudit(responses: EngineResponse[]): AuditMetrics {
  const enginesCovered = responses.map((r) => r.engineId);
  const confirmedResponses = responses.filter(
    (r) => r.brandMentioned && !r.errorMessage && !r.isStub
  );
  const enginesWithMention = confirmedResponses.map((r) => r.engineId);
  const positions = confirmedResponses
    .map((r) => r.mentionPosition)
    .filter((p): p is number => p !== null);
  const ranked = confirmedResponses.filter(
    (
      r
    ): r is EngineResponse & {
      mentionListSize: number;
      mentionPosition: number;
    } => r.mentionPosition !== null && r.mentionListSize !== null
  );
  const relativePositions = ranked.map((r) =>
    r.mentionListSize <= 1
      ? 0
      : (r.mentionPosition - 1) / (r.mentionListSize - 1)
  );
  const listSizes = ranked.map((r) => r.mentionListSize);

  const sentiments = { positive: 0, neutral: 0, negative: 0 };
  for (const r of confirmedResponses) {
    if (r.sentiment) {
      sentiments[r.sentiment]++;
    }
  }

  // Search results attached to a non-mention are not citations of this brand.
  const domainCount = new Map<string, number>();
  for (const r of confirmedResponses) {
    for (const src of r.citedSources) {
      if (src.domain) {
        domainCount.set(src.domain, (domainCount.get(src.domain) ?? 0) + 1);
      }
    }
  }
  const topCitedDomains = Array.from(domainCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, count }));

  const errors = responses
    .filter((r) => r.errorMessage)
    .map((r) => ({ engineId: r.engineId, message: r.errorMessage as string }));
  const stubCount = responses.filter((r) => r.isStub).length;
  const successCount = responses.filter(
    (r) => !r.isStub && !r.errorMessage
  ).length;
  const sov =
    successCount === 0
      ? 0
      : Math.round((enginesWithMention.length / successCount) * 100);

  return {
    enginesCovered,
    enginesWithMention,
    sov,
    averageMentionPosition:
      positions.length === 0
        ? null
        : Math.round(
            (positions.reduce((a, b) => a + b, 0) / positions.length) * 10
          ) / 10,
    averageMentionListSize:
      listSizes.length === 0
        ? null
        : Math.round(
            (listSizes.reduce((a, b) => a + b, 0) / listSizes.length) * 10
          ) / 10,
    averageRelativePosition:
      relativePositions.length === 0
        ? null
        : Math.round(
            (relativePositions.reduce((a, b) => a + b, 0) /
              relativePositions.length) *
              100
          ) / 100,
    sentimentDistribution: sentiments,
    topCitedDomains,
    errors,
    stubCount,
  };
}
