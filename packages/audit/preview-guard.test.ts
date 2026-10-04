import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Paid or external side effects without a stub must refuse on Vercel Preview
// before touching Chromium, Blob, the crew LLMs or the briefing crawler.
const h = vi.hoisted(() => {
  const paid = (name: string) =>
    vi.fn((..._args: unknown[]) => Promise.reject(new Error(`PAID: ${name}`)));
  return {
    put: paid("blob put"),
    chromium: paid("chromium"),
    puppeteer: paid("puppeteer launch"),
    runCrewDiagnose: paid("runCrewDiagnose"),
    queryAllEngines: paid("queryAllEngines"),
    resolveBrandIdentity: paid("resolveBrandIdentity"),
    update: vi.fn((_args: unknown) => Promise.resolve({})),
    findUnique: vi.fn((_args: unknown) => Promise.resolve(null)),
    logError: vi.fn(),
  };
});

vi.mock("@repo/storage", () => ({ put: h.put }));
vi.mock("@sparticuz/chromium", () => ({
  default: { executablePath: h.chromium, args: [] },
}));
vi.mock("puppeteer-core", () => ({ default: { launch: h.puppeteer } }));
vi.mock("@repo/ai/lib/crew", () => ({ runCrewDiagnose: h.runCrewDiagnose }));
vi.mock("@repo/ai/lib/brand-identity", () => ({
  resolveBrandIdentity: h.resolveBrandIdentity,
}));
vi.mock("@repo/ai/lib/engines", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  queryAllEngines: h.queryAllEngines,
}));
vi.mock("@repo/database", () => ({
  database: {
    auditJob: {
      update: h.update,
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      findUnique: h.findUnique,
    },
  },
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: h.logError },
}));

import { runBriefingForAuditJob } from "./briefing-runner";
import { runCrewForAuditJob } from "./crew-runner";
import { generateAuditPdf } from "./pdf-generator";
import { assertNotVercelPreview, isVercelPreview } from "./preview-guard";

const paidSpies = () => [
  h.put,
  h.chromium,
  h.puppeteer,
  h.runCrewDiagnose,
  h.queryAllEngines,
  h.resolveBrandIdentity,
];

beforeEach(() => {
  for (const spy of paidSpies()) {
    spy.mockClear();
  }
  h.update.mockClear();
  h.logError.mockClear();
  vi.stubEnv("VERCEL_ENV", "preview");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("preview guard", () => {
  it("only matches VERCEL_ENV=preview", () => {
    expect(isVercelPreview({ VERCEL_ENV: "preview" })).toBe(true);
    expect(isVercelPreview({ VERCEL_ENV: "production" })).toBe(false);
    expect(isVercelPreview({ VERCEL_ENV: "development" })).toBe(false);
    expect(isVercelPreview({})).toBe(false);
    expect(() =>
      assertNotVercelPreview("x", { VERCEL_ENV: "preview" })
    ).toThrow("x is disabled on Vercel Preview deployments");
    expect(() =>
      assertNotVercelPreview("x", { VERCEL_ENV: "production" })
    ).not.toThrow();
  });

  it("refuses PDF render and Blob upload on Preview", async () => {
    await expect(
      generateAuditPdf("job-1", {} as never, undefined)
    ).rejects.toThrow("disabled on Vercel Preview");
    expect(h.put).not.toHaveBeenCalled();
    expect(h.chromium).not.toHaveBeenCalled();
    expect(h.puppeteer).not.toHaveBeenCalled();
  });

  it("fails crew deep analysis on Preview without calling the crew LLMs", async () => {
    await runCrewForAuditJob({ jobId: "job-1" });
    expect(h.runCrewDiagnose).not.toHaveBeenCalled();
    // Refused before the Job is even marked processing.
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.logError).toHaveBeenCalledWith("audit.crew.failed", {
      jobId: "job-1",
      error: expect.stringContaining("disabled on Vercel Preview"),
    });
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ crewStatus: "failed" }),
      })
    );
  });

  it("fails the Naver briefing on Preview without any crawl or LLM call", async () => {
    await expect(
      runBriefingForAuditJob({ jobId: "job-1", attemptId: "attempt-1" })
    ).resolves.toBe("failed");
    expect(h.queryAllEngines).not.toHaveBeenCalled();
    expect(h.resolveBrandIdentity).not.toHaveBeenCalled();
    expect(h.logError).toHaveBeenCalledWith("audit.briefing.failed", {
      jobId: "job-1",
      error: expect.stringContaining("disabled on Vercel Preview"),
    });
  });
});
