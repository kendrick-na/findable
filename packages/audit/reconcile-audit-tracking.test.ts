import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const executeRawUnsafe = vi.fn();
const persistAuditTracking = vi.fn();
const organizationFindUnique = vi.fn(async () => ({ id: "org-1" }));

vi.mock("@repo/database", () => ({
  database: {
    auditJob: { findUnique },
    $executeRawUnsafe: executeRawUnsafe,
    organization: { findUnique: organizationFindUnique },
    engine: {
      findMany: vi.fn(async () => [
        { id: "chatgpt" },
        { id: "claude" },
        { id: "perplexity" },
      ]),
    },
  },
}));
vi.mock("./tracking", async () => ({
  persistAuditTracking,
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { reconcileAuditTracking } = await import("./reconcile-audit-tracking");

describe("reconcileAuditTracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps briefing outside the core replay axis", async () => {
    findUnique.mockResolvedValue({
      status: "completed",
      organizationId: "org-1",
      brandId: "brand-1",
      completedAt: new Date("2026-10-04T00:00:00Z"),
      result: {
        briefingStatus: "completed",
        briefingPrompt: "브랜드 효과",
        engineResponses: [
          {
            engineId: "naver-briefing",
            excerpt: "saved briefing",
            brandMentioned: true,
            isStub: false,
            errorMessage: null,
          },
        ],
      },
      postprocessing: { tracking: "completed", briefing: "not_required" },
    });

    await expect(reconcileAuditTracking("job-briefing-crash")).resolves.toBe(
      "skipped"
    );
    expect(persistAuditTracking).not.toHaveBeenCalled();
  });

  it("replays only keyed completed snapshots and advances the marker conditionally", async () => {
    findUnique.mockResolvedValue({
      status: "completed",
      organizationId: "org-1",
      brandId: "brand-1",
      completedAt: new Date("2026-10-04T00:00:00Z"),
      result: {
        engineResponses: [
          {
            engineId: "chatgpt",
            promptIndex: 0,
            promptText: "브랜드 추천",
            promptLang: "ko",
            trackingInputCaptured: true,
            rawResponse: "result",
            citedSources: [],
            brandMentioned: true,
            isStub: false,
            errorMessage: null,
            shareOfVoice: 1,
          },
        ],
      },
      postprocessing: { tracking: "unknown" },
    });
    persistAuditTracking.mockResolvedValue("completed");
    executeRawUnsafe.mockResolvedValue(1);

    await expect(reconcileAuditTracking("job-1")).resolves.toBe("completed");
    expect(persistAuditTracking).toHaveBeenCalledWith(
      expect.objectContaining({
        auditJobId: "job-1",
        trackingAxis: "core",
        tagged: [expect.objectContaining({ promptIndex: 0 })],
      })
    );
    expect(executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("postprocessing"),
      "job-1",
      expect.any(String),
      expect.any(String),
      expect.any(String),
      3
    );
    expect(executeRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("trackingReconcileToken"),
      "job-1",
      expect.any(String),
      "completed",
      3
    );
  });

  it("🔴 재생은 저장된 result.cost 를 그대로 쓴다 — 현재 단가로 재가격하지 않는다(v1 소급 금지)", async () => {
    const row = (engineId: string, promptIndex: number) => ({
      engineId,
      promptIndex,
      promptText: `질문${promptIndex}`,
      promptLang: "ko",
      trackingInputCaptured: true,
      rawResponse: "result",
      citedSources: [],
      brandMentioned: true,
      isStub: false,
      errorMessage: null,
      shareOfVoice: 1,
      usage: { costModel: "token", inputTokens: 100, outputTokens: 1000 },
    });
    findUnique.mockResolvedValue({
      status: "completed",
      organizationId: "org-1",
      brandId: "brand-1",
      completedAt: new Date("2026-09-01T00:00:00Z"),
      result: {
        // v1 회차(costModelVersion 없음) — chatgpt output 이 $10 로 기록됐던 시절.
        cost: {
          totalKrw: 30,
          perEngine: [
            { engineId: "chatgpt", krw: 14.15, basis: "token" },
            { engineId: "gemini", krw: 0, basis: "free" },
            { engineId: "claude", krw: 9.9, basis: "token" },
          ],
        },
        engineResponses: [
          row("chatgpt", 0),
          { ...row("gemini", 0), promptKind: "discovery" },
          row("claude", 1),
          // perEngine 에 대응 항목이 없는 행 → 「미측정」(null), 현재 단가로 채우지 않는다.
          row("perplexity", 1),
        ],
      },
      postprocessing: { tracking: "unknown" },
    });
    persistAuditTracking.mockResolvedValue("completed");
    executeRawUnsafe.mockResolvedValue(1);

    await reconcileAuditTracking("job-v1");
    const { tagged } = persistAuditTracking.mock.calls[0]?.[0] as {
      tagged: { engineId: string; storedCost: unknown }[];
    };
    expect(tagged.map((t) => [t.engineId, t.storedCost])).toEqual([
      ["chatgpt", { krw: 14.15, basis: "token" }],
      // discovery 행은 걸러져도 인덱스 정렬이 유지된다(claude = perEngine[2]).
      ["claude", { krw: 9.9, basis: "token" }],
      ["perplexity", null],
    ]);
  });

  it("finalizes a nothing-to-write replay as not_applicable instead of retrying", async () => {
    findUnique.mockResolvedValue({
      status: "completed",
      organizationId: "org-1",
      brandId: "brand-1",
      completedAt: new Date("2026-10-04T00:00:00Z"),
      result: {
        engineResponses: [
          {
            engineId: "chatgpt",
            promptIndex: 0,
            promptText: "브랜드 추천",
            promptLang: "ko",
            trackingInputCaptured: true,
            rawResponse: "result",
            citedSources: [],
            brandMentioned: true,
            isStub: false,
            errorMessage: null,
            shareOfVoice: 1,
          },
        ],
      },
      postprocessing: { tracking: "failed" },
    });
    persistAuditTracking.mockResolvedValue("not_applicable");
    executeRawUnsafe.mockResolvedValue(1);

    await expect(reconcileAuditTracking("job-empty")).resolves.toBe("skipped");
    expect(executeRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("trackingReconcileToken"),
      "job-empty",
      expect.any(String),
      "not_applicable",
      3
    );
  });

  it("does not guess keys for legacy snapshots", async () => {
    findUnique.mockResolvedValue({
      status: "completed",
      organizationId: "org-1",
      brandId: "brand-1",
      completedAt: new Date("2026-10-04T00:00:00Z"),
      result: { engineResponses: [{ engineId: "chatgpt", promptText: "old" }] },
      postprocessing: { tracking: "unknown" },
    });
    await expect(reconcileAuditTracking("legacy-job")).resolves.toBe("skipped");
    expect(persistAuditTracking).not.toHaveBeenCalled();
  });

  it.each([
    "skipped",
    "not_applicable",
    "completed",
    undefined,
  ])("does not replay a job whose durable marker is %s", async (tracking) => {
    findUnique.mockResolvedValue({
      status: "completed",
      organizationId: "org-1",
      brandId: "brand-1",
      completedAt: new Date("2026-10-04T00:00:00Z"),
      postprocessing: tracking ? { tracking } : null,
      result: {
        engineResponses: [
          {
            engineId: "chatgpt",
            promptIndex: 0,
            promptText: "브랜드 추천",
            promptLang: "ko",
            trackingInputCaptured: true,
          },
        ],
      },
    });
    await expect(reconcileAuditTracking("job-marker")).resolves.toBe("skipped");
    expect(persistAuditTracking).not.toHaveBeenCalled();
  });

  it("does not write when the pending-to-reconciling claim loses a race", async () => {
    findUnique.mockResolvedValue({
      status: "completed",
      organizationId: "org-1",
      brandId: "brand-1",
      completedAt: new Date("2026-10-04T00:00:00Z"),
      postprocessing: { tracking: "pending" },
      result: { engineResponses: [] },
    });
    executeRawUnsafe.mockResolvedValue(0);
    await expect(reconcileAuditTracking("job-raced")).resolves.toBe("skipped");
    expect(persistAuditTracking).not.toHaveBeenCalled();
  });

  it("best-effort finalizes a classifier exception without masking a second DB failure", async () => {
    findUnique.mockResolvedValue({
      status: "completed",
      organizationId: "org-1",
      brandId: "brand-1",
      completedAt: new Date("2026-10-04T00:00:00Z"),
      postprocessing: { tracking: "pending" },
      result: {
        engineResponses: [
          {
            engineId: "chatgpt",
            promptIndex: 0,
            promptText: "브랜드 추천",
            promptLang: "ko",
            trackingInputCaptured: true,
            rawResponse: "result",
            brandMentioned: true,
            isStub: false,
            errorMessage: null,
          },
        ],
      },
    });
    executeRawUnsafe
      .mockReset()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error("finalize DB unavailable"));
    organizationFindUnique.mockRejectedValueOnce(
      new Error("classification DB unavailable")
    );
    await expect(reconcileAuditTracking("job-db-down")).resolves.toBe("failed");
    expect(executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(persistAuditTracking).not.toHaveBeenCalled();
  });
});
