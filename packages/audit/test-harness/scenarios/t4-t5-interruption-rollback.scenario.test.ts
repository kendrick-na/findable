import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resetRetryBudget } from "@repo/ai/lib/engines/cell-retry";
import { resetEngineBreakers } from "@repo/ai/lib/engines/engine-breaker";
import {
  createFaultHarness,
  koreanAdaptersMock,
} from "@repo/ai/lib/engines/test-harness/fault-engine";
import { sdkLikeAdapter } from "@repo/ai/lib/engines/test-harness/sdk-fault-adapters";
import { STABILITY_FLAGS } from "@repo/ai/lib/stability-flags";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeClock } from "../fake-clock";
import { createMemoryJobStore } from "../memory-job-store";
import { T4 } from "./plans";

// U5 2단계 — T4 중단·배포 시뮬(U3).
// 진짜 runAuditJob + 진짜 resumeStuckProcessingJobs(정리 cron 이 부르는 함수) + 진짜 continueAuditJob, 메모리 AuditJob.
// 함수 급사 = 질문 N번째 저장 직후 엔진 호출이 영원히 안 돌아오고(기록도 안 남김) 대기 중 타이머를 전부 버린다.
// cron 라우트 자체(응답 키·플래그 꺼짐 문구)는 apps/web/__tests__/stability-t4-sweep-route.test.ts.

const state = vi.hoisted(() => ({ crashFromIndex: Number.POSITIVE_INFINITY }));
const store = createMemoryJobStore();
const harness = createFaultHarness({ rules: [] }, { errorStyle: "throw" });
const adapter = sdkLikeAdapter(harness);
const gated = (query: Parameters<typeof adapter>[0]) =>
  Number(query.prompt.slice(1)) >= state.crashFromIndex
    ? new Promise<never>(() => undefined)
    : adapter(query);

vi.mock("@repo/database", () => {
  const base = store.databaseModule();
  return {
    ...base,
    database: {
      ...base.database,
      brand: {
        findUnique: () =>
          Promise.resolve({
            name: "Example",
            entityVariants: [],
            marketScope: "korea",
          }),
      },
    },
  };
});
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@repo/ai/lib/engines/global-adapters", () => ({
  chatgptAdapter: gated,
  claudeAdapter: gated,
  geminiAdapter: gated,
  perplexityAdapter: gated,
}));
vi.mock("@repo/ai/lib/engines/korean-adapters", () => {
  const mock = koreanAdaptersMock(harness);
  return {
    ...mock,
    daumAdapter: gated,
    hyperclovaAdapter: gated,
    naverAdapter: gated,
  };
});
vi.mock("@repo/ai/lib/mention-verdict", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  verifyMentions: (rows: Array<{ brandMentioned: boolean }>) =>
    Promise.resolve(
      rows.map((row) => ({
        ...row,
        mentionQuality: row.brandMentioned ? "confirmed" : "absent",
        verdictVia: "rule",
      }))
    ),
}));
vi.mock("@repo/ai/lib/brand-identity", () => ({
  resolveBrandIdentity: () =>
    Promise.resolve({ brandName: "Example", brandVariants: [] }),
}));
vi.mock("../../official-site-identity", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveOfficialSiteIdentity: () =>
    Promise.resolve({
      finalUrl: "https://example.com/",
      title: "Example",
      description: null,
      h1: null,
      siteName: null,
    }),
}));
vi.mock("../../pdf-generator", () => ({
  generateAuditPdf: () => Promise.reject(new Error("PAID CALL: pdf")),
}));
vi.mock("../../tracking", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  persistAuditTracking: () => Promise.reject(new Error("PAID CALL: tracking")),
}));

const { runAuditJob } = await import("../../runner");
const { continueAuditJob } = await import("../../audit-continuation");
const { queryAllEngines } = await import("@repo/ai/lib/engines");
const { makeAuditCheckpoint, continuationLimitOf, readAuditCheckpoint } =
  await import("../../checkpoint");
const { resumeStuckProcessingJobs } = await import("../../resume-stuck");
const { staleAuditJobsWhere } = await import("../../stale-job");

const scope = {
  brandId: "brand-1",
  domain: "example.com",
  language: "both" as const,
  organizationId: "org-1",
};
const identity = {
  brandName: "Example",
  brandVariants: [],
  identityGrounded: true,
  officialSiteIdentity: {
    finalUrl: "https://example.com/",
    title: "Example",
    description: null,
    h1: null,
    siteName: null,
  },
};
let clock: ReturnType<typeof installFakeClock>;

