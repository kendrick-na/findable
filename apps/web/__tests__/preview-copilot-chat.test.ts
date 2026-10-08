/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The audit copilot chat streams a paid LLM answer. On Vercel Preview it must
// answer with a fixed text before touching the database or the provider.
const h = vi.hoisted(() => ({
  streamCopilotResponse: vi.fn(),
  isCopilotConfigured: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@repo/ai/lib/crew", () => ({
  isCopilotConfigured: h.isCopilotConfigured,
  streamCopilotResponse: h.streamCopilotResponse,
}));
vi.mock("@repo/database", () => ({
  database: { auditJob: { findUnique: h.findUnique } },
}));
vi.mock("@repo/audit/crew-display-filter", () => ({
  sanitizeStoredCrewResult: (v: unknown) => v,
}));
vi.mock("@repo/audit/normalize-stored-metrics", () => ({
  isPublishableAuditResult: () => true,
  withRecomputedAuditMetrics: (v: unknown) => v,
}));
vi.mock("../app/api/audit/_lib/owner", () => ({
  resolveIsOwner: () => Promise.resolve(true),
}));
vi.mock("../app/api/audit/_lib/public-access", () => ({
  canExposeAuditResult: () => true,
}));

import { POST } from "../app/api/audit/[jobId]/chat/route";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const call = () =>
  POST(
    new Request(`https://web.test/api/audit/${JOB_ID}/chat`, {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "안녕" }] }),
    }) as never,
    { params: Promise.resolve({ jobId: JOB_ID }) }
  );

beforeEach(() => {
  for (const fn of Object.values(h)) {
    fn.mockReset();
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("audit copilot chat", () => {
  it("returns a fixed stub on Preview without DB or AI, even with no provider key", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    h.isCopilotConfigured.mockReturnValue(false);
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("[미리보기 환경]");
    expect(await call().then((r) => r.text())).toBe(text);
    expect(h.findUnique).not.toHaveBeenCalled();
    expect(h.streamCopilotResponse).not.toHaveBeenCalled();
  });

  it("still validates the request body on Preview", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await POST(
      new Request(`https://web.test/api/audit/${JOB_ID}/chat`, {
        method: "POST",
        body: JSON.stringify({ messages: [] }),
      }) as never,
      { params: Promise.resolve({ jobId: JOB_ID }) }
    );
    expect(res.status).toBe(400);
    expect(h.streamCopilotResponse).not.toHaveBeenCalled();
  });

  it("streams the real copilot on production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    h.isCopilotConfigured.mockReturnValue(true);
    h.findUnique.mockResolvedValue({
      id: JOB_ID,
      email: null,
      organizationId: null,
      crewStatus: "completed",
      crewResult: { analysts: [], strategist: {} },
      result: { brandName: "B", domain: "b.test" },
    });
    h.streamCopilotResponse.mockReturnValue(new Response("live"));
    const res = await call();
    expect(await res.text()).toBe("live");
    expect(h.streamCopilotResponse).toHaveBeenCalledTimes(1);
  });
});
