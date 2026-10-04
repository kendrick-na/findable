import { MENTION_VERDICT_VERSION } from "@repo/ai/lib/mention-verdict-version";
import { generateAuditPrompts } from "@repo/audit/audit-prompts";
import { withRecomputedAuditMetrics } from "@repo/audit/normalize-stored-metrics";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  database: {
    auditJob: { findUnique: mocks.findUnique, findMany: mocks.findMany },
  },
}));
vi.mock("@repo/observability/error", () => ({
  parseError: (error: unknown) => String(error),
}));
vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@repo/audit/stale-job", () => ({
  reconcileStaleAuditJob: vi.fn().mockResolvedValue(null),
}));
vi.mock("../app/api/audit/_lib/owner", () => ({
  resolveIsOwner: vi.fn().mockResolvedValue(false),
}));

import { GET } from "../app/api/audit/[jobId]/route";

it("discloses a changed stored metric basis even when no PDF exists", async () => {
  const jobId = "55555555-5555-4555-8555-555555555555";
  mocks.findUnique.mockResolvedValue({
    id: jobId,
    email: "synthetic@example.test",
    organizationId: null,
    status: "completed",
    domain: "example.test",
    language: "ko",
    pdfUrl: null,
    result: {
      brandName: "Synthetic",
      domain: "example.test",
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: { sov: 100, enginesCovered: ["chatgpt", "naver"] },
      engineResponses: [
        ...Array.from({ length: 10 }, () => ({
          engineId: "chatgpt",
          promptKind: "brand",
          brandMentioned: false,
          mentionQuality: "absent",
          isStub: false,
          errorMessage: null,
        })),
        {
          engineId: "naver",
          promptKind: "discovery",
          brandMentioned: true,
          mentionQuality: "confirmed",
          naverSource: "search_results",
          isStub: false,
          errorMessage: null,
        },
      ],
    },
    crewStatus: "not_requested",
    crewResult: null,
    createdAt: new Date("2026-10-03T00:00:00Z"),
    completedAt: new Date("2026-10-03T00:01:00Z"),
    errorMessage: null,
  });
  mocks.findMany.mockResolvedValue([]);

  const response = await GET(
    new Request(`https://findable.example/api/audit/${jobId}`) as never,
    { params: Promise.resolve({ jobId }) }
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.pdfOutdated).toBe(false);
  expect(body.metricBasisChanged).toBe(true);
  expect(body.result.metrics.sov).not.toBe(100);
});

it("hides a versioned PDF whose answer-level SoV is stale despite equal aggregate metrics", async () => {
  const jobId = "66666666-6666-4666-8666-666666666666";
  const corrected = withRecomputedAuditMetrics({
    brandName: "Synthetic",
    domain: "example.test",
    mentionVerdictVersion: MENTION_VERDICT_VERSION,
    metrics: { sov: 0 },
    engineResponses: Array.from({ length: 10 }, () => ({
      engineId: "chatgpt",
      promptKind: "brand",
      brandMentioned: false,
      mentionQuality: "absent",
      sov: 0,
      isStub: false,
      errorMessage: null,
    })),
  });
  mocks.findUnique.mockResolvedValue({
    id: jobId,
    email: "synthetic@example.test",
    organizationId: null,
    status: "completed",
    domain: "example.test",
    language: "ko",
    pdfUrl: `https://blob.test/audits/audit-v3-${jobId}-1.pdf`,
    result: {
      ...corrected,
      engineResponses: corrected.engineResponses.map((row, index) =>
        index === 0 ? { ...row, sov: 1 } : row
      ),
    },
    crewStatus: "not_requested",
    crewResult: null,
    createdAt: new Date("2026-10-03T00:00:00Z"),
    completedAt: new Date("2026-10-03T00:01:00Z"),
    errorMessage: null,
  });
  mocks.findMany.mockResolvedValue([]);

  const response = await GET(
    new Request(`https://findable.example/api/audit/${jobId}`) as never,
    { params: Promise.resolve({ jobId }) }
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.pdfOutdated).toBe(true);
  expect(body.pdfUrl).toBeNull();
  expect(body.metricBasisChanged).toBe(true);
});

