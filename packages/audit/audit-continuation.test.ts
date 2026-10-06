import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 마감으로 잘린 측정의 이어가기(2026-10-06) — 실제 러너·스케줄러·checkpoint·lease 를
// 메모리 AuditJob 행 하나 위에서 여러 「함수 호출」로 돌린다. 유료 호출(엔진)은 가짜이고
// 호출마다 시계를 앞으로 민다(질문 1개 = 120초 → 한 호출에 질문 2개만 시작 가능).

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
  aggregateAudit: vi.fn(() => ({
    sov: 0,
    enginesWithMention: [],
    averageMentionListSize: null,
    averageMentionPosition: null,
  })),
  auditCost: vi.fn(() => ({ totalKrw: 0, measuredEngines: 0, perEngine: [] })),
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
vi.mock("./geo-score", () => ({ geoAxisScores: vi.fn(() => ({ total: 0 })) }));

import {
  continueAuditJob,
  continueOldestPendingAudit,
} from "./audit-continuation";
import { isAuditContinuationPending } from "./audit-execution-lease";
import { readAuditCheckpoint } from "./checkpoint";
import { runAuditJob } from "./runner";
import { isStaleAuditJob } from "./stale-job";

const T0 = new Date("2026-10-06T03:00:00.000Z");
const QUESTION_MS = 120_000;
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
const askedPrompts: string[] = [];

const savedPrompts = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    text: `question ${index + 1}`,
    language: "en",
    trackings: [],
  }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.clearAllMocks();
  askedPrompts.length = 0;
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
  // 유료 질문 1개 — 엔진 계획 순서대로 답하고 시계를 120초 민다.
  mocks.queryAllEngines.mockImplementation(
    (args: { prompt: string }, engines: string[]) => {
      askedPrompts.push(args.prompt);
      vi.advanceTimersByTime(QUESTION_MS);
      return Promise.resolve(
        engines.map((engineId) => ({
          engineId,
          rawResponse: `Test Brand answer for ${args.prompt}`,
          brandMentioned: true,
          mentionPosition: 1,
          mentionListSize: 1,
          sentiment: "neutral",
          citedSources: [],
          shareOfVoice: 1,
          errorMessage: null,
          durationMs: 1,
          isStub: false,
        }))
      );
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
});

/** 새 함수 호출 = 시계 기준의 새 300초 예산. */
const freshInvocation = () => ({ invocationStartedAtMs: Date.now() });