const seedJob = (questions: number) => {
  const createdAt = new Date();
  store.seed({
    id: "job-1",
    createdAt,
    email: "org:org-1",
    organizationId: scope.organizationId,
    brandId: scope.brandId,
    domain: scope.domain,
    language: scope.language,
    checkpoint: makeAuditCheckpoint(
      scope,
      identity,
      Array.from({ length: questions }, (_, i) => ({
        text: `q${i + 1}`,
        lang: "ko" as const,
        kind: "brand" as const,
      })),
      createdAt.toISOString()
    ),
  });
};

const savedCount = () =>
  (
    (store.get("job-1").checkpoint as { responses?: unknown[] } | null)
      ?.responses ?? []
  ).length;

/** 함수 급사: `savedQuestions` 개가 저장된 뒤 다음 질문이 멈추고, 대기 타이머가 사라지고, lease 가 만료된다. */
const crashAfterSaved = async (
  savedQuestions: number,
  start: () => Promise<unknown>
) => {
  state.crashFromIndex = savedQuestions + 1;
  start().catch(() => undefined);
  for (
    let i = 0;
    i < 600 &&
    (savedCount() < savedQuestions ||
      store.get("job-1").status !== "processing");
    i++
  ) {
    await vi.advanceTimersByTimeAsync(100);
  }
  if (savedCount() !== savedQuestions) {
    throw new Error(`저장된 질문 ${savedCount()}개 (기대 ${savedQuestions}개)`);
  }
  // clearAllTimers 는 가짜 시각도 실제 시각으로 되돌리므로 시각을 저장했다가 복원한다.
  const frozenAt = Date.now();
  vi.clearAllTimers();
  vi.setSystemTime(frozenAt);
  state.crashFromIndex = Number.POSITIVE_INFINITY;
  store.expireLease("job-1");
};

const sweep = async () =>
  await resumeStuckProcessingJobs({
    now: new Date(),
    staleWhere: staleAuditJobsWhere("processing", new Date()),
  });

const runInput = {
  jobId: "job-1",
  domain: "example.com",
  brandName: "Example",
  language: "both" as const,
  organizationId: scope.organizationId,
  brandId: scope.brandId,
};

