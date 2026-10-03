import { beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.fn();
const launch = vi.fn();

vi.mock("@repo/storage", () => ({ put }));
vi.mock("puppeteer-core", () => ({ launch }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));

const pdfData = {
  brandName: "Test Brand",
  domain: "example.com",
  engineResponses: [],
  generatedAt: "2026-10-04 00:00",
  language: "en" as const,
  metrics: {
    sov: 0,
    enginesCovered: [],
    enginesWithMention: [],
    averageMentionListSize: null,
    averageMentionPosition: null,
    averageRelativePosition: null,
    citationAttribution: "none_observed" as const,
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
};

describe("PDF abort cleanup contract", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "");
  });

  it("does not start browser work when already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("deadline", "AbortError"));
    const { generateAuditPdf } = await import("./pdf-generator");

    await expect(
      generateAuditPdf("job-pre-aborted", pdfData, controller.signal)
    ).rejects.toThrow("deadline");
    expect(launch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("closes the browser and skips upload when page work is aborted", async () => {
    let releaseContent!: () => void;
    const browser = { close: vi.fn(), newPage: vi.fn() };
    const page = {
      setContent: vi.fn(
        () => new Promise<void>((resolve) => (releaseContent = resolve))
      ),
      evaluate: vi.fn(),
      pdf: vi.fn(),
    };
    browser.newPage.mockResolvedValue(page);
    launch.mockResolvedValue(browser);
    const { generateAuditPdf } = await import("./pdf-generator");
    const controller = new AbortController();
    const pending = generateAuditPdf("job-page-aborted", pdfData, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort(new DOMException("deadline", "AbortError"));

    await expect(pending).rejects.toThrow("deadline");
    expect(browser.close).toHaveBeenCalledOnce();
    expect(put).not.toHaveBeenCalled();
    releaseContent?.();
  });

  it("closes a browser that finishes launching after abort", async () => {
    let releaseLaunch!: (browser: { close: ReturnType<typeof vi.fn> }) => void;
    const browser = { close: vi.fn() };
    launch.mockReturnValue(
      new Promise((resolve) => {
        releaseLaunch = resolve;
      })
    );
    const { generateAuditPdf } = await import("./pdf-generator");
    const controller = new AbortController();
    const pending = generateAuditPdf("job-late-launch", pdfData, controller.signal);
    await Promise.resolve();
    controller.abort(new DOMException("deadline", "AbortError"));
    await expect(pending).rejects.toThrow("deadline");

    releaseLaunch(browser);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(browser.close).toHaveBeenCalledOnce();
  });
});