describe("truncated round continuation", () => {
  it("parks a truncated run, then one continuation finishes only the remaining questions", async () => {
    await runAuditJob({ ...input, ...freshInvocation() });

    // 120초 + 120초 = 240초 → 남은 30초 < 35초라 3번째 질문을 시작하지 않았다.
    expect(askedPrompts).toHaveLength(2);
    expect(job().status).toBe("queued");
    expect(isAuditContinuationPending(job() as never)).toBe(true);
    expect(job().leaseToken).toBeNull();
    expect(job().result).toBeNull();
    // 대기 중에는 집계·시계열 반영이 없다.
    expect(mocks.persistAuditTracking).not.toHaveBeenCalled();
    const parked = readAuditCheckpoint(job().checkpoint, scope);
    expect(parked?.responses).toHaveLength(2);
    expect(parked?.continuation?.count).toBe(1);
    // 30분 대기열 상한으로 죽지 않는다(이어가기 시간창 안).
    vi.advanceTimersByTime(45 * 60_000);
    expect(isStaleAuditJob(job() as never)).toBe(false);

    const outcome = await continueAuditJob("job-1", {
      ...freshInvocation(),
      organizationId: "org-1",
    });

    expect(outcome).toEqual({ jobId: "job-1", ran: true, status: "completed" });
    // 이미 받은 답은 다시 묻지 않는다 — 질문마다 정확히 한 번.
    expect(askedPrompts).toHaveLength(4);
    expect(new Set(askedPrompts).size).toBe(4);
    const result = job().result as {
      engineResponses: unknown[];
      measurementContext: { resume: { continuations?: number } };
    };
    expect(result.engineResponses).toHaveLength(4 * 4);
    expect(result.measurementContext.resume.continuations).toBe(1);
    expect(job().checkpoint).toBeNull();
    // Tracking(추세)은 최종 완료 때 한 번만.
    expect(mocks.persistAuditTracking).toHaveBeenCalledTimes(1);
    expect(mocks.persistAuditTracking.mock.calls[0]?.[0].tagged).toHaveLength(
      4 * 4
    );
  });

  it("finalizes as provisional after two continuations, exactly like today", async () => {
    mocks.promptFindMany.mockResolvedValue(savedPrompts(8));

    await runAuditJob({ ...input, ...freshInvocation() });
    expect(
      readAuditCheckpoint(job().checkpoint, scope)?.continuation?.count
    ).toBe(1);

    await continueAuditJob("job-1", freshInvocation());
    expect(job().status).toBe("queued");
    expect(
      readAuditCheckpoint(job().checkpoint, scope)?.continuation?.count
    ).toBe(2);
    expect(mocks.persistAuditTracking).not.toHaveBeenCalled();

    const last = await continueAuditJob("job-1", freshInvocation());

    expect(last).toEqual({ jobId: "job-1", ran: true, status: "completed" });
    // 2 + 2 + 2 = 6 of 8 — 세 번째 이어가기는 없다.
    expect(askedPrompts).toHaveLength(6);
    expect(new Set(askedPrompts).size).toBe(6);
    const result = job().result as {
      engineResponses: unknown[];
      promptsCount: number;
    };
    expect(result.promptsCount).toBe(8);
    expect(result.engineResponses).toHaveLength(6 * 4);
    expect(mocks.persistAuditTracking).toHaveBeenCalledTimes(1);

    // 완료된 Job 은 더 이상 이어가지 않는다.
    expect(await continueAuditJob("job-1", freshInvocation())).toEqual({
      jobId: "job-1",
      ran: false,
      reason: "not_pending",
    });
    expect(askedPrompts).toHaveLength(6);
  });

  it("runs only one of two concurrent continuations (lease claim)", async () => {
    await runAuditJob({ ...input, ...freshInvocation() });
    expect(askedPrompts).toHaveLength(2);

    // 화면 서버액션과 cron 이 같은 순간 집는다.
    const [screen, cron] = await Promise.all([
      continueAuditJob("job-1", {
        ...freshInvocation(),
        organizationId: "org-1",
      }),
      continueOldestPendingAudit(freshInvocation()),
    ]);

    expect(screen.ran && cron?.ran).toBe(true);
    // 유료 질문은 남은 2개만, 한 번씩.
    expect(askedPrompts).toHaveLength(4);
    expect(new Set(askedPrompts).size).toBe(4);
    expect(job().status).toBe("completed");
    expect(mocks.persistAuditTracking).toHaveBeenCalledTimes(1);
  });

  it("does not continue another organisation's job or a non-pending job", async () => {
    expect(
      await continueAuditJob("job-1", {
        ...freshInvocation(),
        organizationId: "org-2",
      })
    ).toEqual({ jobId: "job-1", ran: false, reason: "not_found" });
    // 막 만들어진 queued Job(leaseUntil 없음)은 이어가기 대상이 아니다.
    expect(await continueAuditJob("job-1", freshInvocation())).toEqual({
      jobId: "job-1",
      ran: false,
      reason: "not_pending",
    });
    expect(await continueOldestPendingAudit(freshInvocation())).toBeNull();
    expect(askedPrompts).toHaveLength(0);
  });

  it("keeps today's provisional contract when the caller did not opt in", async () => {
    await runAuditJob({
      ...input,
      continueWhenTruncated: undefined,
      ...freshInvocation(),
    });

    expect(job().status).toBe("completed");
    expect(askedPrompts).toHaveLength(2);
    expect(mocks.persistAuditTracking).toHaveBeenCalledTimes(1);
  });
});
