import type { EngineId, EngineResponse } from "./types";

const WWW_PREFIX_RE = /^www\./;

/** Shared, adapter-free audit aggregation for measurement and saved reports. */
export interface AuditMetrics {
  averageMentionListSize: number | null;
  averageMentionPosition: number | null;
  averageRelativePosition: number | null;
  /** Only official-site citations can be attributed without claim-level evidence. */
  citationAttribution:
    | "none_observed"
    | "owned_only"
    | "partial"
    | "unverified_external";
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
  /** Links in confirmed answers whose relationship to the brand is unknown. */
  unattributedCitationCount: number;
  /** Successful responses excluded because entity verification failed. */
  unverifiedCount: number;
  /** Number of successful responses with a conclusive entity verdict. */
  verifiedCount: number;
}

function normalizedDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`
    );
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.hostname.replace(WWW_PREFIX_RE, "")
      : "";
  } catch {
    return "";
  }
}

function isConfirmedMention(response: EngineResponse): boolean {
  return (
    response.brandMentioned &&
    response.mentionQuality !== "unverified" &&
    !response.errorMessage &&
    !response.isStub
  );
}

/**
 * A response-level mention verdict does not attribute every link in the answer
 * to the registered brand. Retain raw links in EngineResponse, but credit only
 * the submitted official site (and its subdomains) without claim-level proof.
 */
export function partitionCitedSources(
  responses: EngineResponse[],
  brandDomain?: string
): {
  attributedResponses: EngineResponse[];
  unattributedCitationCount: number;
} {
  const owned = brandDomain ? normalizedDomain(brandDomain) : "";
  let unattributedCitationCount = 0;
  const attributedResponses = responses.map((response) => ({
    ...response,
    citedSources: isConfirmedMention(response)
      ? response.citedSources.flatMap((source) => {
          const domain = normalizedDomain(source.url);
          const isOwned = Boolean(
            owned && (domain === owned || domain.endsWith(`.${owned}`))
          );
          if (!isOwned) {
            unattributedCitationCount += 1;
            return [];
          }
          return [{ ...source, domain }];
        })
      : [],
  }));
  return { attributedResponses, unattributedCitationCount };
}

export function aggregateAudit(
  responses: EngineResponse[],
  brandDomain?: string
): AuditMetrics {
  const enginesCovered = responses.map((r) => r.engineId);
  const confirmedResponses = responses.filter(isConfirmedMention);
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
  // A confirmed answer can still cite an unrelated namesake: source attribution
  // requires more than the answer-level entity verdict.
  const { attributedResponses, unattributedCitationCount } =
    partitionCitedSources(responses, brandDomain);
  const domainCount = new Map<string, number>();
  for (const r of attributedResponses) {
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
  let citationAttribution: AuditMetrics["citationAttribution"] =
    "none_observed";
  if (unattributedCitationCount > 0) {
    citationAttribution =
      topCitedDomains.length > 0 ? "partial" : "unverified_external";
  } else if (topCitedDomains.length > 0) {
    citationAttribution = "owned_only";
  }

  const errors = responses
    .filter((r) => r.errorMessage)
    .map((r) => ({ engineId: r.engineId, message: r.errorMessage as string }));
  const stubCount = responses.filter((r) => r.isStub).length;
  const unverifiedCount = responses.filter(
    (r) => !(r.isStub || r.errorMessage) && r.mentionQuality === "unverified"
  ).length;
  const verifiedCount = responses.filter(
    (r) => !(r.isStub || r.errorMessage) && r.mentionQuality !== "unverified"
  ).length;
  const sov =
    verifiedCount === 0
      ? 0
      : Math.round((enginesWithMention.length / verifiedCount) * 100);

  return {
    citationAttribution,
    enginesCovered,
    enginesWithMention,
    sov,
    verifiedCount,
    unverifiedCount,
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
    unattributedCitationCount,
    errors,
    stubCount,
  };
}
