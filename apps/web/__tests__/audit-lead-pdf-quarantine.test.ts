import { MENTION_VERDICT_VERSION } from "@repo/ai/lib/mention-verdict-version";
import { withRecomputedAuditMetrics } from "@repo/audit/normalize-stored-metrics";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createLead: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  database: {
    auditJob: { findUnique: mocks.findUnique },
    lead: { create: mocks.createLead },
  },
}));
vi.mock("@repo/email", () => ({
  resend: { emails: { send: mocks.sendEmail } },
}));
vi.mock("@repo/email/templates/audit-report", () => ({
  AuditReportEmail: (props: unknown) => ({ props }),
}));
vi.mock("@repo/auth/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: null, orgId: null }),
  currentUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@repo/observability/error", () => ({
  parseError: (error: unknown) => String(error),
}));
vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "../app/api/audit/[jobId]/lead/route";

it("does not email an old PDF when its stored recommendations are now filtered", async () => {
  const jobId = "55555555-5555-4555-8555-555555555555";
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
    email: "synthetic@example.test",
    organizationId: null,
    result,
    pdfUrl: "https://example.test/old-report.pdf",
    crewResult: null,
    status: "completed",
  });
  mocks.createLead.mockResolvedValue({});
  mocks.sendEmail.mockResolvedValue({ data: { id: "synthetic-send-id" } });

  const response = await POST(
    new Request(`https://findable.example/api/audit/${jobId}/lead`, {
      method: "POST",
      body: JSON.stringify({ email: "recipient@example.com" }),
    }),
    { params: Promise.resolve({ jobId }) }
  );
  const body = await response.json();
  const emailProps = mocks.sendEmail.mock.calls[0]?.[0]?.react?.props as {
    pdfUrl?: string;
  };

  expect(response.status).toBe(200);
  expect(body.emailSent).toBe(true);
  expect(emailProps.pdfUrl).toBeUndefined();
});

it("emails only successfully measured AI/search sources, not failed attempts", async () => {
  vi.clearAllMocks();
  const jobId = "66666666-6666-4666-8666-666666666666";
  const result = withRecomputedAuditMetrics({
    brandName: "Synthetic",
    domain: "example.test",
    mentionVerdictVersion: MENTION_VERDICT_VERSION,
    metrics: { sov: 0 },
    engineResponses: [
      ...Array.from({ length: 10 }, () => ({
        engineId: "chatgpt",
        brandMentioned: false,
        mentionQuality: "unknown_brand",
        isStub: false,
        errorMessage: null,
      })),
      {
        engineId: "naver",
        brandMentioned: true,
        mentionQuality: "confirmed",
        isStub: false,
        errorMessage: null,
      },
      {
        engineId: "perplexity",
        brandMentioned: false,
        mentionQuality: "unknown_brand",
        isStub: false,
        errorMessage: "429",
      },
    ],
    geoActions: [],
    topRecommendations: [],
  });
  mocks.findUnique.mockResolvedValue({
    email: "synthetic@example.test",
    organizationId: null,
    result,
    pdfUrl: null,
    crewResult: null,
    status: "completed",
  });
  mocks.createLead.mockResolvedValue({});
  mocks.sendEmail.mockResolvedValue({ data: { id: "synthetic-send-id" } });

  const response = await POST(
    new Request(`https://findable.example/api/audit/${jobId}/lead`, {
      method: "POST",
      body: JSON.stringify({ email: "recipient@example.com" }),
    }),
    { params: Promise.resolve({ jobId }) }
  );
  const emailProps = mocks.sendEmail.mock.calls[0]?.[0]?.react?.props as {
    enginesMentioned?: number;
    enginesTotal?: number;
  };
  expect(response.status).toBe(200);
  expect(emailProps).toMatchObject({ enginesMentioned: 1, enginesTotal: 2 });
});
