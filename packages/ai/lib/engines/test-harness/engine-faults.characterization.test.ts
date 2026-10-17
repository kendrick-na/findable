import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aggregateAudit } from "../aggregate";
import {
  createFaultHarness,
  type FaultPlan,
  globalAdaptersMock,
  koreanAdaptersMock,
} from "./fault-engine";

// 특성화(characterization) 테스트 — 「지금 코드가 실제로 하는 일」을 기록한다.
// U1(엔진 재시도·서킷브레이커)이 합쳐지면 아래 일부는 **의도적으로 깨지고**, 그때
// 새 동작 단언(packages/audit/test-harness/scenarios 의 T2·T3)으로 교체한다.
// 깨졌다 = 동작이 바뀌었다는 신호이지 버그가 아니다.
//
// queryAllEngines 에 장애를 넣는 방법은 engine-timeout.test.ts 와 같다:
// 어댑터 모듈을 vi.mock 하고, mock 뒤에 index 를 동적 import 한다.
// 규칙은 시나리오마다 harness.setPlan 으로 갈아끼운다.

const harness = createFaultHarness({ rules: [] });

vi.mock("../global-adapters", () => globalAdaptersMock(harness));
vi.mock("../korean-adapters", () => koreanAdaptersMock(harness));

const { queryAllEngines } = await import("../index");

const base = { prompt: "q1", language: "ko" as const };
const plan = (rules: FaultPlan["rules"]): FaultPlan => ({ rules, seed: 7 });

beforeEach(() => {
  harness.setPlan({ rules: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("현재 동작 기록: 엔진 장애가 칸에 미치는 영향", () => {
  it("429 는 재시도 없이 그 칸을 바로 오류로 끝낸다(호출 1회, Retry-After 무시)", async () => {
    harness.setPlan(
      plan([
        { engine: "gemini", fault: { type: "http429", retryAfterSec: 30 } },
      ])
    );
    const [gemini] = await queryAllEngines(base, ["gemini"]);

    expect(harness.callsFor("gemini")).toHaveLength(1);
    expect(gemini?.errorMessage).toBe(
      "429 Too Many Requests (retry-after: 30s)"
    );
    expect(gemini?.rawResponse).toBe("");
    expect(gemini?.brandMentioned).toBe(false);
  });

  it("5xx 도 재시도 없이 오류 응답 1건이다 — 다른 엔진은 영향 없음", async () => {
    harness.setPlan(plan([{ engine: "claude", fault: { type: "http5xx" } }]));
    const [chatgpt, claude] = await queryAllEngines(base, [
      "chatgpt",
      "claude",
    ]);

    expect(harness.callsFor("claude")).toHaveLength(1);
    expect(claude?.errorMessage).toBe("503 Service Unavailable");
    expect(chatgpt?.errorMessage).toBeNull();
    expect(chatgpt?.brandMentioned).toBe(true);
  });

  it("장애 엔진을 계속 부른다 — 서킷브레이커(제외) 없음", async () => {
    harness.setPlan(plan([{ engine: "claude", fault: { type: "http5xx" } }]));
    for (let i = 0; i < 5; i++) {
      await queryAllEngines(base, ["claude"]);
    }
    // U1 합친 뒤에는 연속 장애 엔진이 제외되어 이 값이 5 미만이 되어야 한다.
    expect(harness.callsFor("claude")).toHaveLength(5);
    expect(harness.callsPerCell().get("claude::q1")).toBe(5);
  });

  it("네트워크 오류도 응답 행(errorMessage)으로 돌아온다", async () => {
    harness.setPlan(plan([{ engine: "naver", fault: { type: "network" } }]));
    const [naver] = await queryAllEngines(base, ["naver"]);
    expect(naver?.errorMessage).toBe("fetch failed: ECONNRESET");
    expect(harness.callsFor("naver")).toHaveLength(1);
  });

  it("어댑터가 던진 오류(throw 방식)는 queryAllEngines 가 errorMessage 행으로 바꾼다(durationMs 0)", async () => {
    const throwing = createFaultHarness(
      { rules: [{ engine: "gemini", fault: { type: "http429" } }] },
      { errorStyle: "throw" }
    );
    // 같은 mock 자리에 던지는 어댑터를 잠깐 끼우는 대신, 던짐 자체와 로그를 확인한다.
    await expect(
      throwing.adapter({ ...base, engineId: "gemini" })
    ).rejects.toMatchObject({ status: 429 });
    expect(throwing.callsFor("gemini")[0]?.outcome).toBe("http429");
  });

  it("빈 응답은 오류가 아니라 정상 응답으로 돌아온다(errorMessage null) — 사유 기록 없음", async () => {
    harness.setPlan(plan([{ engine: "perplexity", fault: { type: "empty" } }]));
    const [perplexity] = await queryAllEngines(base, ["perplexity"]);

    expect(harness.callsFor("perplexity")).toHaveLength(1);
    expect(perplexity).toMatchObject({
      errorMessage: null,
      rawResponse: "",
      brandMentioned: false,
      isStub: false,
    });
  });

  it("무한 대기 엔진은 60초 상한에서 끊기고 어댑터 signal 이 취소된다", async () => {
    vi.useFakeTimers();
    harness.setPlan(plan([{ engine: "claude", fault: { type: "hang" } }]));
    const pending = queryAllEngines(base, ["claude"]);
    await vi.advanceTimersByTimeAsync(60_000);
    const [claude] = await pending;

    expect(claude?.errorMessage).toBe("Engine claude timed out after 60000ms");
    expect(harness.callsFor("claude")).toHaveLength(1);
    expect(harness.callsFor("claude")[0]?.signalAborted()).toBe(true);
    expect(harness.callsFor("claude")[0]?.outcome).toBe("aborted");
  });

  it("지연 주입: 5초 늦게 정상 응답하면 가짜 시계로 정확히 5초 뒤에 끝난다", async () => {
    vi.useFakeTimers();
    harness.setPlan(
      plan([{ engine: "chatgpt", fault: { type: "delay", ms: 5000 } }])
    );
    const start = Date.now();
    const pending = queryAllEngines(base, ["chatgpt"]);
    await vi.advanceTimersByTimeAsync(4999);
    expect(harness.inFlight).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const [chatgpt] = await pending;
    expect(chatgpt?.errorMessage).toBeNull();
    expect(harness.callsFor("chatgpt")[0]?.settledAt).toBe(start + 5000);
  });
});

describe("현재 동작 기록: 오류·빈 응답이 집계(분모)에 미치는 영향", () => {
  it("오류 행은 분모(verifiedCount)에서 빠지고, 빈 응답 행은 분모에 들어가 미노출로 센다", async () => {
    harness.setPlan(
      plan([
        { engine: "claude", fault: { type: "http5xx" } },
        { engine: "perplexity", fault: { type: "empty" } },
      ])
    );
    const rows = await queryAllEngines(base, [
      "chatgpt", // 정상·노출
      "claude", // 5xx 오류
      "perplexity", // 빈 응답
    ]);
    const metrics = aggregateAudit(rows);

    // 오류(claude)는 분모 제외 — 안전한 쪽.
    expect(metrics.errors.map((e) => e.engineId)).toEqual(["claude"]);
    // 빈 응답(perplexity)은 분모 2 에 포함 → 노출률 1/2 = 50%.
    // T3(빈 응답 재시도 후 분모 제외)가 구현되면 분모는 1, sov 는 100 이 되어야 한다.
    expect(metrics.verifiedCount).toBe(2);
    expect(metrics.sov).toBe(50);
  });
});
