/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 네이버·다음 검색 API 결과는 어떤 LLM 에도 넣지 않는다(2026-10-07 👤 대표 결정 · 검색 API 약관).
// 코파일럿 챗은 저장된 결과로 시스템 프롬프트를 만든다 — 저장된 metrics.topCitedDomains 는
// 검색 결과 링크 도메인까지 섞여 있으므로 그대로 나가면 안 된다.
const h = vi.hoisted(() => ({
  streamCopilotResponse: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@repo/ai/lib/crew", () => ({
  isCopilotConfigured: () => true,
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

import { buildCopilotSystemPrompt } from "@repo/ai/lib/crew/copilot";
import { POST } from "../app/api/audit/[jobId]/chat/route";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const SEARCH_MARKERS = [
  "naver-only-domain.example",
  "daum-only-domain.example",
  "NAVER_TITLE_MARKER",
  "NAVER_RAW_BODY_MARKER",
];

beforeEach(() => {
  h.streamCopilotResponse.mockReset();
  h.findUnique.mockReset();
  vi.stubEnv("VERCEL_ENV", "production");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("audit copilot chat — search API rows", () => {
  it("builds the LLM context without naver/daum domains or text", async () => {
    h.findUnique.mockResolvedValue({
      id: JOB_ID,
      email: null,
      organizationId: null,
      crewStatus: "completed",
      crewResult: { analysts: [], strategist: { displayName: "준호" } },
      result: {
        brandName: "인디고차일드",
        domain: "indigochild.kr",
        engineResponses: [
          {
            engineId: "naver",
            rawResponse: "NAVER_RAW_BODY_MARKER",
            citedSources: [
              {
                domain: "naver-only-domain.example",
                title: "NAVER_TITLE_MARKER",
              },
            ],
          },
          {
            engineId: "daum",
            citedSources: [{ domain: "daum-only-domain.example" }],
          },
          {
            engineId: "chatgpt",
            citedSources: [{ domain: "indigochild.kr" }],
          },
        ],
        metrics: {
          sov: 40,
          enginesCovered: ["naver", "daum", "chatgpt"],
          enginesWithMention: ["naver", "chatgpt"],
          topCitedDomains: [
            { domain: "naver-only-domain.example", count: 3 },
            { domain: "daum-only-domain.example", count: 2 },
            { domain: "indigochild.kr", count: 1 },
          ],
        },
      },
    });
    h.streamCopilotResponse.mockReturnValue(new Response("live"));

    const res = await POST(
      new Request(`https://web.test/api/audit/${JOB_ID}/chat`, {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "요약" }] }),
      }) as never,
      { params: Promise.resolve({ jobId: JOB_ID }) }
    );
    expect(res.status).toBe(200);
    expect(h.streamCopilotResponse).toHaveBeenCalledTimes(1);

    const ctx = h.streamCopilotResponse.mock.calls[0]?.[0];
    const systemPrompt = buildCopilotSystemPrompt(ctx);
    for (const marker of SEARCH_MARKERS) {
      expect(systemPrompt).not.toContain(marker);
    }
    expect(systemPrompt).toContain("indigochild.kr(1)");
  });
});
