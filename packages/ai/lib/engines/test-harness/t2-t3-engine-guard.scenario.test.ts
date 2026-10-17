import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stabilityLimits } from "../../stability-flags";
import { aggregateAudit } from "../aggregate";
import type { EngineId, EngineResponse } from "../types";
import {
  createFaultHarness,
  type FaultPlan,
  koreanAdaptersMock,
} from "./fault-engine";
import { sdkLikeGlobalAdaptersMock } from "./sdk-fault-adapters";

// U5 2단계 — T2(엔진 1개 100% 5xx + 다른 엔진 20% 429)·T3(빈 응답 20%)의 **엔진 호출 층** 시험.
// 진짜 queryAllEngines + 진짜 칸 재시도·서킷브레이커(U1) 위에서, 어댑터 자리만 모의 엔진으로 바꾼다.
// 운영·유료 호출 0. 시간은 가짜 시계. 러너(runAuditJob)·결과 JSON 층은 packages/audit/test-harness/scenarios 가 맡는다.
// 시나리오 문서: packages/audit/test-harness/scenarios/T2-*.md, T3-*.md

// 오류는 throw 방식으로 주입하고 sdkLikeAdapter 가 실제 어댑터처럼 힌트(Retry-After·재시도 가능)를 붙여 돌려준다.
const harness = createFaultHarness({ rules: [] }, { errorStyle: "throw" });
vi.mock("../global-adapters", () => sdkLikeGlobalAdaptersMock(harness));
vi.mock("../korean-adapters", () => koreanAdaptersMock(harness));

const { queryAllEngines } = await import("../index");
const { resetEngineBreakers, isEnginePausedMessage } = await import(
  "../engine-breaker"
);
const { resetRetryBudget, retryBudgetSnapshot } = await import("../cell-retry");

const ENGINES: EngineId[] = ["chatgpt", "claude", "perplexity", "gemini"];
const SEED = 20_261_018;
// T2 는 시드 3 을 쓴다: SEED(20261018)로는 gemini 호출 24번 안에 429 가 한 번도 안 나와 시험이 비어 버린다
// (시드 스캔 실측). 시드 3 은 gemini 호출 7·8·9·13·16번째가 429 다.
const T2_SEED = 3;
const plan = (rules: FaultPlan["rules"], seed = SEED): FaultPlan => ({
  rules,
  seed,
});
const t2Plan = (rules: FaultPlan["rules"] = T2_RULES): FaultPlan =>
  plan(rules, T2_SEED);

const T2_RULES: FaultPlan["rules"] = [
  { engine: "claude", fault: { type: "http5xx", status: 503 } },
  {
    engine: "gemini",
    probability: 0.2,
    fault: { type: "http429", retryAfterSec: 5 },
  },
];

const withFaultFlagsOn = () => {
  vi.stubEnv("STABILITY_CELL_RETRY_ENABLED", "1");
  vi.stubEnv("STABILITY_ENGINE_BREAKER_ENABLED", "1");
  vi.stubEnv("STABILITY_EMPTY_AS_ERROR_ENABLED", "1");
};

/** 러너처럼 질문을 차례로 묻는다(질문 안에서는 엔진 병렬). 가짜 시계를 밀어 재시도 대기를 지나간다. */
const runQuestions = async (count: number): Promise<EngineResponse[][]> => {
  const batches: EngineResponse[][] = [];
  for (let i = 1; i <= count; i++) {
    const pending = queryAllEngines(
      { prompt: `q${i}`, language: "ko" },
      ENGINES
    );
    let done = false;
    pending.then(
      () => {
        done = true;
      },
      () => {
        done = true;
      }
    );
    for (let step = 0; step < 120 && !done; step++) {
      await vi.advanceTimersByTimeAsync(500);
    }
    batches.push(await pending);
  }
  return batches;
};

