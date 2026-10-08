import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 늦은 엔진 반영(2026-10-07 · 설계 B) — 실제 러너·스케줄러·checkpoint·lease·이어가기를
// 메모리 AuditJob 행 하나 위에서 여러 「함수 호출」로 돌린다. 엔진은 가짜이고, 정한 칸만
// 60초 상한 문구(「Engine x timed out after 60000ms」)로 돌려준다.

type Row = Record<string, unknown>;
const store = vi.hoisted(() => ({ rows: new Map<string, Row>() }));

const matches = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, cond]) => {
    if (key === "OR") {
      return (cond as Row[]).some((branch) => matches(row, branch));
    }
    const value = row[key] ?? null;
    if (cond === null) {
      return value === null;
    }
    if (cond instanceof Date) {
      return value instanceof Date && value.getTime() === cond.getTime();
    }
    if (typeof cond === "object") {
      const op = cond as {
        gt?: Date;
        gte?: Date;
        in?: unknown[];
        lt?: Date;
        not?: null;
      };
      if ("not" in op) {
        return value !== op.not;
      }
      if (op.in) {
        return op.in.includes(value);
      }
      if (!(value instanceof Date)) {
        return false;
      }
      if (op.lt && !(value.getTime() < op.lt.getTime())) {
        return false;
      }
      if (op.gt && !(value.getTime() > op.gt.getTime())) {
        return false;
      }
      if (op.gte && !(value.getTime() >= op.gte.getTime())) {
        return false;
      }
      return true;
    }
    return value === cond;
  });

