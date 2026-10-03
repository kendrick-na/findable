import { describe, expect, it } from "vitest";
import { MENTION_VERDICT_VERSION } from "../ai/lib/mention-verdict-version";
import { countMeasurementCoverage } from "./measurement-coverage";
import {
  auditPublicationIssue,
  auditPublicationStatus,
  citationPrescriptionsRestricted,
  hasStaleAuditPdf,
  isPublishableAuditResult,
  publicAuditResult,
  withRecomputedAuditMetrics,
} from "./normalize-stored-metrics";

/** n successful core-engine rows; the first `mentioned` confirm the brand. */
function rows(
  n: number,
  mentioned = 0,
  extra: Record<string, unknown> = {}
): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, index) => ({
    engineId: ["chatgpt", "claude", "gemini", "perplexity"][index % 4],
    brandMentioned: index < mentioned,
    mentionQuality: index < mentioned ? "confirmed" : "absent",
    isStub: false,
    errorMessage: null,
    ...extra,
  }));
}

function unverifiedRows(n: number): Record<string, unknown>[] {
  return rows(n, 0, {
    mentionQuality: "unverified",
    verdictVia: "skipped",
    verdictReason: "judge_failed",
  });
}

describe("saved audit metric normalization", () => {
  it("refuses current-version metrics-only totals without AI channel evidence", () => {
    const result = {
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: { verifiedCount: 14, unverifiedCount: 0, sov: 50 },
    };
    expect(auditPublicationIssue(result)).toBe("brand_verification");
    expect(publicAuditResult(result).metrics.sov).toBeNull();
  });

  it("withholds scores, cited domains and prescriptions when nothing was adjudicated", () => {
    const result = publicAuditResult({
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: {
        sov: 27,
        verifiedCount: 0,
        unverifiedCount: 7,
        enginesWithMention: ["gemini"],
        topCitedDomains: [{ domain: "unrelated.example", count: 8 }],
      },
      geoActions: [{ title: "Publish pages" }],
      topRecommendations: ["Publish pages"],
      regions: [{ region: "korea", score: 38 }],
      engineResponses: [{ engineId: "gemini", excerpt: "raw answer" }],
    });
    expect(result.metrics).toMatchObject({
      sov: null,
      unverifiedCount: 7,
      enginesWithMention: [],
      topCitedDomains: [],
    });
    expect(result.geoActions).toEqual([]);
    expect(result.topRecommendations).toEqual([]);
    expect(result.regions).toBeUndefined();
    expect(result.engineResponses[0].excerpt).toBe("raw answer");
  });

  it("blocks PDFs and AI advice for legacy and unresolved entity verdicts", () => {
    const responses = [
      { engineId: "chatgpt", brandMentioned: true, isStub: false },
      {
        engineId: "perplexity",
        brandMentioned: false,
        mentionQuality: "unverified",
        isStub: false,
      },
    ];
    const fresh = withRecomputedAuditMetrics({
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: { sov: 50 },
      engineResponses: responses,
    });
    expect(isPublishableAuditResult(fresh)).toBe(false);
    expect(hasStaleAuditPdf(fresh, fresh)).toBe(true);

    const legacy = withRecomputedAuditMetrics({
      metrics: { sov: 50 },
      engineResponses: responses,
    });
    expect(isPublishableAuditResult(legacy)).toBe(false);
    expect(hasStaleAuditPdf(legacy, legacy)).toBe(true);
  });

  it("allows a sufficiently verified current result to publish derivatives", () => {
    const fresh = withRecomputedAuditMetrics({
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: { sov: 100 },
      engineResponses: rows(10, 10),
    });
    expect(isPublishableAuditResult(fresh)).toBe(true);
    expect(auditPublicationStatus(fresh)).toBe("published");
  });

  it("excludes a few unverified answers from the denominator and still publishes", () => {
    // 21 verified (5 confirmed) + 1 judge failure = 4.5% unverified.
    const result = withRecomputedAuditMetrics({
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: {},
      engineResponses: [...rows(21, 5), ...unverifiedRows(1)],
    });
    expect(result.metrics).toMatchObject({
      verifiedCount: 21,
      unverifiedCount: 1,
      sov: Math.round((5 / 21) * 100),
    });
    expect(auditPublicationIssue(result)).toBeNull();
    const publicMetrics = publicAuditResult(result).metrics as Record<
      string,
      unknown
    >;
    expect(publicMetrics.sov).toBe(24);
  });

  it("marks a run provisional only above 20% unverified (boundary is exclusive)", () => {
    // 8/40 = exactly 20% → published; 9/41 ≈ 22% → provisional.
    const atLimit = withRecomputedAuditMetrics({
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: {},
      engineResponses: [...rows(32, 4), ...unverifiedRows(8)],
    });
    expect(auditPublicationIssue(atLimit)).toBeNull();
    const over = withRecomputedAuditMetrics({
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: {},
      engineResponses: [...rows(32, 4), ...unverifiedRows(9)],
    });
    expect(auditPublicationIssue(over)).toBe("unverified_share");
    expect(auditPublicationStatus(over)).toBe("provisional");
  });

  it("marks a run provisional when fewer than 10 answers were adjudicated", () => {
    const nine = withRecomputedAuditMetrics({
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: {},
      engineResponses: rows(9, 3),
    });
    expect(auditPublicationIssue(nine)).toBe("insufficient_sample");
    const ten = withRecomputedAuditMetrics({
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: {},
      engineResponses: rows(10, 3),
    });
    expect(auditPublicationIssue(ten)).toBeNull();
  });

  it("keeps provisional evidence but withholds its mixed score and derived advice", () => {
    const result = withRecomputedAuditMetrics({
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: {},
      geoActions: [{ title: "Publish pages" }],
      topRecommendations: ["Publish pages"],
      regions: [{ region: "korea", score: 38 }],
      engineResponses: [...rows(15, 4), ...unverifiedRows(7)],
    });
    expect(auditPublicationStatus(result)).toBe("provisional");
    expect(isPublishableAuditResult(result)).toBe(false);
    const publicResult = publicAuditResult(result);
    const publicMetrics = publicResult.metrics as Record<string, unknown>;
    expect(publicMetrics.sov).toBeNull();
    expect(publicMetrics.enginesWithMention).toEqual([]);
    expect(publicMetrics.answerBuckets).toMatchObject({
      ai: { adjudicated: 15, unverified: 7 },
    });
    expect(publicResult.engineResponses).toHaveLength(22);
    expect(publicResult.geoActions).toEqual([]);
    expect(publicResult.topRecommendations).toEqual([]);
    expect(publicResult.regions).toBeUndefined();
  });

  it("never sends a preserved pre-revalidation result to the public", () => {
    const result = {
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: { verifiedCount: 10, unverifiedCount: 0, sov: 10 },
      revalidation: { recommendRemeasure: true, original: { secret: 1 } },
    };
    const publicResult = publicAuditResult(result);
    expect(publicResult.revalidation).toEqual({ recommendRemeasure: true });
    expect(result.revalidation.original).toEqual({ secret: 1 });
  });

  it("publishes the score when a confirmed answer mixes official and unattributed citations, restricting only citation advice", () => {
    const rawSources = [
      { domain: "indigochild.kr", url: "https://indigochild.kr/about" },
      {
        domain: "indigochild.studio",
        url: "https://indigochild.studio/about",
      },
    ];
    const result = withRecomputedAuditMetrics({
      domain: "indigochild.kr",
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: { sov: 100 },
      geoActions: [{ title: "Publish a source" }],
      engineResponses: [
        {
          engineId: "gemini",
          brandMentioned: true,
          mentionQuality: "confirmed",
          citedSources: rawSources,
        },
        ...rows(9),
      ],
    });

    expect(result.metrics).toMatchObject({
      citationAttribution: "partial",
      unattributedCitationCount: 1,
      unverifiedCount: 0,
      verifiedCount: 10,
      topCitedDomains: [{ domain: "indigochild.kr", count: 1 }],
    });
    expect(isPublishableAuditResult(result)).toBe(true);
    expect(citationPrescriptionsRestricted(result)).toBe(true);
    const publicResult = publicAuditResult(result);
    const publicMetrics = publicResult.metrics as Record<string, unknown>;
    expect(publicMetrics.sov).toBe(10);
    expect(publicMetrics.topCitedDomains).toEqual([
      { domain: "indigochild.kr", count: 1 },
    ]);
    expect(publicMetrics.citationAttribution).toBe("partial");
    expect(publicResult.engineResponses[0]?.citedSources).toEqual(rawSources);
  });

  it("recovers old skipped-verdict rows as unverified rather than confirmed absences", () => {
    const normalized = withRecomputedAuditMetrics({
      metrics: { sov: 0 },
      engineResponses: [
        {
          engineId: "perplexity",
          brandMentioned: false,
          mentionQuality: "unknown_brand",
          verdictVia: "skipped",
          errorMessage: null,
          isStub: false,
        },
        { engineId: "gemini", brandMentioned: false },
      ],
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
    });
    expect(normalized).toMatchObject({
      metrics: { sov: 0, verifiedCount: 1, unverifiedCount: 1 },
    });
    expect(hasStaleAuditPdf({ metrics: { sov: 0 } }, normalized)).toBe(true);
  });

  it("keeps Naver Briefing separate and repairs legacy sentiment", () => {
    const result = {
      domain: "official.example",
      metrics: {
        sov: 50,
        sentimentDistribution: { positive: 0, neutral: 3, negative: 0 },
      },
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      regions: [{ region: "korea", score: 99 }],
      engineResponses: [
        {
          engineId: "chatgpt",
          brandMentioned: true,
          sentiment: "positive",
          mentionPosition: 2,
          mentionListSize: 5,
          citedSources: [
            { domain: "official.example", url: "https://official.example" },
          ],
        },
        {
          engineId: "gemini",
          brandMentioned: false,
          sentiment: "negative",
          mentionPosition: 1,
          mentionListSize: 2,
          citedSources: [
            { domain: "unrelated.example", url: "https://unrelated.example" },
          ],
        },
        {
          engineId: "naver-briefing",
          brandMentioned: false,
          sentiment: "neutral",
        },
      ],
    };
    const normalized = withRecomputedAuditMetrics(result);

    expect(normalized.metrics.sov).toBe(50);
    expect(normalized.metrics).toMatchObject({
      averageMentionPosition: 2,
      sentimentDistribution: { positive: 1, neutral: 0, negative: 0 },
      topCitedDomains: [{ domain: "official.example", count: 1 }],
      enginesCovered: ["chatgpt", "gemini"],
    });
    expect(normalized).toMatchObject({ regionScoresOutdated: true });
    expect(normalized.regions).toBeUndefined();
    expect(hasStaleAuditPdf(result, normalized)).toBe(true);
  });

  // (2026-09-29) HyperCLOVA X 행(4·11·18번)은 서비스 종료로 점수 분모에서 빠진다 → 19행 기준.
  it("matches a 22-response core run even when a separate briefing is saved (retired HyperCLOVA rows excluded)", () => {
    const core = Array.from({ length: 22 }, (_, index) => ({
      engineId: [
        "chatgpt",
        "claude",
        "gemini",
        "perplexity",
        "hyperclova",
        "naver",
        "daum",
      ][index % 7],
      brandMentioned: index < 18,
      sentiment: index < 17 ? "neutral" : null,
      mentionPosition: index < 5 ? 2 : null,
      mentionListSize: index < 5 ? 4 : null,
      citedSources: [],
    }));
    const result = withRecomputedAuditMetrics({
      metrics: {
        sov: 78,
        sentimentDistribution: { positive: 0, neutral: 21, negative: 0 },
      },
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      engineResponses: [
        ...core,
        { engineId: "naver-briefing", brandMentioned: false, sentiment: null },
      ],
    });
    // 언급 16 / 19 = 84.2 → 84 (HyperCLOVA 포함이면 18/22 = 82)
    expect(result.metrics.sov).toBe(84);
    expect(result.metrics.sentimentDistribution).toEqual({
      positive: 0,
      neutral: 15,
      negative: 0,
    });
    expect(
      countMeasurementCoverage(
        result.engineResponses.filter((r) => r.engineId !== "naver-briefing")
      )
    ).toEqual({ attempted: 7, measured: 7 });
    expect(hasStaleAuditPdf({ metrics: result.metrics }, result)).toBe(false);
  });

  it("does not mark a fresh PDF or market score stale because JSON keys were reordered", () => {
    const original = {
      metrics: {
        sov: 0,
        enginesCovered: Array.from({ length: 10 }, () => "chatgpt"),
        enginesWithMention: [],
        sentimentDistribution: { neutral: 0, negative: 0, positive: 0 },
        topCitedDomains: [],
        stubCount: 0,
        averageMentionPosition: null,
      },
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      regions: [{ region: "korea", score: 0 }],
      engineResponses: Array.from({ length: 10 }, () => ({
        engineId: "chatgpt",
        brandMentioned: false,
      })),
    };
    const corrected = withRecomputedAuditMetrics(original);
    expect(hasStaleAuditPdf(original, corrected)).toBe(false);
    expect(corrected.regions).toEqual(original.regions);
    expect(corrected).not.toHaveProperty("regionScoresOutdated");
  });

  it("quarantines legacy verdicts instead of exposing their stale scores or actions", () => {
    const normalized = withRecomputedAuditMetrics({
      brandName: "TechDD",
      metrics: { sov: 23 },
      geoActions: [{ title: "방어를 강화하세요" }],
      topRecommendations: ["이미 1순위이니 방어"],
      engineResponses: [
        {
          engineId: "chatgpt",
          brandMentioned: true,
          mentionQuality: "confirmed",
          verdictVia: "llm",
          errorMessage: null,
          isStub: false,
          excerpt: "TechDD는 다른 회사입니다.",
        },
        {
          engineId: "perplexity",
          brandMentioned: true,
          mentionQuality: "confirmed",
          verdictVia: "llm",
          errorMessage: null,
          isStub: false,
          excerpt: "TechDD offers an unrelated UK service.",
        },
      ],
    });

    expect(normalized).toMatchObject({
      verificationState: "revalidation_required",
      geoActions: [],
      topRecommendations: [],
      metrics: { sov: 0, verifiedCount: 0, unverifiedCount: 2 },
    });
    expect(hasStaleAuditPdf({ metrics: { sov: 23 } }, normalized)).toBe(true);
    expect(
      normalized.engineResponses.every(
        (row) => !row.brandMentioned && row.mentionQuality === "unverified"
      )
    ).toBe(true);
    expect(withRecomputedAuditMetrics(normalized)).toEqual(normalized);
    expect(hasStaleAuditPdf(normalized, normalized)).toBe(true);
  });
});
