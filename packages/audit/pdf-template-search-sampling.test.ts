import { describe, expect, it } from "vitest";
import { type AuditPdfData, renderAuditPdfHtml } from "./pdf-template";
import {
  searchSamplingLabel,
  searchSamplingVersionOf,
} from "./search-sampling-version";

type Row = AuditPdfData["engineResponses"][number];

const row = (engineId: string, extra: Partial<Row> = {}): Row => ({
  engineId,
  brandMentioned: true,
  mentionPosition: null,
  sentiment: null,
  sov: null,
  durationMs: 0,
  isStub: false,
  errorMessage: null,
  excerpt: "",
  promptKind: "brand",
  ...extra,
});

const pdf = (engineResponses: Row[]): AuditPdfData => ({
  brandName: "Example",
  domain: "example.com",
  engineResponses,
  generatedAt: "2026-10-05 00:00",
  language: "ko",
  metrics: {
    sov: 50,
    enginesCovered: engineResponses.map((r) => r.engineId),
    enginesWithMention: [],
    averageMentionListSize: null,
    averageMentionPosition: null,
    averageRelativePosition: null,
    citationAttribution: "none_observed",
    errors: [],
    sentimentDistribution: { positive: 0, neutral: 0, negative: 0 },
    stubCount: 0,
    topCitedDomains: [],
    unattributedCitationCount: 0,
    unverifiedCount: 0,
    verifiedCount: 0,
  } as unknown as AuditPdfData["metrics"],
  promptsCount: 1,
  topRecommendations: [],
});

const LABEL_RE =
  /<p class="sampling-note" data-testid="search-sampling-label">([^<]*)<\/p>/;

describe("audit PDF search-sampling label (W1)", () => {
  it("labels a v2 (interleave-v1) run with the shared label, next to the search figures", () => {
    const data = pdf([
      row("chatgpt"),
      row("naver", {
        naverSource: "search_results",
        naverSamplingVersion: "interleave-v1",
      }),
    ]);
    const html = renderAuditPdfHtml(data);
    const label = searchSamplingLabel(searchSamplingVersionOf(data), true);
    expect(label).toBe("검색 표본 v2 · 블로그·뉴스·웹문서 교차");
    expect(html.match(LABEL_RE)?.[1]).toBe(
      `${label} — 표본 방식이 다른 회차와는 검색 노출을 비교하지 않습니다.`
    );
    // Rendered right after the subtitle that carries "검색 노출 N곳".
    const subtitleEnd = html.indexOf("측정 언어 한국어</p>");
    expect(subtitleEnd).toBeGreaterThan(-1);
    expect(html.indexOf('class="sampling-note"')).toBeGreaterThan(subtitleEnd);
    expect(html.indexOf('class="sampling-note"')).toBeLessThan(
      html.indexOf('class="scorecard"')
    );
  });

  it("labels an unmarked Naver run as v1 (previous method)", () => {
    const html = renderAuditPdfHtml(pdf([row("naver")]));
    expect(html.match(LABEL_RE)?.[1]).toContain("검색 표본 v1 · 이전 방식");
  });

  it("labels a run whose Naver rows disagree as mixed", () => {
    const html = renderAuditPdfHtml(
      pdf([
        row("naver", {
          naverSource: "search_results",
          naverSamplingVersion: "interleave-v1",
        }),
        row("naver"),
      ])
    );
    expect(html.match(LABEL_RE)?.[1]).toContain("검색 표본 혼재 · 비교 제외");
  });

  it("omits the label when the run has no Naver search row", () => {
    const html = renderAuditPdfHtml(pdf([row("chatgpt")]));
    expect(html).not.toMatch(LABEL_RE);
    expect(html).not.toContain("검색 표본");
  });

  it("escapes an unknown version string", () => {
    const html = renderAuditPdfHtml(
      pdf([
        row("naver", {
          naverSource: "search_results",
          naverSamplingVersion: "<b>x</b>",
        }),
      ])
    );
    expect(html).toContain("검색 표본 &lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });
});