const mocks = vi.hoisted(() => ({
  queryAllEngines: vi.fn(),
  persistAuditTracking: vi.fn(),
  promptFindMany: vi.fn(),
  executeRawUnsafe: vi.fn(),
  keys: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  database: {
    auditJob: {
      updateMany: ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const row of store.rows.values()) {
          if (matches(row, where)) {
            Object.assign(row, structuredClone(data));
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
      findUnique: ({ where }: { where: { id: string } }) => {
        const row = store.rows.get(where.id);
        return Promise.resolve(row ? structuredClone(row) : null);
      },
      findFirst: ({ where }: { where: Row }) => {
        const found = [...store.rows.values()]
          .filter((row) => matches(row, where))
          .sort(
            (a, b) =>
              ((a.attemptStartedAt as Date | null)?.getTime() ?? 0) -
              ((b.attemptStartedAt as Date | null)?.getTime() ?? 0)
          )[0];
        return Promise.resolve(found ? structuredClone(found) : null);
      },
    },
    brand: {
      findUnique: vi.fn(async () => ({
        name: "Test Brand",
        entityVariants: [],
        marketScope: null,
        legalName: null,
        businessNumber: null,
        competitors: null,
      })),
    },
    prompt: { findMany: mocks.promptFindMany },
    $executeRawUnsafe: mocks.executeRawUnsafe,
  },
}));
vi.mock("@repo/observability/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
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
  registeredBrandIdentityFallback: vi.fn(() => null),
  resolveOfficialSiteIdentity: vi.fn(async () => ({
    finalUrl: "https://example.com",
    title: "Test Brand",
    description: null,
    h1: null,
    siteName: null,
  })),
}));
vi.mock("@repo/ai/lib/engines", () => ({
  NAVER_SEARCH_SAMPLING_VERSION: "interleave-v1",
  chatgptEngineSetKey: () => undefined,
  // 점수 대신 「답을 받은 행 수」를 돌려준다 — 늦은 답 반영 전/후 점수가 달라지는지 본다.
  aggregateAudit: vi.fn((rows: Array<{ errorMessage: string | null }>) => ({
    sov: 0,
    enginesWithMention: [],
    averageMentionListSize: null,
    averageMentionPosition: null,
    answered: rows.filter((row) => !row.errorMessage).length,
  })),
  // 다시 묻기 원가 확인용 — 답을 받은 행마다 10원.
  auditCost: vi.fn(
    (rows: Array<{ engineId: string; errorMessage: string | null }>) => {
      const perEngine = rows.map((row) => ({
        engineId: row.engineId,
        krw: row.errorMessage ? 0 : 10,
        basis: row.errorMessage ? "none" : "token",
      }));
      return {
        costModelVersion: 2,
        totalKrw: perEngine.reduce((sum, item) => sum + item.krw, 0),
        measuredEngines: perEngine.filter((item) => item.krw > 0).length,
        perEngine,
      };
    }
  ),
  partitionCitedSources: vi.fn(() => ({
    attributedResponses: [],
    unattributedCitationCount: 0,
  })),
  queryAllEngines: mocks.queryAllEngines,
}));
vi.mock("@repo/ai/lib/mention-verdict", () => ({
  MENTION_VERDICT_VERSION: 2,
  verifyMentions: vi.fn(async (rows: unknown[]) =>
    rows.map((row) => ({
      ...(row as Row),
      mentionQuality: "confirmed",
      verdictVia: "rule",
    }))
  ),
}));
vi.mock("./audit-prompts", () => ({
  classifySavedPromptKind: () => "brand",
  generateAuditPrompts: vi.fn(() => []),
  generateDiscoveryPrompts: vi.fn(() => []),
}));
vi.mock("./tracking", () => ({
  persistAuditTracking: mocks.persistAuditTracking,
  tagCoreResponses: (
    responsesByPrompt: unknown[][],
    prompts: Array<{ text: string; lang: "ko" | "en" }>
  ) =>
    responsesByPrompt.flatMap((responses, promptIndex) =>
      responses.map((response) => ({
        ...(response as Row),
        promptIndex,
        promptText: prompts[promptIndex]?.text ?? "",
        promptLang: prompts[promptIndex]?.lang ?? "ko",
        promptKind: "brand",
      }))
    ),
}));
vi.mock("./pdf-generator", () => ({ generateAuditPdf: vi.fn() }));
vi.mock("./keys", () => ({ keys: mocks.keys }));
vi.mock("./actions", () => ({
  actionsToStrings: vi.fn(() => []),
  buildGeoActions: vi.fn(() => []),
}));
vi.mock("./action-rules", () => ({
  hasCompleteNaverSearchBaseline: vi.fn(() => false),
  summarizeVerdicts: vi.fn(() => ({})),
}));
vi.mock("./geo-score", () => ({
  geoAxisScores: vi.fn((metrics: { answered?: number }) => ({
    total: metrics.answered ?? 0,
  })),
}));

import { log } from "@repo/observability/log";
import {
  continueAuditJob,
  continueOldestPendingAudit,
} from "./audit-continuation";
import {
  AUDIT_CONTINUATION_WINDOW_MS,
  isAuditContinuationPending,
  isLateReaskInProgress,
} from "./audit-execution-lease";
import { readAuditCheckpoint } from "./checkpoint";
import { runAuditJob } from "./runner";
import { isStaleAuditJob } from "./stale-job";

const T0 = new Date("2026-10-07T03:00:00.000Z");
const REASK_TIMEOUT_MS = 200_000;
let questionMs = 50_000;
let reaskMs = 150_000;
/** 첫 측정에서 60초 상한에 걸릴 칸(「question N:engine」). */
let slowCells = new Set<string>();
/** 다시 물어도 또 상한에 걸릴 칸. */
let stillSlowCells = new Set<string>();
const scope = {
  brandId: "brand-1",
  domain: "example.com",
  language: "en" as const,
  organizationId: "org-1",
};
const input = {
  ...scope,
  jobId: "job-1",
  brandName: "Test Brand",
  continueWhenTruncated: true,
};
const job = () => store.rows.get("job-1") as Row;
const batchCalls: string[] = [];
const reaskCalls: Array<{ cell: string; timeoutMs?: number }> = [];

