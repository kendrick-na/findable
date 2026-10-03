import { MENTION_VERDICT_VERSION } from "@repo/ai/lib/mention-verdict-version";
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