beforeEach(() => {
  clock = installFakeClock();
  store.reset();
  harness.setPlan({ rules: [] });
  state.crashFromIndex = Number.POSITIVE_INFINITY;
  resetEngineBreakers();
  resetRetryBudget();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("NETWORK CALL")))
  );
});
afterEach(() => {
  clock.restore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("T4 — 질문 7번째 저장 직후 중단 → 정리 cron → 이어가기", () => {
  it("실패가 아니라 이어가기 대기가 되고, 남은 질문만 한 번씩 묻고, 12개 모두 담아 끝난다", async () => {
    seedJob(T4.questions);
    await crashAfterSaved(T4.interruptAfterSavedQuestions, () =>
      runAuditJob(runInput)
    );
    expect(store.get("job-1").status).toBe("processing");
    const callsBefore = harness.calls.length;

    // 정리 cron(켜짐) — 받아 둔 답이 있으니 이어가기 대기.
    expect(await sweep()).toBe(1);
    const row = store.get("job-1");
    expect(row.status).toBe("queued");
    expect(row.leaseUntil).toBeInstanceOf(Date);
    expect((row.leaseUntil as Date).getTime()).toBeGreaterThan(Date.now());
    expect(row.leaseToken).toBeNull();
    const checkpoint = row.checkpoint as {
      continuation?: { count: number };
      responses: unknown[];
    };
    expect(checkpoint.continuation?.count).toBe(1);
    expect(checkpoint.responses).toHaveLength(7);
    expect(store.statusTrail("job-1")).not.toContain("failed");

    // 이어가기.
    const outcome = await clock.settle(
      continueAuditJob("job-1", { invocationStartedAtMs: Date.now() }),
      { maxMs: 30 * 60_000, stepMs: 500 }
    );
    expect(outcome).toMatchObject({ ran: true, mode: "continue" });
    const second = harness.calls.slice(callsBefore);
    expect(second.length).toBeGreaterThan(0);
    expect(second.some((c) => /^q[1-7]$/.test(c.prompt))).toBe(false);
    expect(new Set(second.map((c) => c.prompt))).toEqual(
      new Set(["q8", "q9", "q10", "q11", "q12"])
    );
    // 같은 칸(엔진+질문) 유료 호출 1회.
    expect(Math.max(...harness.callsPerCell().values())).toBe(1);
    // 끝: 12개 질문 모두 포함, 한 번도 failed 가 아니었다.
    expect(store.get("job-1").status).toBe("completed");
    expect(store.statusTrail("job-1")).not.toContain("failed");
    const result = store.get("job-1").result as {
      engineResponses: unknown[];
    };
    // 12개 질문 × 질문별 엔진 계획 수 = 결과 행 수(이어가기 전 7개분 + 이어간 5개분이 모두 들어 있다).
    const planned = makeAuditCheckpoint(
      scope,
      identity,
      Array.from({ length: T4.questions }, (_, i) => ({
        text: `q${i + 1}`,
        lang: "ko" as const,
        kind: "brand" as const,
      }))
    ).enginePlan.flat().length;
    expect(result.engineResponses).toHaveLength(planned);
  });

  it("응답이 0개면 이어가기 대상이 아니다(기존 실패 정리 경로로 남는다)", async () => {
    seedJob(T4.questions);
    await crashAfterSaved(0, () => runAuditJob(runInput));
    expect(await sweep()).toBe(0);
    expect(store.get("job-1").status).toBe("processing");
  });

  it("반복 중단: 이어가기 횟수가 1·2·3 으로 늘고, 상한을 쓰면 더 이어가지 않는다", async () => {
    seedJob(T4.questions);
    const limit = continuationLimitOf(
      store.get("job-1").checkpoint as Parameters<typeof continuationLimitOf>[0]
    );
    // 12문항 checkpoint 의 상한(기본 MAX_AUDIT_CONTINUATIONS=2) — 값은 구현에서 읽는다.
    expect(limit).toBeGreaterThanOrEqual(1);

    await crashAfterSaved(3, () => runAuditJob(runInput));
    for (let used = 1; used <= limit; used++) {
      expect(await sweep()).toBe(1);
      expect(
        (store.get("job-1").checkpoint as { continuation: { count: number } })
          .continuation.count
      ).toBe(used);
      await crashAfterSaved(3 + used * 2, () =>
        continueAuditJob("job-1", { invocationStartedAtMs: Date.now() })
      );
    }
    // 상한을 다 썼다 → 이번엔 이어가기로 돌리지 않는다(기존 동작 = 호출부가 failed 로 정리).
    expect(await sweep()).toBe(0);
    expect(store.get("job-1").status).toBe("processing");
    expect(store.statusTrail("job-1")).not.toContain("failed");
  });
});

// ── T5 롤백 호환 ─────────────────────────────────────────────
// 기준 커밋 5068d9f4 의 readAuditCheckpoint 는 checkpoint.ts 가 기준과 바이트 동일해야 「같은 읽기 코드」라고 말할 수 있다.
// 그래서 (1) 파일 내용 해시가 기준 blob 과 같음을 확인하고 (2) 그 읽기 코드로 새 코드가 만든 JSON 을 읽는다.

const ALL_FLAGS_ON = () => {
  for (const flag of STABILITY_FLAGS) {
    vi.stubEnv(flag, "1");
  }
};
const gitOut = (...args: string[]): string | null => {
  try {
    return execFileSync("git", args, {
      cwd: dirname(fileURLToPath(import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};
const stable = (value: unknown): string =>
  JSON.stringify(value, (key, v) =>
    key === "durationMs" || /(At|Ms)$/.test(key) ? undefined : v
  );

describe("T5 롤백 호환", () => {
  it("읽기 코드 동일성: checkpoint.ts 가 기준 커밋(5068d9f4)과 같은 blob 이다", () => {
    const baseline = gitOut(
      "rev-parse",
      "5068d9f4:packages/audit/checkpoint.ts"
    );
    if (!baseline) {
      return; // 기준 커밋이 없는 환경(얕은 복제)에서는 건너뛴다.
    }
    const file = fileURLToPath(new URL("../../checkpoint.ts", import.meta.url));
    expect(gitOut("hash-object", file)).toBe(baseline);
  });

  it("(a) 모든 플래그를 켜고 만든 checkpoint(재시도 표식·이어가기 횟수 포함)를 기준 읽기 코드가 읽고, 계획 키 입력은 그대로다", async () => {
    ALL_FLAGS_ON();
    harness.setPlan({
      seed: 1,
      rules: [{ engine: "claude", calls: [1], fault: { type: "http5xx" } }],
    });
    seedJob(T4.questions);
    await crashAfterSaved(T4.interruptAfterSavedQuestions, () =>
      runAuditJob(runInput)
    );
    expect(await sweep()).toBe(1);
    const stored = JSON.parse(
      JSON.stringify(store.get("job-1").checkpoint)
    ) as { responses: Array<Array<{ retryAttempts?: number }>> };
    // 새 필드가 실제로 들어 있다(시험이 비어 있지 않다).
    expect(stored.responses.flat().some((r) => r.retryAttempts === 2)).toBe(
      true
    );

    const read = readAuditCheckpoint(stored, scope);
    expect(read?.responses).toHaveLength(7);
    const fresh = makeAuditCheckpoint(
      scope,
      identity,
      Array.from({ length: T4.questions }, (_, i) => ({
        text: `q${i + 1}`,
        lang: "ko" as const,
        kind: "brand" as const,
      })),
      store.get("job-1").createdAt instanceof Date
        ? (store.get("job-1").createdAt as Date).toISOString()
        : undefined
    );
    expect(read?.prompts).toEqual(fresh.prompts);
    expect(read?.enginePlan).toEqual(fresh.enginePlan);
    expect(read?.version).toBe(fresh.version);
    expect(read?.engineConfigVersion).toBe(fresh.engineConfigVersion);
  });

  it("(b) 플래그 꺼짐: queryAllEngines 결과가 모의 응답과 JSON 동일(재시도·격리·빈 응답 오류화 없음)", async () => {
    const rules = [
      {
        engine: "claude" as const,
        calls: [1],
        fault: { type: "http5xx" as const },
      },
      {
        engine: "gemini" as const,
        calls: [1],
        fault: { type: "http429" as const, retryAfterSec: 5 },
      },
      {
        engine: "perplexity" as const,
        calls: [1],
        fault: { type: "empty" as const },
      },
    ];
    const engines = ["chatgpt", "claude", "perplexity", "gemini"] as const;
    harness.setPlan({ seed: 1, rules });
    const viaQueryAll = await queryAllEngines(
      { prompt: "q1", language: "ko" },
      engines
    );
    expect(harness.calls).toHaveLength(4); // 재시도 없음

    harness.setPlan({ seed: 1, rules });
    const direct = await Promise.all(
      engines.map((engineId) =>
        adapter({ prompt: "q1", language: "ko", engineId })
      )
    );
    expect(JSON.stringify(viaQueryAll)).toBe(JSON.stringify(direct));
  });

  it("(b) 플래그 꺼짐 = 플래그 켬+장애 없음: 러너 결과 JSON 이 같고 새 키가 없다", async () => {
    seedJob(4);
    await clock.settle(runAuditJob(runInput), { maxMs: 600_000, stepMs: 500 });
    const off = stable(store.get("job-1").result);
    expect(off).not.toMatch(/retryAttempts|paused|engineErrors/);

    store.reset();
    harness.setPlan({ rules: [] });
    resetEngineBreakers();
    resetRetryBudget();
    ALL_FLAGS_ON();
    seedJob(4);
    await clock.settle(runAuditJob(runInput), { maxMs: 600_000, stepMs: 500 });
    expect(stable(store.get("job-1").result)).toBe(off);
  });

  it("(c) 켜고 시작 → 중단 → 이어가기 대기 → 모든 플래그를 끈 뒤에도 이어가기가 오류 없이 끝나고 남은 질문만 묻는다", async () => {
    ALL_FLAGS_ON();
    seedJob(T4.questions);
    await crashAfterSaved(T4.interruptAfterSavedQuestions, () =>
      runAuditJob(runInput)
    );
    expect(await sweep()).toBe(1);
    vi.unstubAllEnvs(); // 롤백: 플래그 전부 꺼짐
    const callsBefore = harness.calls.length;

    const outcome = await clock.settle(
      continueAuditJob("job-1", { invocationStartedAtMs: Date.now() }),
      { maxMs: 30 * 60_000, stepMs: 500 }
    );
    expect(outcome).toMatchObject({ ran: true, mode: "continue" });
    expect(store.get("job-1").status).toBe("completed");
    expect(store.statusTrail("job-1")).not.toContain("failed");
    expect(
      harness.calls.slice(callsBefore).some((c) => /^q[1-7]$/.test(c.prompt))
    ).toBe(false);
    expect(Math.max(...harness.callsPerCell().values())).toBe(1);
  });
});