const savedPrompts = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    text: `question ${index + 1}`,
    language: "en",
    trackings: [],
  }));

const answer = (prompt: string, engineId: string) => ({
  engineId,
  rawResponse: `Test Brand answer for ${prompt}`,
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
const timedOut = (engineId: string, ms: number) => ({
  engineId,
  rawResponse: "",
  brandMentioned: false,
  mentionPosition: null,
  mentionListSize: null,
  sentiment: null,
  citedSources: [],
  shareOfVoice: null,
  errorMessage: `Engine ${engineId} timed out after ${ms}ms`,
  durationMs: ms,
  isStub: false,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.clearAllMocks();
  questionMs = 50_000;
  reaskMs = 150_000;
  slowCells = new Set(["question 2:gemini"]);
  stillSlowCells = new Set();
  batchCalls.length = 0;
  reaskCalls.length = 0;
  store.rows.clear();
  store.rows.set("job-1", {
    id: "job-1",
    email: "org:org-1",
    status: "queued",
    domain: "example.com",
    language: "en",
    industry: null,
    organizationId: "org-1",
    brandId: "brand-1",
    createdAt: T0,
    attemptStartedAt: null,
    leaseToken: null,
    leaseUntil: null,
    checkpoint: null,
    result: null,
  });
  mocks.keys.mockReturnValue({
    AUDIT_DUAL_WRITE_ENABLED: true,
    PROMPT_ATTEMPT_LEDGER_ENABLED: false,
  });
  mocks.executeRawUnsafe.mockResolvedValue(1);
  mocks.persistAuditTracking.mockResolvedValue("persisted");
  mocks.promptFindMany.mockResolvedValue(savedPrompts(4));
  mocks.queryAllEngines.mockImplementation(
    (
      args: { prompt: string },
      engines: string[],
      _onEvent: unknown,
      options?: { timeoutMs?: number }
    ) => {
      if (options?.timeoutMs) {
        // 늦은 칸 다시 묻기 — 엔진 하나, 긴 상한.
        const timeoutMs = options.timeoutMs;
        const cell = `${args.prompt}:${engines[0]}`;
        reaskCalls.push({ cell, timeoutMs });
        const slow = stillSlowCells.has(cell);
        vi.advanceTimersByTime(slow ? timeoutMs : reaskMs);
        return Promise.resolve(
          engines.map((engineId) =>
            slow ? timedOut(engineId, timeoutMs) : answer(args.prompt, engineId)
          )
        );
      }
      batchCalls.push(args.prompt);
      vi.advanceTimersByTime(questionMs);
      return Promise.resolve(
        engines.map((engineId) =>
          slowCells.has(`${args.prompt}:${engineId}`)
            ? timedOut(engineId, 60_000)
            : answer(args.prompt, engineId)
        )
      );
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
});

/** 새 함수 호출 = 시계 기준의 새 300초 예산. */
const freshInvocation = () => ({ invocationStartedAtMs: Date.now() });

interface ResultRow {
  engineId: string;
  errorMessage: string | null;
  lateCell?: string;
  promptIndex?: number;
}
interface StoredResult {
  cost: {
    lateReask?: {
      cells: number;
      krw: number;
      perEngine: Array<{ cells: number; engineId: string; krw: number }>;
      resolved: number;
    };
    totalKrw: number;
  };
  engineResponses: ResultRow[];
  measurementContext: {
    resume: { continuations?: number; lateReasks?: number };
  };
  revisions?: Array<{
    at: string;
    cells: number;
    engines: string[];
    from: number;
    reason: string;
    to: number;
  }>;
}
const result = () => job().result as StoredResult;
const geminiRowOfQuestion2 = () =>
  result().engineResponses.find(
    (row) => row.promptIndex === 1 && row.engineId === "gemini"
  );

describe("late engine backfill (timed-out cells)", () => {
  it("parks a timed-out cell as pending, re-asks only it, then finalizes with a revision", async () => {
    await runAuditJob({ ...input, ...freshInvocation() });

    // 질문 4개는 다 물었다. Gemini 한 칸이 60초 상한 → 오류가 아니라 「반영 예정」.
    expect(batchCalls).toHaveLength(4);
    expect(job().status).toBe("queued");
    expect(isAuditContinuationPending(job() as never)).toBe(true);
    const parked = readAuditCheckpoint(job().checkpoint, scope);
    expect(parked?.lateReask?.count).toBe(1);
    // 측정 화면은 이 회차를 「늦게 온 AI 답변을 마저 받고 있어요」로 안내한다.
    expect(isLateReaskInProgress(job().checkpoint)).toBe(true);
    // 질문 이어가기 카운터는 건드리지 않는다(따로 센다).
    expect(parked?.continuation).toBeUndefined();
    expect(
      parked?.cells?.filter((cell) => cell.state === "timed_out_pending")
    ).toEqual([
      expect.objectContaining({ promptIndex: 1, engineId: "gemini" }),
    ]);
    expect(parked?.cells?.filter((cell) => cell.state === "done")).toHaveLength(
      4 * 4 - 1
    );
    // 잠정 점수는 완료 커밋·Tracking 이 없다 → 추세·지난 회차 비교에 안 들어간다.
    expect(job().result).toBeNull();
    expect(mocks.persistAuditTracking).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith("audit.late_cell.pending", {
      jobId: "job-1",
      cells: 1,
      perEngine: { gemini: 1 },
      lateReask: 1,
    });
    // 이어가기 대기는 실패로 정리되지 않는다.
    vi.advanceTimersByTime(45 * 60_000);
    expect(isStaleAuditJob(job() as never)).toBe(false);

    const outcome = await continueAuditJob("job-1", {
      ...freshInvocation(),
      organizationId: "org-1",
    });

    expect(outcome).toMatchObject({ ran: true, status: "completed" });
    // 그 칸만, 긴 상한으로, 한 번. 질문 배치는 다시 돌지 않는다.
    expect(reaskCalls).toEqual([
      { cell: "question 2:gemini", timeoutMs: REASK_TIMEOUT_MS },
    ]);
    expect(batchCalls).toHaveLength(4);
    expect(geminiRowOfQuestion2()).toMatchObject({
      errorMessage: null,
      lateCell: "resolved",
    });
    // 제때 답한 칸에는 표시가 없다.
    expect(
      result().engineResponses.filter((row) => row.lateCell !== undefined)
    ).toHaveLength(1);
    // 점수 정정 기록: 반영 전(늦은 칸 제외) 15 → 반영 후 16.
    expect(result().revisions).toEqual([
      {
        from: 15,
        to: 16,
        reason: "Gemini 늦은 답 반영",
        at: expect.any(String),
        engines: ["gemini"],
        cells: 1,
      },
    ]);
    // 다시 묻기 원가가 결과에 따로 남는다(총원가에 이미 포함).
    expect(result().cost.lateReask).toEqual({
      cells: 1,
      resolved: 1,
      krw: 10,
      perEngine: [{ engineId: "gemini", cells: 1, krw: 10 }],
    });
    expect(result().cost.totalKrw).toBe(160);
    expect(result().measurementContext.resume).toMatchObject({
      lateReasks: 1,
    });
    expect(result().measurementContext.resume.continuations).toBeUndefined();
    // Tracking(추세)은 최종 완료 때 한 번, 늦은 답까지 포함해서.
    expect(mocks.persistAuditTracking).toHaveBeenCalledTimes(1);
    const tagged = mocks.persistAuditTracking.mock.calls[0]?.[0]
      .tagged as Array<{
      engineId: string;
      errorMessage: string | null;
      promptIndex: number;
    }>;
    expect(
      tagged.find((row) => row.promptIndex === 1 && row.engineId === "gemini")
        ?.errorMessage
    ).toBeNull();
    expect(job().checkpoint).toBeNull();
    expect(log.info).toHaveBeenCalledWith("audit.late_cell.reasked", {
      jobId: "job-1",
      cells: 1,
      perEngine: { gemini: 1 },
      timeoutMs: REASK_TIMEOUT_MS,
    });
    expect(log.info).toHaveBeenCalledWith("audit.late_cell.resolved", {
      jobId: "job-1",
      cells: 1,
      perEngine: { gemini: 1 },
      reaskCostKrw: 10,
      costModelVersion: 2,
    });

    // 끝난 Job 은 다시 묻지 않는다.
    expect(await continueAuditJob("job-1", freshInvocation())).toEqual({
      jobId: "job-1",
      ran: false,
      reason: "not_pending",
    });
    expect(reaskCalls).toHaveLength(1);
  });

  it("closes a cell that times out again as final-failed: excluded, engine named, no revision", async () => {
    stillSlowCells = new Set(["question 2:gemini"]);
    await runAuditJob({ ...input, ...freshInvocation() });
    await continueAuditJob("job-1", freshInvocation());

    expect(job().status).toBe("completed");
    expect(reaskCalls).toHaveLength(1);
    expect(geminiRowOfQuestion2()).toMatchObject({
      errorMessage: `Engine gemini timed out after ${REASK_TIMEOUT_MS}ms`,
      lateCell: "final_failed",
    });
    expect(result().revisions).toBeUndefined();
    expect(result().cost.lateReask).toMatchObject({ cells: 1, resolved: 0 });
    expect(log.info).toHaveBeenCalledWith("audit.late_cell.final_failed", {
      jobId: "job-1",
      cells: 1,
      perEngine: { gemini: 1 },
      reasons: { reask_timed_out: 1 },
    });
    expect(mocks.persistAuditTracking).toHaveBeenCalledTimes(1);
  });

  it("never re-asks done cells and keeps the question-continuation counter separate", async () => {
    // 질문 1개 = 120초 → 한 호출에 질문 2개. 8개 질문 = 원래 + 이어가기 2번(6개) 후 소진.
    questionMs = 120_000;
    mocks.promptFindMany.mockResolvedValue(savedPrompts(8));
    slowCells = new Set(["question 1:claude", "question 3:gemini"]);

    await runAuditJob({ ...input, ...freshInvocation() });
    let saved = readAuditCheckpoint(job().checkpoint, scope);
    expect(saved?.continuation?.count).toBe(1);
    expect(saved?.lateReask).toBeUndefined();
    // 질문 이어가기는 기존 「남은 질문을 이어서」 안내 그대로.
    expect(isLateReaskInProgress(job().checkpoint)).toBe(false);

    await continueAuditJob("job-1", freshInvocation());
    saved = readAuditCheckpoint(job().checkpoint, scope);
    expect(saved?.continuation?.count).toBe(2);
    expect(saved?.lateReask).toBeUndefined();

    // 이어가기 2번을 다 써 질문이 남았어도, 늦은 칸 다시 묻기는 따로 1번 받는다.
    await continueAuditJob("job-1", freshInvocation());
    saved = readAuditCheckpoint(job().checkpoint, scope);
    expect(job().status).toBe("queued");
    expect(saved?.continuation?.count).toBe(2);
    expect(saved?.lateReask?.count).toBe(1);
    expect(isLateReaskInProgress(job().checkpoint)).toBe(true);
    expect(batchCalls).toHaveLength(6);
    expect(reaskCalls).toHaveLength(0);
    expect(mocks.persistAuditTracking).not.toHaveBeenCalled();

    await continueAuditJob("job-1", freshInvocation());

    expect(job().status).toBe("completed");
    // 다시 묻기 회차는 새 질문을 시작하지 않는다(6/8 그대로) — 늦은 두 칸만.
    expect(batchCalls).toHaveLength(6);
    expect(new Set(batchCalls).size).toBe(6);
    expect(reaskCalls.map((call) => call.cell).sort()).toEqual([
      "question 1:claude",
      "question 3:gemini",
    ]);
    expect(result().measurementContext.resume).toMatchObject({
      continuations: 2,
      lateReasks: 1,
    });
    expect(result().revisions?.[0]?.reason).toBe("Claude·Gemini 늦은 답 반영");
    expect(mocks.persistAuditTracking).toHaveBeenCalledTimes(1);
  });

  it("runs only one of two concurrent late re-ask rounds (lease claim)", async () => {
    await runAuditJob({ ...input, ...freshInvocation() });

    const [screen, cron] = await Promise.all([
      continueAuditJob("job-1", {
        ...freshInvocation(),
        organizationId: "org-1",
      }),
      continueOldestPendingAudit(freshInvocation()),
    ]);

    expect(screen.ran && cron?.ran).toBe(true);
    expect(reaskCalls).toHaveLength(1);
    expect(job().status).toBe("completed");
    expect(mocks.persistAuditTracking).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith("audit.job.claim_skipped", {
      jobId: "job-1",
    });
  });

  it("finalizes an expired late wait without a paid re-ask (window_expired), Tracking once", async () => {
    await runAuditJob({ ...input, ...freshInvocation() });
    vi.advanceTimersByTime(AUDIT_CONTINUATION_WINDOW_MS + 60_000);

    const outcome = await continueOldestPendingAudit({
      ...freshInvocation(),
      expiredOnly: true,
    });

    expect(outcome).toMatchObject({ mode: "finalize", status: "completed" });
    expect(reaskCalls).toHaveLength(0);
    expect(geminiRowOfQuestion2()).toMatchObject({
      errorMessage: "Engine gemini timed out after 60000ms",
      lateCell: "final_failed",
    });
    expect(result().revisions).toBeUndefined();
    expect(log.info).toHaveBeenCalledWith(
      "audit.late_cell.final_failed",
      expect.objectContaining({ reasons: { window_expired: 1 } })
    );
    expect(mocks.persistAuditTracking).toHaveBeenCalledTimes(1);
  });

  it("keeps today's behaviour for callers without a continuation path (free audit)", async () => {
    await runAuditJob({
      ...input,
      continueWhenTruncated: undefined,
      ...freshInvocation(),
    });

    expect(job().status).toBe("completed");
    expect(reaskCalls).toHaveLength(0);
    expect(geminiRowOfQuestion2()).toMatchObject({
      errorMessage: "Engine gemini timed out after 60000ms",
      lateCell: "final_failed",
    });
    expect(log.info).toHaveBeenCalledWith(
      "audit.late_cell.final_failed",
      expect.objectContaining({ reasons: { not_reasked: 1 } })
    );
    expect(mocks.persistAuditTracking).toHaveBeenCalledTimes(1);
  });

  it("does not park a run whose only failures are ordinary engine errors", async () => {
    mocks.queryAllEngines.mockImplementation(
      (args: { prompt: string }, engines: string[]) => {
        batchCalls.push(args.prompt);
        return Promise.resolve(
          engines.map((engineId) =>
            engineId === "perplexity"
              ? {
                  ...timedOut(engineId, 1),
                  errorMessage: "429 Too Many Requests",
                }
              : answer(args.prompt, engineId)
          )
        );
      }
    );

    await runAuditJob({ ...input, ...freshInvocation() });

    expect(job().status).toBe("completed");
    expect(reaskCalls).toHaveLength(0);
    // 처음부터 오류였던 칸은 늦은 칸 표시를 달지 않는다(지금과 같다).
    expect(
      result().engineResponses.filter((row) => row.lateCell !== undefined)
    ).toHaveLength(0);
  });
});