const callSignature = () =>
  harness.calls.map((c) => `${c.engine}|${c.prompt}|${c.outcome}|${c.callNo}`);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T09:00:00+09:00"));
  harness.setPlan({ rules: [] });
  resetEngineBreakers();
  resetRetryBudget();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("T2 — 엔진 1개 100% 5xx + 다른 엔진 20% 429 (플래그 켬)", () => {
  const limits = stabilityLimits();
  const QUESTIONS = 20;

  it("칸당 호출·총 재시도·격리·오류 칸 표기가 합격선 안이다", async () => {
    withFaultFlagsOn();
    harness.setPlan(t2Plan());
    const batches = await runQuestions(QUESTIONS);
    const rows = batches.flat();
    const cells = QUESTIONS * ENGINES.length;

    // 1) 칸당 호출 ≤ 1 + cellMaxRetries
    const perCell = [...harness.callsPerCell().values()];
    expect(Math.max(...perCell)).toBeLessThanOrEqual(1 + limits.cellMaxRetries);

    // 2) 총 재시도 ≤ max(1, floor(칸 수 × 20%)) — 작은 표본 최소 1회 규칙 포함.
    const budget = retryBudgetSnapshot();
    expect(budget.calls).toBe(cells);
    expect(budget.retries).toBeLessThanOrEqual(
      Math.max(1, Math.floor(budget.calls * limits.retryTotalShare))
    );
    const blockedCells = rows.filter((r) =>
      isEnginePausedMessage(r.errorMessage)
    ).length;
    // 실제 호출 = (격리로 막힌 칸 제외한 칸) + 재시도. 호출 수가 예산 장부와 일치한다.
    expect(harness.calls.length).toBe(cells - blockedCells + budget.retries);

    // 3) 장애 엔진은 연속 3번 최종 실패 뒤 격리 — 이후 호출 0, 사유는 'paused'.
    const claudeCalls = harness.callsFor("claude");
    expect(limits.breakerFailThreshold).toBe(3);
    expect(claudeCalls.length).toBeGreaterThanOrEqual(3);
    expect(
      claudeCalls.every((c) => ["q1", "q2", "q3"].includes(c.prompt))
    ).toBe(true);
    const claudeRows = rows.filter((r) => r.engineId === "claude");
    expect(claudeRows).toHaveLength(QUESTIONS);
    expect(
      claudeRows.slice(0, 3).map((r) => isEnginePausedMessage(r.errorMessage))
    ).toEqual([false, false, false]);
    expect(
      claudeRows.slice(3).every((r) => isEnginePausedMessage(r.errorMessage))
    ).toBe(true);

    // 4) 오류 칸은 어떤 경우에도 「노출 없음」 값을 만들지 않는다 — errorMessage 가 남고 측정값이 비어 있다.
    const errorRows = rows.filter((r) => r.errorMessage);
    expect(errorRows.length).toBeGreaterThanOrEqual(QUESTIONS); // claude 20칸
    for (const row of errorRows) {
      expect(row.rawResponse).toBe("");
      expect(row.brandMentioned).toBe(false);
      expect(row.mentionPosition).toBeNull();
    }
    // 분모(verifiedCount)는 오류 칸을 뺀 칸 수와 같다.
    for (const batch of batches) {
      const metrics = aggregateAudit(batch);
      expect(metrics.verifiedCount).toBe(
        batch.filter((r) => !r.errorMessage).length
      );
    }

    // 시험이 비어 있지 않다: gemini 429 가 실제로 났고, 그중 재시도된 칸이 있다.
    expect(
      harness.callsFor("gemini").filter((c) => c.outcome === "http429").length
    ).toBeGreaterThanOrEqual(3);
    // 5) 429 + Retry-After(5초): 재시도가 있었다면 간격 ≥ 5초이고 상한(15초)을 넘지 않는다.
    const geminiByPrompt = new Map<string, number[]>();
    for (const c of harness.callsFor("gemini")) {
      geminiByPrompt.set(c.prompt, [
        ...(geminiByPrompt.get(c.prompt) ?? []),
        c.at,
      ]);
    }
    const retried = [...geminiByPrompt.values()].filter((t) => t.length > 1);
    expect(retried.length).toBeGreaterThanOrEqual(2);
    for (const times of retried) {
      expect(times[1] - times[0]).toBeGreaterThanOrEqual(5000);
      expect(times[1] - times[0]).toBeLessThanOrEqual(limits.retryAfterCapMs);
    }
  });

  it("같은 시드·같은 입력이면 호출 순서와 결과가 그대로 재현된다", async () => {
    withFaultFlagsOn();
    harness.setPlan(t2Plan());
    const first = await runQuestions(QUESTIONS);
    const firstCalls = callSignature();
    const firstJson = JSON.stringify(first);

    harness.setPlan(t2Plan());
    resetEngineBreakers();
    resetRetryBudget();
    vi.setSystemTime(new Date("2026-10-18T09:00:00+09:00"));
    const second = await runQuestions(QUESTIONS);
    expect(callSignature()).toEqual(firstCalls);
    expect(JSON.stringify(second)).toBe(firstJson);
  });

  it("격리 5분(쿨다운)이 지나면 장애 엔진을 시험 호출하고, 또 실패하면 다시 격리한다", async () => {
    withFaultFlagsOn();
    harness.setPlan(t2Plan([T2_RULES[0]]));
    await runQuestions(5); // q1~q3 에서 격리
    const callsBeforeCooldown = harness.callsFor("claude").length;

    // 쿨다운 전: 호출 0
    await runQuestions(1);
    expect(harness.callsFor("claude")).toHaveLength(callsBeforeCooldown);

    // 쿨다운 후: 반열림 시험 — 호출이 생기되 (최초 1 + 재시도) 를 넘지 않는다.
    await vi.advanceTimersByTimeAsync(limits.breakerCooldownMs);
    const pending = queryAllEngines(
      { prompt: "q-probe", language: "ko" },
      ENGINES
    );
    for (let i = 0; i < 60; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }
    const probeRows = await pending;
    const probeCalls = harness
      .callsFor("claude")
      .filter((c) => c.prompt === "q-probe");
    expect(probeCalls.length).toBeGreaterThanOrEqual(1);
    expect(probeCalls.length).toBeLessThanOrEqual(1 + limits.cellMaxRetries);
    expect(probeRows.find((r) => r.engineId === "claude")?.errorMessage).toBe(
      "503 Service Unavailable"
    );

    // 시험이 실패했으니 바로 다음 질문은 다시 격리 — 호출 0.
    const afterProbe = harness.callsFor("claude").length;
    await runQuestions(1);
    expect(harness.callsFor("claude")).toHaveLength(afterProbe);
  });

  it("Retry-After 없는 429 는 재시도하지 않는다(켜기 전용 환경값을 켜면 재시도)", async () => {
    withFaultFlagsOn();
    harness.setPlan(plan([{ engine: "gemini", fault: { type: "http429" } }]));
    const [row] = await runQuestionsFor(["gemini"]);
    expect(harness.callsFor("gemini")).toHaveLength(1);
    expect(row.errorMessage).toBe("429 Too Many Requests");

    harness.setPlan(plan([{ engine: "gemini", fault: { type: "http429" } }]));
    resetEngineBreakers();
    resetRetryBudget();
    vi.stubEnv("STABILITY_RETRY_429_WITHOUT_RETRY_AFTER", "1");
    await runQuestionsFor(["gemini"]);
    expect(harness.callsFor("gemini")).toHaveLength(2);
  });

  it("5xx 는 한 번 재시도하고, 재시도가 성공하면 정상 칸이다(retryAttempts 2)", async () => {
    withFaultFlagsOn();
    harness.setPlan(
      plan([{ engine: "claude", calls: [1], fault: { type: "http5xx" } }])
    );
    const [row] = await runQuestionsFor(["claude"]);
    expect(harness.callsFor("claude")).toHaveLength(2);
    expect(row.errorMessage).toBeNull();
    expect(row.retryAttempts).toBe(2);
  });

  it("꺼짐 대조: 같은 장애에서 재시도·격리가 없다(칸당 1회, 5번 연속 호출)", async () => {
    harness.setPlan(t2Plan());
    const batches = await runQuestions(5);
    expect(Math.max(...harness.callsPerCell().values())).toBe(1);
    expect(harness.callsFor("claude")).toHaveLength(5);
    expect(
      batches.flat().some((r) => isEnginePausedMessage(r.errorMessage))
    ).toBe(false);
  });
});

