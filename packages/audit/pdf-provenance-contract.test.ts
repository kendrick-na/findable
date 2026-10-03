import { describe, expect, it, vi } from "vitest";
import type { AuditPdfData } from "./pdf-template";
import { isCurrentAuditPdfUrl } from "./normalize-stored-metrics";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  put: vi.fn(),
}));

vi.mock("puppeteer-core", () => ({ launch: mocks.launch }));
vi.mock("@repo/storage", () => ({ put: mocks.put }));

const pdfData = {
  brandName: "Test Brand",
  domain: "example.com",
  engineResponses: [],
  generatedAt: "2026-10-04 00:00",
  language: "en",
  metrics: {
    sov: 0,
    enginesCovered: [],
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
  },
  promptsCount: 1,
  topRecommendations: [],
} as unknown as AuditPdfData;

describe("audit PDF provenance contract", () => {
  it("passes the generated Blob URL through the current consumer contract", async () => {
    const browser = { close: vi.fn(), newPage: vi.fn() };
    const page = {
      setContent: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
    };
    browser.newPage.mockResolvedValue(page);
    mocks.launch.mockResolvedValue(browser);
    mocks.put.mockImplementation(async (path: string) => ({
      url: `https://blob.test/${path}`,
    }));

    const { generateAuditPdf } = await import("./pdf-generator");
    const result = await generateAuditPdf("job-123", pdfData);

    expect(mocks.put).toHaveBeenCalledWith(
      expect.stringMatching(/^audits\/audit-v3-job-123-\d+\.pdf$/),
      expect.any(Buffer),
      expect.objectContaining({ access: "public" })
    );
    expect(isCurrentAuditPdfUrl(result.pdfUrl)).toBe(true);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("rejects the legacy unversioned pathname at the consumer", () => {
    expect(
      isCurrentAuditPdfUrl(
        "https://blob.test/audits/audit-job-123-1700000000000.pdf"
      )
    ).toBe(false);
  });
});