it("withholds an old PDF when only its stored recommendations are now filtered", async () => {
  const jobId = "44444444-4444-4444-8444-444444444444";
  const result = withRecomputedAuditMetrics({
    brandName: "Synthetic",
    domain: "example.test",
    mentionVerdictVersion: MENTION_VERDICT_VERSION,
    metrics: { sov: 100 },
    engineResponses: Array.from({ length: 10 }, (_, index) => ({
      engineId: ["chatgpt", "claude", "perplexity", "gemini"][index % 4],
      brandMentioned: true,
      mentionQuality: "confirmed",
      isStub: false,
      errorMessage: null,
    })),
    geoActions: [
      {
        kind: "rank_strategy",
        title: "Legacy ranking advice",
        source: "Princeton Table 2 +115%",
      },
    ],
    topRecommendations: ["Princeton Table 2 +115% expected lift"],
  });
  mocks.findUnique.mockResolvedValue({
    id: jobId,
    email: "synthetic@example.test",
    organizationId: null,
    status: "completed",
    domain: "example.test",
    language: "ko",
    pdfUrl: "https://example.test/audits/audit-v3-advice-only.pdf",
    result,
    crewStatus: "not_requested",
    crewResult: null,
    createdAt: new Date("2026-10-03T00:00:00Z"),
    completedAt: new Date("2026-10-03T00:01:00Z"),
    errorMessage: null,
  });
  mocks.findMany.mockResolvedValue([]);

  const response = await GET(
    new Request(`https://findable.example/api/audit/${jobId}`) as never,
    { params: Promise.resolve({ jobId }) }
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.pdfUrl).toBeNull();
  expect(body.pdfOutdated).toBe(true);
  expect(body.metricBasisChanged).toBe(false);
  expect(body.adviceBasisChanged).toBe(true);
  expect(body.result.geoActions).toEqual([]);
  expect(body.result.topRecommendations).toEqual([]);
});

it("withholds PDF and crew output on the real poll route while retaining search evidence", async () => {
  const jobId = "11111111-1111-4111-8111-111111111111";
  const engineResponses = Array.from({ length: 7 }, (_, index) => [
    ...["chatgpt", "claude", "perplexity", "gemini"].map((engineId) => ({
      engineId,
      promptText: `brand-${index}`,
      promptKind: "brand",
      rawResponse: "",
      excerpt: "",
      brandMentioned: false,
      errorMessage: "ENGINE_TIMEOUT",
      isStub: false,
    })),
    ...["naver", "daum"].map((engineId) => ({
      engineId,
      promptText: `brand-${index}`,
      promptKind: "brand",
      rawResponse: "synthetic search result",
      excerpt: "synthetic search result",
      brandMentioned: false,
      mentionQuality: "absent",
      errorMessage: null,
      isStub: false,
    })),
  ]).flat();
  mocks.findUnique.mockResolvedValue({
    id: jobId,
    email: "synthetic@example.test",
    organizationId: null,
    status: "completed",
    domain: "example.test",
    language: "ko",
    pdfUrl: "https://example.test/old-report.pdf",
    result: {
      brandName: "Synthetic",
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: { sov: 50 },
      engineResponses,
      geoActions: [{ title: "unsafe advice" }],
      topRecommendations: ["unsafe recommendation"],
    },
    crewStatus: "completed",
    crewResult: { analysts: [{ text: "unsafe" }] },
    createdAt: new Date("2026-10-03T00:00:00Z"),
    completedAt: new Date("2026-10-03T00:01:00Z"),
    errorMessage: null,
  });
  mocks.findMany.mockResolvedValue([]);

  const response = await GET(
    new Request(`https://findable.example/api/audit/${jobId}`) as never,
    { params: Promise.resolve({ jobId }) }
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.pdfUrl).toBeNull();
  expect(body.crewResult).toBeNull();
  expect(body.result.metrics.sov).toBeNull();
  expect(body.result.metrics.answerBuckets.ai.adjudicated).toBe(0);
  expect(body.result.metrics.answerBuckets.search.adjudicated).toBe(14);
  expect(body.result.engineResponses).toHaveLength(42);
  expect(body.result.geoActions).toEqual([]);
  expect(body.result.topRecommendations).toEqual([]);
});

