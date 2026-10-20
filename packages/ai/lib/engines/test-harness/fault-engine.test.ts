import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFaultHarness,
  makeQueryAllEngines,
  seededRandom,
} from "./fault-engine";

const q = (engineId: "claude" | "gemini" | "chatgpt", prompt = "q") => ({
  engineId,
  language: "ko" as const,
  prompt,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fault harness 자체 시험", () => {
  it("호출 번호(calls) 지정은 그 번째에만 장애를 넣는다", async () => {
    const h = createFaultHarness({
      rules: [{ engine: "claude", calls: [2], fault: { type: "http5xx" } }],
    });
    const r1 = await h.adapter(q("claude"));
    const r2 = await h.adapter(q("claude"));
    const r3 = await h.adapter(q("claude"));
    expect([r1, r2, r3].map((r) => r.errorMessage)).toEqual([
      null,
      "503 Service Unavailable",
      null,
    ]);
    expect(h.callsFor("claude").map((c) => c.outcome)).toEqual([
      "ok",
      "http5xx",
      "ok",
    ]);
  });

  it("범위(fromCall/toCall)와 첫 일치 규칙 우선", async () => {
    const h = createFaultHarness({
      rules: [
        { engine: "gemini", fromCall: 2, toCall: 3, fault: { type: "empty" } },
        { engine: "gemini", fromCall: 3, fault: { type: "network" } },
      ],
    });
    const outcomes: string[] = [];
    for (let i = 0; i < 4; i++) {
      await h.adapter(q("gemini"));
      outcomes.push(h.callsFor("gemini")[i]?.outcome ?? "?");
    }
    // 3번째는 두 규칙이 다 맞지만 앞 규칙(empty)이 이긴다.
    expect(outcomes).toEqual(["ok", "empty", "empty", "network"]);
  });

  it("확률 규칙은 시드가 같으면 같은 호출 번호에 같은 결과를 낸다", async () => {
    const run = async (seed: number) => {
      const h = createFaultHarness({
        seed,
        rules: [
          { engine: "claude", probability: 0.2, fault: { type: "empty" } },
        ],
      });
      for (let i = 0; i < 200; i++) {
        await h.adapter(q("claude", `p${i}`));
      }
      return h.callsFor("claude").map((c) => c.outcome);
    };
    const a = await run(11);
    const b = await run(11);
    const c = await run(12);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    const rate = a.filter((o) => o === "empty").length / 200;
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.3);
  });

  it("엔진마다 난수열이 독립이다(다른 엔진 호출이 끼어들어도 결과 불변)", async () => {
    const rules = [
      {
        engine: "claude" as const,
        probability: 0.5,
        fault: { type: "empty" as const },
      },
    ];
    const alone = createFaultHarness({ seed: 3, rules });
    const mixed = createFaultHarness({ seed: 3, rules });
    for (let i = 0; i < 30; i++) {
      await alone.adapter(q("claude"));
      await mixed.adapter(q("gemini"));
      await mixed.adapter(q("claude"));
    }
    expect(mixed.callsFor("claude").map((c) => c.outcome)).toEqual(
      alone.callsFor("claude").map((c) => c.outcome)
    );
  });

  it("429 의 Retry-After 가 오류 문구와 throw 방식 headers 에 실린다", async () => {
    const h = createFaultHarness(
      {
        rules: [
          { engine: "claude", fault: { type: "http429", retryAfterSec: 9 } },
        ],
      },
      { errorStyle: "throw" }
    );
    await expect(h.adapter(q("claude"))).rejects.toMatchObject({
      status: 429,
      headers: { "retry-after": "9" },
    });
  });

  it("hang 은 signal 취소 시 그 사유로 거절하고 기록에 aborted 를 남긴다", async () => {
    const h = createFaultHarness({
      rules: [{ engine: "claude", fault: { type: "hang" } }],
    });
    const controller = new AbortController();
    const pending = h.adapter({ ...q("claude"), signal: controller.signal });
    expect(h.inFlight).toBe(1);
    controller.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
    expect(h.inFlight).toBe(0);
    expect(h.calls[0]).toMatchObject({ outcome: "aborted" });
    expect(h.calls[0]?.signalAborted()).toBe(true);
  });

  it("delay 뒤 then 장애로 이어진다(가짜 시계)", async () => {
    vi.useFakeTimers();
    const h = createFaultHarness({
      rules: [
        {
          engine: "gemini",
          fault: { type: "delay", ms: 3000, afterDelay: { type: "http429" } },
        },
      ],
    });
    const pending = h.adapter(q("gemini"));
    await vi.advanceTimersByTimeAsync(3000);
    expect((await pending).errorMessage).toBe("429 Too Many Requests");
    expect(h.calls[0]?.fault).toBe("http429");
  });

  it("makeQueryAllEngines 는 던진 오류를 errorMessage 행으로 바꾸고 엔진 순서를 지킨다", async () => {
    const h = createFaultHarness(
      { rules: [{ engine: "gemini", fault: { type: "network" } }] },
      { errorStyle: "throw" }
    );
    const events: string[] = [];
    const rows = await makeQueryAllEngines(h)(
      { prompt: "p", language: "ko" },
      ["chatgpt", "gemini"],
      (e) => events.push(`${e.engineId}:${e.phase}`)
    );
    expect(rows.map((r) => r.engineId)).toEqual(["chatgpt", "gemini"]);
    expect(rows[1]?.errorMessage).toBe("fetch failed: ECONNRESET");
    expect(events).toContain("gemini:finished");
  });

  it("seededRandom 은 0~1 이고 결정적이다", () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    for (let i = 0; i < 20; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
