import {
  resetRetryBudget,
  retryBudgetSnapshot,
} from "@repo/ai/lib/engines/cell-retry";
import {
  isEnginePausedMessage,
  resetEngineBreakers,
} from "@repo/ai/lib/engines/engine-breaker";
import {
  createFaultHarness,
  type FaultPlan,
  koreanAdaptersMock,
} from "@repo/ai/lib/engines/test-harness/fault-engine";
import { sdkLikeGlobalAdaptersMock } from "@repo/ai/lib/engines/test-harness/sdk-fault-adapters";
import { stabilityLimits } from "@repo/ai/lib/stability-flags";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyAnswer } from "../../answer-buckets";
import { installFakeClock } from "../fake-clock";
import { createMemoryJobStore } from "../memory-job-store";
import { SCENARIO_SEED } from "./plans";

// U5 2단계 — T2·T3 의 **러너(runAuditJob) 층** 시험.
// 진짜 runAuditJob + 진짜 queryAllEngines(칸 재시도·서킷브레이커) + 메모리 AuditJob. 어댑터 자리만 모의 엔진.
// 운영·유료 호출 0(DB 는 메모리, 신원·판정·PDF·추적은 로컬 대역 — runner-faults.characterization.test.ts 와 같은 방식).
//
// 엔진 층(Retry-After 간격·격리 반열림·정상 칸 불변)은 packages/ai/lib/engines/test-harness/t2-t3-engine-guard.scenario.test.ts.
// 이 파일은 「결과 JSON·분모·engineErrors」 층만 본다.

const store = createMemoryJobStore();
const harness = createFaultHarness({ rules: [] }, { errorStyle: "throw" });

vi.mock("@repo/database", () => store.databaseModule());
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@repo/ai/lib/engines/global-adapters", () =>
  sdkLikeGlobalAdaptersMock(harness)
);
vi.mock("@repo/ai/lib/engines/korean-adapters", () =>
  koreanAdaptersMock(harness)
);
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
const { makeAuditCheckpoint } = await import("../../checkpoint");