const runQuestionsFor = async (
  engines: EngineId[]
): Promise<EngineResponse[]> => {
  const pending = queryAllEngines({ prompt: "q1", language: "ko" }, engines);
  for (let i = 0; i < 60; i++) {
    await vi.advanceTimersByTimeAsync(500);
  }
  return await pending;
};

describe("T3 — 빈 응답 20% 주입", () => {
  const QUESTIONS = 20;
  const T3_RULES: FaultPlan["rules"] = [
    { engine: "chatgpt", probability: 0.2, fault: { type: "empty" } },
    { engine: "perplexity", probability: 0.2, fault: { type: "empty" } },
  ];
  const strip = (row: EngineResponse) => ({ ...row, durationMs: 0 });

  it("켬: 빈 응답은 재시도되고, 끝내 비면 사유가 남는 오류 칸으로 분모에서 빠진다. 정상 칸은 변하지 않는다", async () => {
    withFaultFlagsOn();
    // 기준선: 장애 없음
    harness.setPlan(plan([]));
    const baseline = (await runQuestions(QUESTIONS)).flat();
    const baselineByCell = new Map(
      baseline.map((r, i) => [
        `${r.engineId}::q${Math.floor(i / ENGINES.length) + 1}`,
        JSON.stringify(strip(r)),
      ])
    );

    resetEngineBreakers();
    resetRetryBudget();
    harness.setPlan(plan(T3_RULES));
    const batches = await runQuestions(QUESTIONS);
    const rows = batches.flat();
    const limits = stabilityLimits();

    // 빈 응답이 실제로 주입됐다(시험이 아무것도 안 보는 일을 막는다).
    const emptyCalls = harness.calls.filter((c) => c.outcome === "empty");
    expect(emptyCalls.length).toBeGreaterThan(0);

    // 칸당 호출 ≤ 1 + cellMaxRetries
    expect(Math.max(...harness.callsPerCell().values())).toBeLessThanOrEqual(
      1 + limits.cellMaxRetries
    );

    // 끝내 빈 칸 = 오류 칸(사유 기록). 그 칸의 모든 시도가 빈 응답이었다.
    const emptyErrorRows = rows.filter((r) =>
      /returned an empty answer/.test(r.errorMessage ?? "")
    );
    expect(emptyErrorRows.length).toBeGreaterThan(0);
    for (const row of emptyErrorRows) {
      expect(row.rawResponse).toBe("");
      expect(row.brandMentioned).toBe(false);
      expect(["chatgpt", "perplexity"]).toContain(row.engineId);
    }
    // 정상으로 돌아온 칸(errorMessage 없음)에는 빈 답이 없다 — 빈 응답이 미노출로 세지 않는다.
    expect(
      rows.filter((r) => !r.errorMessage).every((r) => r.rawResponse !== "")
    ).toBe(true);

    // 분모: 오류 칸을 뺀 칸 수. 빈 칸이 미노출로 들어가 노출률을 깎지 않는다(노출률은 같거나 오른다).
    for (const batch of batches) {
      const metrics = aggregateAudit(batch);
      expect(metrics.verifiedCount).toBe(
        batch.filter((r) => !r.errorMessage).length
      );
      expect(metrics.sov === null || metrics.sov >= 0).toBe(true);
    }

    // 정상 칸 불변: 한 번도 장애가 없던 칸은 기준선과 JSON 이 같다.
    const perCell = harness.callsPerCell();
    let comparedCells = 0;
    for (const [index, row] of rows.entries()) {
      const prompt = `q${Math.floor(index / ENGINES.length) + 1}`;
      const key = `${row.engineId}::${prompt}`;
      const record = harness.calls.find(
        (c) => c.engine === row.engineId && c.prompt === prompt
      );
      if (perCell.get(key) === 1 && record?.outcome === "ok") {
        expect(JSON.stringify(strip(row))).toBe(baselineByCell.get(key));
        comparedCells += 1;
      }
    }
    expect(comparedCells).toBeGreaterThan(QUESTIONS * 2);
  });

  it("같은 시드·같은 입력이면 결과가 그대로 재현된다", async () => {
    withFaultFlagsOn();
    harness.setPlan(plan(T3_RULES));
    const first = JSON.stringify(await runQuestions(QUESTIONS));
    harness.setPlan(plan(T3_RULES));
    resetEngineBreakers();
    resetRetryBudget();
    const second = JSON.stringify(await runQuestions(QUESTIONS));
    expect(second).toBe(first);
  });

  it("꺼짐 대조(1단계 특성화와 같은 결과): 빈 응답은 정상 응답이라 호출 1회·사유 없음·분모에 들어가 미노출로 센다", async () => {
    harness.setPlan(plan([{ engine: "perplexity", fault: { type: "empty" } }]));
    const rows = await queryAllEngines({ prompt: "q1", language: "ko" }, [
      "chatgpt",
      "claude",
      "perplexity",
    ]);
    const perplexity = rows.find((r) => r.engineId === "perplexity");
    expect(harness.callsFor("perplexity")).toHaveLength(1);
    expect(perplexity).toMatchObject({
      errorMessage: null,
      rawResponse: "",
      brandMentioned: false,
      isStub: false,
    });
    const metrics = aggregateAudit(rows);
    // 정상·노출 2(chatgpt·claude) + 빈 응답 1(분모 포함) → 분모 3, 노출률 2/3.
    expect(metrics.verifiedCount).toBe(3);
  });
});
