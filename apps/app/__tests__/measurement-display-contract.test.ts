import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderAuditPdfHtml } from "@repo/audit/pdf-template";
import { describe, expect, it } from "vitest";
import {
  buildTrackingDashboardData,
  extractEngineCoverage,
} from "../app/(authenticated)/lib/dashboard-data";

const rows = [
  {
    engineId: "chatgpt",
    brandMentioned: true,
    errorMessage: null,
    isStub: false,
    promptKind: "brand",
  },
  {
    engineId: "chatgpt",
    brandMentioned: false,
    errorMessage: null,
    isStub: false,
    promptKind: "discovery",
  },
  {
    engineId: "perplexity",
    brandMentioned: false,
    errorMessage: "429",
    isStub: false,
    promptKind: "brand",
  },
  {
    engineId: "perplexity",
    brandMentioned: false,
    errorMessage: "timeout",
    isStub: false,
    promptKind: "discovery",
  },
  {
    engineId: "naver",
    brandMentioned: true,
    errorMessage: null,
    isStub: false,
    promptKind: "brand",
  },
  {
    engineId: "naver",
    brandMentioned: true,
    errorMessage: null,
    isStub: false,
    promptKind: "discovery",
  },
  {
    engineId: "daum",
    brandMentioned: false,
    errorMessage: null,
    isStub: false,
    promptKind: "brand",
  },
  {
    engineId: "daum",
    brandMentioned: false,
    errorMessage: null,
    isStub: false,
    promptKind: "discovery",
  },
] as const;

describe("W0-3a mixed AI/search and failed-engine display", () => {
  it("Tracking keeps its existing 67% mixed-channel value and three successful engines", () => {
    const trackedAt = new Date("2026-10-03T00:00:00Z");
    const data = buildTrackingDashboardData(
      rows
        .filter((row) => row.promptKind === "brand" && !row.errorMessage)
        .map((row) => ({
          brand: { name: "Example", domain: "example.com" },
          brandId: "brand-1",
          brandMentioned: row.brandMentioned,
          engineId: row.engineId,
          trackedAt,
        }))
    );
    expect(data?.latestSov).toBe(67);
    expect(data?.coverage).toEqual({ mentioned: 2, total: 3 });
  });
  it("dashboard KPI does not call mixed-engine coverage AI-only", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(authenticated)/components/dashboard-kpis.tsx"),
      "utf8"
    );
    expect(source).toMatch(/측정한 AI·검색 \$\{coverage\.total\}곳/);
  });
  it("history and persistent headers identify their stored mixed-channel rate", () => {
    for (const path of [
      "app/(authenticated)/history/[jobId]/page.tsx",
      "app/(authenticated)/components/header.tsx",
      "app/(authenticated)/components/header-metric-context.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source).toContain("AI·검색 등장률");
      expect(source).not.toContain("AI 답변 등장률");
    }
  });
  it("fallback coverage counts only engines with a successful row", () => {
    const coverage = extractEngineCoverage({
      metrics: {
        enginesCovered: rows
          .filter((row) => row.promptKind === "brand")
          .map((row) => row.engineId),
        enginesWithMention: ["chatgpt", "naver"],
      },
      engineResponses: rows,
    } as never);
    expect(coverage).toEqual({ mentioned: 2, total: 3 });
  });

  it("does not call attempted engines measured when legacy rows are missing", () => {
    expect(
      extractEngineCoverage({
        metrics: {
          enginesCovered: ["chatgpt", "perplexity", "naver", "daum"],
          enginesWithMention: ["chatgpt", "naver"],
        },
      } as never)
    ).toBeNull();
  });

  it("fallback coverage follows the existing scored-prompt population", () => {
    const coverage = extractEngineCoverage({
      metrics: {
        enginesCovered: ["chatgpt", "naver", "daum"],
        enginesWithMention: ["naver"],
      },
      engineResponses: [
        { engineId: "chatgpt", promptKind: "brand", errorMessage: "429" },
        { engineId: "chatgpt", promptKind: "discovery", errorMessage: null },
        { engineId: "naver", promptKind: "brand", errorMessage: null },
        { engineId: "daum", promptKind: "brand", errorMessage: null },
      ],
    } as never);
    expect(coverage).toEqual({ mentioned: 1, total: 2 });
  });

  it("PDF distinguishes AI answers, search exposure, and an unavailable engine", () => {
    const html = renderAuditPdfHtml({
      brandName: "Example",
      domain: "example.com",
      generatedAt: "2026-10-03",
      language: "ko",
      promptsCount: 2,
      topRecommendations: [],
      metrics: {
        sov: 67,
        enginesCovered: rows
          .filter((row) => row.promptKind === "brand")
          .map((row) => row.engineId),
        enginesWithMention: ["chatgpt", "naver"],
        errors: [{ engineId: "perplexity", message: "429" }],
        stubCount: 0,
        verifiedCount: 3,
        unverifiedCount: 0,
        averageMentionListSize: null,
        averageMentionPosition: null,
        averageRelativePosition: null,
        citationAttribution: "none_observed",
        sentimentDistribution: { positive: 0, neutral: 0, negative: 0 },
        topCitedDomains: [],
        unattributedCitationCount: 0,
      },
      engineResponses: rows.map((row) => ({
        ...row,
        mentionPosition: null,
        sentiment: null,
        sov: null,
        durationMs: 1,
        excerpt: "",
      })),
    });
    expect(html).toContain(
      "브랜드 질문 기준 AI 답변 1곳 · 검색 노출 2곳 · 미측정 1곳"
    );
    expect(html).toContain("언급 엔진 (AI·검색)");
    expect(html).toContain('2<span class="unit">/3</span>');
    expect(html).toContain('67<span class="unit">/100</span>');
    expect(html).toContain("검색 노출 포함");
  });
});
