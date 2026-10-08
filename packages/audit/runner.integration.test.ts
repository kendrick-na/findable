import { beforeEach, describe, expect, it, vi } from "vitest";

const auditJobUpdate = vi.fn();
const auditJobUpdateMany = vi.fn();
const auditJobFindUnique = vi.fn();
const executeRawUnsafe = vi.fn();
const queryPromptsSequentially = vi.fn();
const queryAllEngines = vi.fn();
const aggregateAudit = vi.fn();
const verifyMentions = vi.fn();
const persistAuditTracking = vi.fn();
const runBriefingForAuditJob = vi.fn();
const generateAuditPrompts = vi.fn();
const generateAuditPdf = vi.fn();
const keys = vi.fn();
const promptFindMany = vi.fn();
const transaction = vi.fn();
// Any access to the W1 ledger tables through the root client is recorded so the
// flag-off contract ("never touches PromptAttempt before the migration") is provable.
const ledgerTableAccess = vi.fn();
const realContracts = vi.hoisted(() => ({ enabled: false }));
const resolveDemandDiscovery = vi.fn();
const resolveShadowPlanV2 = vi.fn();
let briefingEnabled = false;
const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

vi.mock("@repo/database", () => ({
  database: {
    auditJob: {
      update: auditJobUpdate,
      updateMany: auditJobUpdateMany,
      findUnique: auditJobFindUnique,
    },
    $executeRawUnsafe: executeRawUnsafe,
    $transaction: transaction,
    brand: { findUnique: vi.fn() },
    prompt: { findMany: promptFindMany, create: vi.fn(), upsert: vi.fn() },
    get promptAttempt() {
      ledgerTableAccess("promptAttempt");
      return {};
    },
    get promptAttemptReset() {
      ledgerTableAccess("promptAttemptReset");
      return {};
    },
  },
}));
vi.mock("@repo/observability/log", () => ({ log }));
vi.mock("@repo/observability/error", () => ({
  parseError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
vi.mock("@repo/ai/lib/brand-identity", () => ({
  resolveBrandIdentity: vi.fn(async () => ({
    brandName: "Test Brand",
    brandVariants: [],
  })),
}));
vi.mock("@repo/ai/lib/brand-aliases", () => ({
  englishPromptName: vi.fn(() => "Test Brand"),
  officialSiteAliases: vi.fn(() => []),
}));
vi.mock("./official-site-identity", () => ({
  mergeCustomerIdentity: vi.fn((site: unknown) => site),
  registeredBrandIdentityFallback: vi.fn(() => ({ title: "Test Brand" })),
  resolveOfficialSiteIdentity: vi.fn(async () => ({ title: "Test Brand" })),
}));
vi.mock("@repo/ai/lib/engines", () => ({
  NAVER_SEARCH_SAMPLING_VERSION: "interleave-v1",
  chatgptEngineSetKey: () => undefined,
  aggregateAudit,
  auditCost: vi.fn(() => ({
    costModelVersion: 2,
    totalKrw: 0,
    measuredEngines: 0,
    perEngine: [],
  })),
  partitionCitedSources: vi.fn(() => ({
    attributedResponses: [],
    unattributedCitationCount: 0,
  })),
  queryAllEngines,
}));
vi.mock("@repo/ai/lib/mention-verdict", () => ({
  MENTION_VERDICT_VERSION: 2,
  verifyMentions,
}));
vi.mock("./audit-prompts", () => ({
  classifySavedPromptKind: () => "brand",
  englishPromptName: vi.fn(() => "Test Brand"),
  generateAuditPrompts,
  generateDiscoveryPrompts: vi.fn(() => []),
  siteCategoryTerms: vi.fn(() => []),
}));
vi.mock("./shadow-plan-v2", async () => ({
  ...(await vi.importActual<typeof import("./shadow-plan-v2")>(
    "./shadow-plan-v2"
  )),
  resolveShadowPlanV2,
}));
vi.mock("./prompt-query-scheduler", async () =>
  realContracts.enabled
    ? await vi.importActual("./prompt-query-scheduler")
    : { queryPromptsSequentially }
);
vi.mock("./tracking", () => ({
  persistAuditTracking,
  tagCoreResponses: (
    responsesByPrompt: unknown[][],
    prompts: Array<{
      text: string;
      lang: "ko" | "en";
      kind?: "brand" | "discovery";
    }>
  ) =>
    responsesByPrompt.flatMap((responses, promptIndex) =>
      responses.map((response) => ({
        ...(response as Record<string, unknown>),
        promptIndex,
        promptText: prompts[promptIndex]?.text ?? "",
        promptLang: prompts[promptIndex]?.lang ?? "ko",
        promptKind: prompts[promptIndex]?.kind ?? "brand",
      }))
    ),
}));
vi.mock("./briefing-runner", () => ({ runBriefingForAuditJob }));
vi.mock("./demand-run-prompts", () => ({
  DEMAND_PROMPTS_TIMEOUT_MS: 15_000,
  resolveDemandDiscovery,
}));
vi.mock("./pdf-generator", () => ({ generateAuditPdf }));
vi.mock("./keys", () => ({ keys }));
vi.mock("./normalize-stored-metrics", async () =>
  realContracts.enabled
    ? await vi.importActual("./normalize-stored-metrics")
    : { isPublishableAuditResult: vi.fn(() => false) }
);
vi.mock("./actions", () => ({
  actionsToStrings: vi.fn(() => []),
  buildGeoActions: vi.fn(() => []),
}));
vi.mock("./action-rules", () => ({
  hasCompleteNaverSearchBaseline: vi.fn(() => false),
  summarizeVerdicts: vi.fn(() => ({})),
}));
vi.mock("./answer-buckets", () => ({
  answerShareOfVoice: vi.fn(() => null),
  classifyAnswer: vi.fn(() => "other"),
  isDiscoveryAnswer: vi.fn(() => false),
  summarizeAnswerBuckets: vi.fn(() => ({})),
}));
vi.mock("./market-scope", () => ({
  REGION_LABEL: { global: "Global", korea: "Korea" },
  filterByLanguageRegion: vi.fn(() => []),
  inferMarketScope: vi.fn(() => ({
    confidence: "high",
    reason: "test",
    scope: "global",
  })),
}));
vi.mock("./geo-score", () => ({ geoAxisScores: vi.fn(() => ({ total: 0 })) }));
vi.mock("./run-budget", async () =>
  realContracts.enabled
    ? await vi.importActual("./run-budget")
    : {
        AUDIT_RUN_TIME_BUDGET_MS: 270_000,
        AUDIT_MIN_NEXT_PROMPT_BUDGET_MS: 1,
        AUDIT_BRIEFING_WORST_CASE_MS: 180_000,
        AUDIT_PDF_WORST_CASE_MS: 30_000,
        createAuditRunBudget: vi.fn(() => ({
          invocationStartedAtMs: 0,
          stopStartingAtMs: Number.MAX_SAFE_INTEGER,
          signal: new AbortController().signal,
          hasBudgetFor: () => true,
          hasPostProcessingBudget: () => true,
          dispose: vi.fn(),
        })),
      }
);

const response = (engineId = "chatgpt") => ({
  engineId,
  rawResponse: "Test Brand is mentioned.",
  brandMentioned: true,
  mentionPosition: 1,
  mentionListSize: 1,
  sentiment: "neutral",
  citedSources: [],
  shareOfVoice: 1,
  errorMessage: null,
  durationMs: 1,
  isStub: false,
});

const input = {
  brandId: "brand-1",
  domain: "example.com",
  jobId: "job-1",
  language: "en" as const,
  organizationId: "org-1",
};

const loadRunner = async () => (await import("./runner")).runAuditJob;
const terminalCalls = () =>
  [...auditJobUpdate.mock.calls, ...auditJobUpdateMany.mock.calls]
    .map(([call]) => call)
    .filter((call) => call.data?.status === "completed");

beforeEach(() => {
  vi.resetAllMocks();
  briefingEnabled = false;
  keys.mockImplementation(() => ({
    AUDIT_BRIEFING_IN_MAIN_ENABLED: briefingEnabled,
    AUDIT_DUAL_WRITE_ENABLED: true,
  }));
  generateAuditPrompts.mockReturnValue([
    { text: "q1", lang: "en", kind: "brand" },
    { text: "q2", lang: "en", kind: "brand" },
    { text: "q3", lang: "en", kind: "brand" },
    { text: "q4", lang: "en", kind: "brand" },
  ]);
  aggregateAudit.mockReturnValue({
    sov: 0,
    enginesWithMention: [],
    averageMentionListSize: null,
    averageMentionPosition: null,
    answerBuckets: {
      ai: { total: 1, adjudicated: 1, unverified: 0 },
      search: { total: 0, adjudicated: 0, unverified: 0 },
      briefing: { total: 0, adjudicated: 0, unverified: 0 },
      retired: { total: 0, adjudicated: 0, unverified: 0 },
    },
  });
  queryPromptsSequentially.mockImplementation(async (prompts, query) =>
    Promise.all(
      prompts.map((prompt: unknown, index: number) => query(prompt, index))
    )
  );
  queryAllEngines.mockResolvedValue([response()]);
  verifyMentions.mockImplementation(async (rows: unknown[]) =>
    rows.map((row) => ({
      ...(row as Record<string, unknown>),
      mentionQuality: "confirmed",
      verdictVia: "rule",
    }))
  );
  persistAuditTracking.mockResolvedValue("persisted");
  auditJobUpdate.mockResolvedValue({});
  auditJobFindUnique.mockResolvedValue({
    checkpoint: null,
    createdAt: new Date(0),
  });
  executeRawUnsafe.mockResolvedValue(1);
  auditJobUpdateMany.mockImplementation(async (args) => {
    await auditJobUpdate(args);
    return { count: 1 };
  });
});

describe("runAuditJob offline lifecycle contracts", () => {
  // Runs first: later cases swap scheduler/budget modules with vi.doMock.
  describe("W1 prompt attempt ledger flag", () => {
    const savedPrompts = [
      { id: "prompt-a", text: "saved a", language: "en", trackings: [] },
      { id: "prompt-b", text: "saved b", language: "en", trackings: [] },
    ];
    const savedCheckpointPrompts = () =>
      auditJobUpdate.mock.calls
        .map(([call]) => call?.data?.checkpoint?.prompts)
        .find(Array.isArray) as Record<string, unknown>[] | undefined;

    it("flag off (default): never touches the ledger tables or transactions and stores no promptId", async () => {
      promptFindMany.mockResolvedValue(savedPrompts);
      const runAuditJob = await loadRunner();

      await runAuditJob(input);

      expect(ledgerTableAccess).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
      expect(terminalCalls().length).toBeGreaterThan(0);
      const prompts = savedCheckpointPrompts();
      expect(prompts?.map((prompt) => prompt.text)).toEqual([
        "saved a",
        "saved b",
      ]);
      expect(prompts?.some((prompt) => "promptId" in prompt)).toBe(false);
    });

    it("flag on: reserves, starts and finishes each saved question inside fenced transactions", async () => {
      keys.mockImplementation(() => ({
        AUDIT_BRIEFING_IN_MAIN_ENABLED: false,
        AUDIT_DUAL_WRITE_ENABLED: true,
        PROMPT_ATTEMPT_LEDGER_ENABLED: true,
      }));
      promptFindMany.mockResolvedValue(savedPrompts);
      const sql: string[] = [];
      const createMany = vi.fn(() => Promise.resolve({ count: 2 }));
      const tx = {
        $executeRaw: vi.fn((strings: TemplateStringsArray) => {
          sql.push(strings.join("?"));
          return Promise.resolve(1);
        }),
        $queryRaw: vi.fn(() => Promise.resolve([{ id: input.jobId }])),
        auditJob: {
          findMany: vi.fn(() => Promise.resolve([])),
          updateMany: auditJobUpdateMany,
        },
        promptAttempt: {
          findMany: vi.fn(() => Promise.resolve([])),
          createMany,
        },
        promptAttemptReset: { findMany: vi.fn(async () => []) },
      };
      transaction.mockImplementation(
        async (fn: (client: typeof tx) => unknown) => fn(tx)
      );
      queryPromptsSequentially.mockImplementation(
        async (
          prompts: unknown[],
          query: (prompt: unknown, index: number) => Promise<unknown>,
          options: { onCompleted?: (all: unknown[]) => Promise<void> }
        ) => {
          const results: unknown[] = [];
          for (const [index, prompt] of prompts.entries()) {
            results.push(await query(prompt, index));
            await options.onCompleted?.([...results]);
          }
          return results;
        }
      );
      const runAuditJob = await loadRunner();

      await runAuditJob(input);

      expect(ledgerTableAccess).not.toHaveBeenCalled();
      expect(createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ promptId: "prompt-a", planIndex: 0 }),
          expect.objectContaining({ promptId: "prompt-b", planIndex: 1 }),
        ],
      });
      expect(
        savedCheckpointPrompts()?.map((prompt) => prompt.promptId)
      ).toEqual(["prompt-a", "prompt-b"]);
      expect(sql.filter((text) => text.includes('"startedAt" ='))).toHaveLength(
        2
      );
      expect(
        sql.filter((text) => text.includes('"finishedAt" ='))
      ).toHaveLength(2);
      expect(terminalCalls().length).toBeGreaterThan(0);
    });
  });

  describe("QUESTION_PLAN_V2_SHADOW (question plan v2, shadow only)", () => {
    const shadowPrompt = (text: string, type: "A" | "E") => ({
      kind: type === "E" ? "brand" : "discovery",
      lang: "en",
      text,
      planV2: {
        type,
        market: "US",
        engineSetKey: "daily-noclaude-v1",
        provenance: {
          keyword: type === "A" ? "pdrn serum" : null,
          volume: type === "A" ? 22_200 : null,
          source: type === "A" ? "google" : "registration",
          expanded: false,
        },
      },
    });
    const shadowPlan = {
      prompts: [
        shadowPrompt("What's the best PDRN serum?", "A"),
        shadowPrompt("What is Test Brand, and what do they sell?", "E"),
      ],
      checkpoint: {
        questionPlanVersion: 2,
        engineSetKey: "daily-noclaude-v1",
        startIndex: 8,
        questionCount: 2,
        maxContinuations: 3,
        createdAt: "2026-10-07T00:00:00.000Z",
        measurementContext: {
          questionPlanVersion: 2,
          engineSetKey: "daily-noclaude-v1",
          usedInScores: false,
        },
      },
    };
    const shadowInput = { ...input, continueWhenTruncated: true };

    it("flag off (default): never plans or runs v2 questions", async () => {
      vi.stubEnv("QUESTION_PLAN_V2_SHADOW", "");
      vi.stubEnv("QUESTION_PLAN_V2_SHADOW_BRANDS", "brand-1");
      await (await loadRunner())(shadowInput);
      expect(resolveShadowPlanV2).not.toHaveBeenCalled();
      expect(queryAllEngines).toHaveBeenCalledTimes(4);
      expect(JSON.stringify(terminalCalls())).not.toContain("shadowPlanV2");
      vi.unstubAllEnvs();
    });

    it("needs the brand on the allowlist (empty list = nobody)", async () => {
      vi.stubEnv("QUESTION_PLAN_V2_SHADOW", "true");
      vi.stubEnv("QUESTION_PLAN_V2_SHADOW_BRANDS", "");
      await (await loadRunner())(shadowInput);
      expect(resolveShadowPlanV2).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it("runs v2 after the current set, stores it separately, and never touches scores or Tracking", async () => {
      vi.stubEnv("QUESTION_PLAN_V2_SHADOW", "true");
      vi.stubEnv("QUESTION_PLAN_V2_SHADOW_BRANDS", "brand-1");
      resolveShadowPlanV2.mockResolvedValue(shadowPlan);
      await (await loadRunner())(shadowInput);

      // 4 current questions + 2 shadow questions, in that order.
      expect(queryAllEngines).toHaveBeenCalledTimes(6);
      expect(queryAllEngines.mock.calls[3]?.[1]).toEqual([
        "chatgpt",
        "claude",
        "perplexity",
        "gemini",
      ]);
      // daily-noclaude-v1: the shadow questions skip Claude.
      expect(queryAllEngines.mock.calls[4]?.[1]).toEqual([
        "chatgpt",
        "perplexity",
        "gemini",
      ]);
      // Scores are aggregated from the current set only.
      expect(aggregateAudit.mock.calls[0]?.[0]).toHaveLength(4);
      // Tracking gets the current set only.
      const tracked = persistAuditTracking.mock.calls[0]?.[0]?.tagged ?? [];
      expect(tracked).toHaveLength(4);
      expect(JSON.stringify(tracked)).not.toContain("PDRN");

      const result = terminalCalls().at(-1)?.data?.result;
      expect(result.promptsCount).toBe(4);
      expect(result.engineResponses).toHaveLength(4);
      expect(JSON.stringify(result.engineResponses)).not.toContain("PDRN");
      expect(result.shadowPlanV2).toMatchObject({
        questionPlanVersion: 2,
        engineSetKey: "daily-noclaude-v1",
        usedInScores: false,
        measurementContext: {
          questionPlanVersion: 2,
          questionsPlanned: 2,
          questionsAnswered: 2,
          verification: "verified",
        },
      });
      expect(
        result.shadowPlanV2.questions.map((q: { text: string }) => q.text)
      ).toEqual([
        "What's the best PDRN serum?",
        "What is Test Brand, and what do they sell?",
      ]);
      expect(result.cost).toHaveProperty("shadowPlanV2Krw");
      // The main measurement context does not claim plan v2 / a new engine set.
      expect(result.measurementContext.questionPlanVersion).toBeUndefined();
      expect(result.measurementContext.engineSetKey).toBeUndefined();
      // The saved plan carries the real split point and plan-sized continuation cap.
      const saved = auditJobUpdate.mock.calls
        .map(([call]) => call?.data?.checkpoint)
        .find((cp) => cp?.shadowPlanV2);
      expect(saved?.shadowPlanV2).toMatchObject({
        startIndex: 4,
        questionCount: 2,
        maxContinuations: 2,
      });
      vi.unstubAllEnvs();
    });
  });

  describe("MEASUREMENT_DEMAND_PROMPTS flag", () => {
    const savedPrompts = [
      { id: "prompt-a", text: "saved a", language: "en", trackings: [] },
    ];
    const demand = {
      market: "US",
      topic: "제품 추천",
      keyword: "pdrn serum",
      volume: 22_200,
      source: "google",
      expanded: false,
    };
    const checkpointPrompts = () =>
      auditJobUpdate.mock.calls
        .map(([call]) => call?.data?.checkpoint?.prompts)
        .find(Array.isArray) as Record<string, unknown>[] | undefined;

    it("flag off (default): never collects demand data; prompts unchanged", async () => {
      vi.stubEnv("MEASUREMENT_DEMAND_PROMPTS", "");
      promptFindMany.mockResolvedValue(savedPrompts);
      await (await loadRunner())(input);
      expect(resolveDemandDiscovery).not.toHaveBeenCalled();
      expect(checkpointPrompts()?.map((p) => p.text)).toEqual(["saved a"]);
      expect(JSON.stringify(terminalCalls())).not.toContain("promptDemand");
      vi.unstubAllEnvs();
    });

    it("flag on: fills only the discovery slot and stores provenance", async () => {
      vi.stubEnv("MEASUREMENT_DEMAND_PROMPTS", "true");
      promptFindMany.mockResolvedValue(savedPrompts);
      resolveDemandDiscovery.mockResolvedValue({
        prompts: [
          {
            kind: "discovery",
            lang: "en",
            text: "What's the best PDRN serum?",
            demand,
          },
        ],
        set: { version: 1, questions: { KR: [], US: [] } },
      });
      await (await loadRunner())(input);
      expect(resolveDemandDiscovery).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 2, language: "en", scope: "global" })
      );
      expect(checkpointPrompts()?.map((p) => p.text)).toEqual([
        "saved a",
        "What's the best PDRN serum?",
      ]);
      const stored = JSON.stringify(terminalCalls());
      expect(stored).toContain('"promptDemand"');
      expect(stored).toContain('"demandQuestionSet"');
      vi.unstubAllEnvs();
    });
  });

  it("fails a zero-prompt run before completed storage", async () => {
    generateAuditPrompts.mockReturnValue([]);
    const runAuditJob = await loadRunner();

    await runAuditJob(input);

    expect(auditJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      })
    );
    expect(auditJobUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed" }),
      })
    );
  });

  it("stores partial raw answers without Tracking and marks recovery as unimplemented", async () => {
    queryPromptsSequentially.mockResolvedValue([[response()], [response()]]);
    const runAuditJob = await loadRunner();

    await runAuditJob(input);

    const completed = terminalCalls()[0];
    expect(completed.data.result.engineResponses).toHaveLength(2);
    // 원가모델 v2: 저장되는 result.cost 에 규칙 버전이 실려야 일일 점검이 전/후를 가른다.
    expect(completed.data.result.cost.costModelVersion).toBe(2);
    expect(completed.data.postprocessing).toMatchObject({
      tracking: "pending",
      pdf: "skipped",
    });
    expect(persistAuditTracking).toHaveBeenCalled();
  });

  it("stores the ChatGPT web shadow and engine-set marker without touching the scored fields", async () => {
    const shadow = {
      outcome: "ok",
      text: "web answer",
      citations: [],
      brandMentioned: false,
      durationMs: 5,
      error: null,
      creditsUsed: 1,
      comparison: { mentionAgreement: false, citationOverlap: null },
    };
    queryPromptsSequentially.mockResolvedValue([
      [
        {
          ...response(),
          shadowChatgptWeb: shadow,
          usage: {
            inputTokens: null,
            outputTokens: null,
            costModel: "credit",
            source: "web",
            chatgptEngineSet: "chatgpt-web-v1",
          },
        },
      ],
      [response()],
    ]);
    const runAuditJob = await loadRunner();

    await runAuditJob(input);

    const rows = terminalCalls()[0].data.result.engineResponses;
    expect(rows[0]).toMatchObject({
      engineId: "chatgpt",
      brandMentioned: true,
      shadowChatgptWeb: shadow,
      chatgptEngineSet: "chatgpt-web-v1",
    });
    // Second chatgpt row has no marker in its usage; flags are off in this run → stays legacy.
    expect(rows[1].chatgptEngineSet).toBeUndefined();
    expect(rows[1].shadowChatgptWeb).toBeUndefined();
  });

  it("does not overwrite a completed job when Tracking fails after commit", async () => {
    persistAuditTracking.mockResolvedValue("failed");
    const runAuditJob = await loadRunner();

    await runAuditJob(input);

    expect(auditJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed" }),
      })
    );
    expect(auditJobUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      })
    );
    expect(executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('"postprocessing"'),
      "tracking",
      "failed",
      input.jobId,
      "pending"
    );
  });

  it("records a nothing-to-write Tracking outcome as not_applicable, not failed", async () => {
    persistAuditTracking.mockResolvedValue("not_applicable");
    const runAuditJob = await loadRunner();

    await runAuditJob(input);

    expect(executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('"postprocessing"'),
      "tracking",
      "not_applicable",
      input.jobId,
      "pending"
    );
    expect(executeRawUnsafe).not.toHaveBeenCalledWith(
      expect.stringContaining('"postprocessing"'),
      "tracking",
      "failed",
      input.jobId,
      "pending"
    );
  });

  it("commits AuditJob completed before entering the Tracking persistence boundary", async () => {
    const events: string[] = [];
    // biome-ignore lint/suspicious/useAwait: mock stands in for an async Prisma/engine API and must return a Promise
    auditJobUpdate.mockImplementation(async ({ data }) => {
      if (data?.status === "completed") {
        events.push("audit-completed");
      }
      return {};
    });
    // biome-ignore lint/suspicious/useAwait: mock stands in for an async Prisma/engine API and must return a Promise
    persistAuditTracking.mockImplementation(async () => {
      events.push("tracking-persist-start");
      return "persisted";
    });

    const runAuditJob = await loadRunner();
    await runAuditJob(input);

    expect(events).toEqual(["audit-completed", "tracking-persist-start"]);
    // This is an ordering characterization, not a SIGKILL or durable replay
    // proof. A crash between these events leaves the Tracking boundary open.
  });

  it("keeps completed status when a post-commit hook throws", async () => {
    briefingEnabled = true;
    persistAuditTracking.mockRejectedValue(new Error("tracking unavailable"));
    const runAuditJob = await loadRunner();

    await runAuditJob(input);

    expect(auditJobUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      })
    );
    expect(runBriefingForAuditJob).not.toHaveBeenCalled();
  });

  it("never starts paid briefing automatically even with the flag on and budget available", async () => {
    briefingEnabled = true;
    const runAuditJob = await loadRunner();

    await runAuditJob(input);

    expect(terminalCalls()[0].data.postprocessing.briefing).toBe(
      "not_required"
    );
    expect(runBriefingForAuditJob).not.toHaveBeenCalled();
  });

  it("does not start automatic briefing when the Tracking marker write fails", async () => {
    briefingEnabled = true;
    executeRawUnsafe.mockRejectedValue(new Error("marker unavailable"));
    const runAuditJob = await loadRunner();

    await runAuditJob(input);

    expect(runBriefingForAuditJob).not.toHaveBeenCalled();
    expect(auditJobUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      })
    );
  });

  it("keeps the on-demand briefing state unrequested", async () => {
    briefingEnabled = false;
    const runAuditJob = await loadRunner();

    await runAuditJob(input);

    const completed = terminalCalls()[0];
    expect(completed.data.postprocessing.briefing).toBe("not_required");
    expect(completed.data.result.briefingStatus).toBe("not_requested");
    expect(runBriefingForAuditJob).not.toHaveBeenCalled();
  });

  it("stores the real scheduler partial contract as provisional publication", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    realContracts.enabled = true;
    vi.resetModules();
    vi.setSystemTime(0);
    vi.doMock("./prompt-query-scheduler", () =>
      vi.importActual("./prompt-query-scheduler")
    );
    vi.doMock("./run-budget", () => vi.importActual("./run-budget"));
    vi.doMock("./normalize-stored-metrics", () =>
      vi.importActual("./normalize-stored-metrics")
    );
    vi.doMock("./answer-buckets", () => vi.importActual("./answer-buckets"));
    aggregateAudit.mockReturnValue({
      sov: 0,
      enginesWithMention: [],
      averageMentionListSize: null,
      averageMentionPosition: null,
      answerBuckets: {
        ai: { total: 1, adjudicated: 1, unverified: 0 },
        search: { total: 0, adjudicated: 0, unverified: 0 },
        briefing: { total: 0, adjudicated: 0, unverified: 0 },
        retired: { total: 0, adjudicated: 0, unverified: 0 },
      },
    });
    try {
      briefingEnabled = true;
      // biome-ignore lint/suspicious/useAwait: mock stands in for an async Prisma/engine API and must return a Promise
      queryAllEngines.mockImplementation(async () => {
        // The first real scheduler batch completes late enough that the next
        // question cannot safely start (270s deadline, 35s minimum budget).
        vi.advanceTimersByTime(240_000);
        return [response()];
      });
      const runAuditJob = await loadRunner();

      await runAuditJob(input);

      const completed = terminalCalls()[0];
      // Only the first question ran: the runner now hands its 270s budget to
      // the scheduler (before 2026-10-06 it did not, so all 4 ran here).
      expect(completed.data.result.engineResponses).toHaveLength(1);
      expect(completed.data.result.measurementContext).toMatchObject({
        identityGrounded: true,
      });
      expect(executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('"postprocessing"'),
        "tracking",
        "persisted",
        input.jobId,
        "pending"
      );
      expect(completed.data.postprocessing.briefing).toBe("not_required");
      expect(runBriefingForAuditJob).not.toHaveBeenCalled();

      const {
        auditPublicationIssue,
        auditPublicationStatus,
        withRecomputedAuditMetrics,
      } = await import("./normalize-stored-metrics");
      const publicationResult = withRecomputedAuditMetrics(
        completed.data.result
      );
      // 3 planned brand questions never started → the run says so explicitly.
      expect(auditPublicationIssue(publicationResult)).toBe(
        "incomplete_execution"
      );
      expect(auditPublicationStatus(publicationResult)).toBe("provisional");
    } finally {
      realContracts.enabled = false;
      vi.useRealTimers();
    }
  });

  it("does not await an unbounded PDF past the shared 270s deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    realContracts.enabled = true;
    vi.resetModules();
    vi.doMock("./prompt-query-scheduler", () => ({
      queryPromptsSequentially: async (
        prompts: Array<{ text: string; lang: "en" }>,
        query: (
          prompt: { text: string; lang: "en" },
          index: number
        ) => Promise<unknown>
      ) => [await query(prompts[0], 0)],
    }));
    vi.doMock("./run-budget", () => vi.importActual("./run-budget"));
    vi.doMock("./normalize-stored-metrics", () => ({
      isPublishableAuditResult: () => true,
    }));
    // biome-ignore lint/suspicious/useAwait: mock stands in for an async Prisma/engine API and must return a Promise
    queryAllEngines.mockImplementation(async () => {
      // One completed prompt leaves 51s before the 270s internal deadline;
      // the real scheduler then stops before starting another prompt.
      vi.advanceTimersByTime(219_000);
      return [response()];
    });
    generateAuditPdf.mockImplementation(
      (_jobId: string, _data: unknown, signal?: AbortSignal) =>
        new Promise((resolve) =>
          setTimeout(() => {
            expect(signal?.aborted).toBe(true);
            resolve({ pdfUrl: "local://pdf", pdfSize: 1 });
          }, 100_000)
        )
    );

    let settled = false;
    try {
      const runAuditJob = await loadRunner();
      const run = runAuditJob(input).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(219_000);
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(51_000);
      expect(generateAuditPdf).toHaveBeenCalled();
      expect(generateAuditPdf.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
      expect((generateAuditPdf.mock.calls[0][2] as AbortSignal).aborted).toBe(
        true
      );
      // The desired contract is bounded completion at the internal deadline;
      // the runner's PDF timeout must win before the 100s fake render resolves.
      expect(settled).toBe(true);
      await vi.advanceTimersByTimeAsync(100_000);
      await run;
    } finally {
      realContracts.enabled = false;
      vi.useRealTimers();
    }
  });

  it("bounds an unknown final commit without failed, Tracking, or PDF writes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    realContracts.enabled = true;
    vi.resetModules();
    vi.doMock("./prompt-query-scheduler", () => ({
      queryPromptsSequentially: async (
        prompts: Array<{ text: string; lang: "en" }>,
        query: (
          prompt: { text: string; lang: "en" },
          index: number
        ) => Promise<unknown>
      ) => [await query(prompts[0], 0)],
    }));
    vi.doMock("./run-budget", () => vi.importActual("./run-budget"));
    vi.doMock("./normalize-stored-metrics", () => ({
      isPublishableAuditResult: () => true,
    }));
    vi.doMock("./answer-buckets", () => vi.importActual("./answer-buckets"));
    generateAuditPrompts.mockReturnValue([
      { text: "q1", lang: "en", kind: "brand" },
      { text: "q2", lang: "en", kind: "brand" },
      { text: "q3", lang: "en", kind: "brand" },
      { text: "q4", lang: "en", kind: "brand" },
    ]);
    queryAllEngines.mockResolvedValue([response()]);

    let finalCommitStarted = false;
    let _lateCommitSettled = false;
    // biome-ignore lint/suspicious/useAwait: mock stands in for an async Prisma/engine API and must return a Promise
    auditJobUpdate.mockImplementation(async ({ data }) => {
      if (data?.status === "completed") {
        finalCommitStarted = true;
        // Model a database response that arrives after the internal deadline.
        // A safe runner may return `unknown` at the deadline, but cannot claim
        // that this write did or did not commit until the database responds.
        return new Promise((resolve) =>
          setTimeout(() => {
            _lateCommitSettled = true;
            resolve({});
          }, 300_000)
        );
      }
      return {};
    });

    let runPromise: Promise<void> | undefined;
    try {
      const runAuditJob = await loadRunner();
      let settled = false;
      runPromise = runAuditJob(input).finally(() => {
        settled = true;
      });
      for (let i = 0; i < 100 && !finalCommitStarted; i += 1) {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(finalCommitStarted).toBe(true);

      await vi.advanceTimersByTimeAsync(270_000);
      // The runner returns with an explicit unknown outcome. It must not
      // compete with the delayed commit by writing failed or post-processing.
      expect(settled).toBe(true);
      expect(auditJobUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "failed" }),
        })
      );
      expect(persistAuditTracking).not.toHaveBeenCalled();
      expect(generateAuditPdf).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(
        "audit.job.commit_unknown",
        expect.objectContaining({ jobId: input.jobId })
      );
    } finally {
      // Resolve the delayed DB operation so this bounded-unknown test cannot leave an
      // orphaned promise or unhandled rejection behind.
      await vi.advanceTimersByTimeAsync(300_000);
      await runPromise;
      realContracts.enabled = false;
      vi.useRealTimers();
    }
  });

  it("does not publish or post-process when conditional completion matches zero rows", async () => {
    auditJobUpdateMany.mockImplementation(async (args) => {
      await auditJobUpdate(args);
      return { count: args.data?.status === "completed" ? 0 : 1 };
    });
    const runAuditJob = await loadRunner();

    await runAuditJob(input);

    expect(auditJobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: input.jobId,
          status: "processing",
          leaseToken: expect.any(String),
        }),
      })
    );
    expect(persistAuditTracking).not.toHaveBeenCalled();
    expect(generateAuditPdf).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      "audit.job.commit_not_committed",
      expect.objectContaining({ jobId: input.jobId })
    );
  });

  it("does not delete a PDF when pdfUrl commit outcome is ambiguous", async () => {
    realContracts.enabled = true;
    vi.resetModules();
    vi.doMock("./prompt-query-scheduler", () => ({
      queryPromptsSequentially: async (
        prompts: Array<{ text: string; lang: "en" }>,
        query: (
          prompt: { text: string; lang: "en" },
          index: number
        ) => Promise<unknown>
      ) => [await query(prompts[0], 0)],
    }));
    vi.doMock("./run-budget", () => vi.importActual("./run-budget"));
    vi.doMock("./normalize-stored-metrics", () => ({
      isPublishableAuditResult: () => true,
    }));
    generateAuditPdf.mockResolvedValue({
      pdfUrl: "https://blob.test/runner-owned.pdf",
      pdfSize: 1,
    });
    let pdfUrlCommitAttempted = false;
    auditJobUpdate.mockImplementation(
      // biome-ignore lint/suspicious/useAwait: mock stands in for an async Prisma/engine API and must return a Promise
      async ({ data }: { data?: { pdfUrl?: string } }) => {
        if (data?.pdfUrl) {
          // Fault injection: the database write may have committed before the
          // caller observed a transport/timeout error.
          pdfUrlCommitAttempted = true;
          throw new Error("pdf url commit outcome ambiguous");
        }
        return {};
      }
    );

    try {
      const runAuditJob = await loadRunner();
      await runAuditJob(input);
      expect(pdfUrlCommitAttempted).toBe(true);
    } finally {
      realContracts.enabled = false;
    }
  });
});