it("does not expose a blended provisional score for eight brand AI answers plus search", async () => {
  const jobId = "22222222-2222-4222-8222-222222222222";
  const aiRows = Array.from({ length: 8 }, (_, index) => ({
    engineId: "chatgpt",
    promptText: `brand-${index}`,
    promptKind: "brand",
    rawResponse: "synthetic AI answer",
    brandMentioned: false,
    mentionQuality: "absent",
    errorMessage: null,
    isStub: false,
  }));
  const searchRows = Array.from({ length: 7 }, (_, index) =>
    ["naver", "daum"].map((engineId) => ({
      engineId,
      ...(engineId === "naver"
        ? {
            naverSource: "search_results",
            naverSamplingVersion: "interleave-v1",
          }
        : {}),
      promptText: `brand-${index}`,
      promptKind: "brand",
      rawResponse: "synthetic search result",
      brandMentioned: false,
      mentionQuality: "absent",
      errorMessage: null,
      isStub: false,
    }))
  ).flat();
  mocks.findUnique.mockResolvedValue({
    id: jobId,
    email: "synthetic@example.test",
    organizationId: null,
    status: "completed",
    domain: "example.test",
    language: "ko",
    pdfUrl: "https://example.test/old-report.pdf",
    result: {
      brandName: "Synthetic",
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: { sov: 50 },
      engineResponses: [...aiRows, ...searchRows],
      geoActions: [{ title: "unsafe advice" }],
    },
    crewStatus: "completed",
    crewResult: { analysts: [{ text: "unsafe" }] },
    createdAt: new Date("2026-10-03T00:00:00Z"),
    completedAt: new Date("2026-10-03T00:01:00Z"),
    errorMessage: null,
  });
  mocks.findMany.mockResolvedValue([]);

  const response = await GET(
    new Request(`https://findable.example/api/audit/${jobId}`) as never,
    { params: Promise.resolve({ jobId }) }
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.pdfUrl).toBeNull();
  expect(body.crewResult).toBeNull();
  expect(body.result.metrics.sov).toBeNull();
  expect(body.result.metrics.answerBuckets.ai.adjudicated).toBe(8);
  expect(body.result.metrics.answerBuckets.search.adjudicated).toBe(14);
  expect(body.result.engineResponses).toHaveLength(22);
  expect(
    body.result.engineResponses.filter(
      (row: { engineId: string }) => row.engineId === "naver"
    )
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ naverSamplingVersion: "interleave-v1" }),
    ])
  );
  expect(body.result.geoActions).toEqual([]);
});

it("keeps a fully answered free fallback run publishable on the poll route", async () => {
  const jobId = "33333333-3333-4333-8333-333333333333";
  const prompts = generateAuditPrompts({ ko: "샘플", en: "Sample" }, "both");
  const engineResponses = prompts.flatMap((prompt) => [
    ...["chatgpt", "claude", "perplexity", "gemini"].map((engineId) => ({
      engineId,
      promptText: prompt.text,
      promptKind: "brand",
      rawResponse: "synthetic AI answer",
      brandMentioned: false,
      mentionQuality: "absent",
      errorMessage: null,
      isStub: false,
    })),
    ...(prompt.lang === "ko"
      ? ["naver", "daum"].map((engineId) => ({
          engineId,
          promptText: prompt.text,
          promptKind: "brand",
          rawResponse: "synthetic search result",
          brandMentioned: false,
          mentionQuality: "absent",
          errorMessage: null,
          isStub: false,
        }))
      : []),
  ]);
  mocks.findUnique.mockResolvedValue({
    id: jobId,
    email: "synthetic@example.test",
    organizationId: null,
    status: "completed",
    domain: "example.test",
    language: "both",
    pdfUrl:
      "https://example.test/audits/audit-v3-33333333-3333-4333-8333-333333333333-1.pdf",
    result: withRecomputedAuditMetrics({
      brandName: "샘플",
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
      metrics: { sov: 0 },
      engineResponses,
    }),
    crewStatus: "not_requested",
    crewResult: null,
    createdAt: new Date("2026-10-03T00:00:00Z"),
    completedAt: new Date("2026-10-03T00:01:00Z"),
    errorMessage: null,
  });
  mocks.findMany.mockResolvedValue([]);

  const response = await GET(
    new Request(`https://findable.example/api/audit/${jobId}`) as never,
    { params: Promise.resolve({ jobId }) }
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.pdfUrl).toContain("/audits/audit-v3-");
  expect(body.result.metrics.answerBuckets.ai.adjudicated).toBe(16);
  expect(body.result.metrics.sov).toBeTypeOf("number");
  expect(body.result.engineResponses).toHaveLength(20);
});