const createdAt = new Date("2026-10-18T09:00:00+09:00");
const input = {
  jobId: "job-1",
  domain: "example.com",
  brandName: "Example",
  language: "both" as const,
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
const checkpointFor = (questionCount: number) =>
  makeAuditCheckpoint(
    { domain: "example.com", language: "both" },
    identity,
    Array.from({ length: questionCount }, (_, i) => ({
      text: `q${i + 1}`,
      lang: "ko" as const,
      kind: "brand" as const,
    })),
    createdAt.toISOString()
  );

interface StoredRow {
  brandMentioned?: boolean | null;
  engineId: string;
  errorMessage?: string | null;
  isStub?: boolean | null;
  mentionQuality?: string | null;
  rawResponse?: string;
}
interface Result {
  engineResponses: StoredRow[];
  measurementContext?: {
    engineErrors?: {
      byEngine: Record<string, Record<string, number>>;
      total: number;
    };
  };
  metrics?: Record<string, unknown>;
}

const plan = (rules: FaultPlan["rules"], seed: number): FaultPlan => ({
  rules,
  seed,
});

const T2_SEED = 3; // 시드 20261018 은 gemini 429 가 24번 안에 한 번도 안 나온다(시드 스캔 실측).
const T2_RULES: FaultPlan["rules"] = [
  { engine: "claude", fault: { type: "http5xx", status: 503 } },
  {
    engine: "gemini",
    probability: 0.2,
    fault: { type: "http429", retryAfterSec: 5 },
  },
];
const T3_RULES: FaultPlan["rules"] = [
  { engine: "chatgpt", probability: 0.2, fault: { type: "empty" } },
  { engine: "perplexity", probability: 0.2, fault: { type: "empty" } },
];

const onFlags = () => {
  vi.stubEnv("STABILITY_CELL_RETRY_ENABLED", "1");
  vi.stubEnv("STABILITY_ENGINE_BREAKER_ENABLED", "1");
  vi.stubEnv("STABILITY_EMPTY_AS_ERROR_ENABLED", "1");
};

let clock: ReturnType<typeof installFakeClock>;
const runJob = async (questions: number, jobId = "job-1"): Promise<Result> => {
  store.seed({
    id: jobId,
    createdAt,
    domain: "example.com",
    checkpoint: checkpointFor(questions),
  });
  await clock.settle(runAuditJob({ ...input, jobId }), {
    maxMs: 60 * 60_000,
    stepMs: 500,
  });
  if (store.get(jobId).status !== "completed") {
    throw new Error(`작업이 완료되지 않음: ${String(store.get(jobId).status)}`);
  }
  return store.get(jobId).result as Result;
};

beforeEach(() => {
  clock = installFakeClock(createdAt);
  store.reset();
  harness.setPlan({ rules: [] });
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

describe("T2 러너 층 — 엔진 1개 100% 5xx + 다른 엔진 20% 429 (질문 20개, 플래그 켬)", () => {
  it("호출 상한·총 재시도·격리 사유·결과 요약·오류 칸 표기가 합격선 안이다", async () => {
    onFlags();
    harness.setPlan(plan(T2_RULES, T2_SEED));
    const limits = stabilityLimits();
    const result = await runJob(20);
    const planned = checkpointFor(20).enginePlan.flat().length;

    // 칸당 호출 ≤ 1 + 재시도 상한.
    expect(Math.max(...harness.callsPerCell().values())).toBeLessThanOrEqual(
      1 + limits.cellMaxRetries
    );
    // 총 재시도 ≤ 호출의 20% (작은 표본 최소 1회 규칙 포함 — 장부 기준).
    const llmCells = retryBudgetSnapshot().calls;
    expect(llmCells).toBeGreaterThan(0);
    expect(retryBudgetSnapshot().retries).toBeLessThanOrEqual(
      Math.max(1, Math.floor(llmCells * limits.retryTotalShare))
    );
    // 장애 엔진은 격리: 호출이 계획한 칸 수(20)보다 훨씬 적다. (재시도가 있어도 5번 안쪽)
    const claudePlanned = checkpointFor(20).enginePlan.filter((e) =>
      e.includes("claude")
    ).length;
    expect(harness.callsFor("claude").length).toBeLessThan(claudePlanned);
    expect(planned).toBeGreaterThan(0);

    // 결과: engineErrors 에 엔진별 종류가 남고, 격리는 paused 로 기록된다.
    const errors = result.measurementContext?.engineErrors;
    expect(errors).toBeDefined();
    expect(errors?.byEngine.claude.paused).toBeGreaterThan(0);
    expect(errors?.byEngine.claude.error).toBe(3); // 연속 3회 최종 실패 뒤 격리
    expect(
      (errors?.byEngine.claude.paused ?? 0) +
        (errors?.byEngine.claude.error ?? 0)
    ).toBe(claudePlanned);

    // 오류 칸이 미노출/모름으로 바뀌는 경로 0.
    const errorRows = result.engineResponses.filter((r) => r.errorMessage);
    expect(errorRows.length).toBeGreaterThanOrEqual(claudePlanned);
    for (const row of errorRows) {
      expect(classifyAnswer(row)).toBe("engine_error");
      expect(row.mentionQuality).not.toBe("absent");
      expect(row.brandMentioned).toBeFalsy();
    }
    expect(
      errorRows.filter((r) => isEnginePausedMessage(r.errorMessage)).length
    ).toBe(errors?.byEngine.claude.paused);
  });

  it("꺼짐 대조: 같은 장애에서 칸당 1회·격리 없음·결과에 paused 키 없음", async () => {
    harness.setPlan(plan(T2_RULES, T2_SEED));
    const result = await runJob(6);
    expect(Math.max(...harness.callsPerCell().values())).toBe(1);
    const claudePlanned = checkpointFor(6).enginePlan.filter((e) =>
      e.includes("claude")
    ).length;
    expect(harness.callsFor("claude")).toHaveLength(claudePlanned);
    expect(result.measurementContext?.engineErrors?.byEngine.claude).toEqual({
      empty: 0,
      error: claudePlanned,
      rate_limit: 0,
      recovered: 0,
      timeout: 0,
    });
  });
});

describe("T3 러너 층 — 빈 응답 20% (질문 20개)", () => {
  it("켬: 빈 응답은 오류 칸(사유 기록·분모 제외)으로, 정상 칸은 불변, 같은 시드는 같은 결과", async () => {
    onFlags();
    harness.setPlan(plan(T3_RULES, SCENARIO_SEED));
    const result = await runJob(20);
    const rows = result.engineResponses;

    expect(
      harness.calls.filter((c) => c.outcome === "empty").length
    ).toBeGreaterThan(0);
    expect(Math.max(...harness.callsPerCell().values())).toBeLessThanOrEqual(
      1 + stabilityLimits().cellMaxRetries
    );
    // 끝내 빈 칸 = 사유가 남는 오류 칸(engine_error). 빈 칸이 「모름/미노출」로 세지 않는다.
    const emptyErrorRows = rows.filter((r) =>
      /returned an empty answer/.test(r.errorMessage ?? "")
    );
    expect(emptyErrorRows.length).toBeGreaterThan(0);
    for (const row of emptyErrorRows) {
      expect(classifyAnswer(row)).toBe("engine_error");
    }
    // errorMessage 없는 정상 응답 칸은 모두 내용이 있다.
    expect(
      rows
        .filter((r) => !(r.errorMessage || r.isStub))
        .every((r) => (r.rawResponse ?? "") !== "")
    ).toBe(true);
    // 사유가 결과 요약에 empty 로, 어느 엔진인지와 함께 남는다.
    const byEngine = result.measurementContext?.engineErrors?.byEngine ?? {};
    const emptyTotal = Object.values(byEngine).reduce(
      (sum, e) => sum + (e.empty ?? 0),
      0
    );
    expect(emptyTotal).toBe(emptyErrorRows.length);
    for (const engine of Object.keys(byEngine)) {
      expect(["chatgpt", "perplexity"]).toContain(engine);
    }

    // 재현성: 같은 시드·같은 입력 → 결과 JSON 동일(시각·소요시간 제외).
    const stable = (value: unknown) =>
      JSON.stringify(value, (key, v) =>
        key === "durationMs" || /(At|Ms)$/.test(key) ? undefined : v
      );
    const first = stable(result);
    store.reset();
    harness.setPlan(plan(T3_RULES, SCENARIO_SEED));
    resetEngineBreakers();
    resetRetryBudget();
    const again = await runJob(20, "job-2");
    expect(stable(again)).toBe(first);
  });

  it("꺼짐 대조(1단계 특성화와 같은 결과): 빈 응답은 정상 응답 — 호출 1회·오류 요약 없음", async () => {
    harness.setPlan(
      plan([{ engine: "perplexity", fault: { type: "empty" } }], 42)
    );
    const result = await runJob(2);
    expect(Math.max(...harness.callsPerCell().values())).toBe(1);
    expect(result.measurementContext?.engineErrors).toBeUndefined();
  });
});
