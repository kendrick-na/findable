// biome-ignore-all lint/suspicious/noBitwiseOperators: 시드 고정 난수(mulberry32)·해시는 비트 연산이 본질이다.
// U5 장애 주입 틀 — 모의 엔진 어댑터.
//
// 운영·유료 호출 0. 엔진 어댑터(EngineAdapter)와 같은 모양의 함수를 만들어
// 「엔진별로 N번째 호출에 지연·429·5xx·네트워크 오류·빈 응답·무한 대기」를 선언적으로 주입한다.
// 모든 호출은 `calls` 로그에 남아 "칸당 호출 ≤ 3" 같은 단언이 가능하다.
//
// 실제 어댑터(global-adapters.ts)의 오류 표현을 따른다:
//   - 호출 오류(429·5xx·네트워크)는 throw 가 아니라 `errorMessage` 가 채워진 정상 모양 응답으로 돌아온다.
//   - 중단(abort)만 throw 한다(어댑터가 abort 는 다시 던진다).
// 그래서 기본 `errorStyle` 은 "response". "throw" 는 어댑터가 던지는 경로를 시험할 때만 쓴다.

import type { EngineId, EngineQuery, EngineResponse } from "../types";

export type FaultKind =
  | { type: "ok"; mentioned?: boolean; rawResponse?: string }
  | { type: "delay"; ms: number; afterDelay?: FaultKind }
  | { type: "http429"; retryAfterSec?: number }
  | { type: "http5xx"; status?: number }
  | { type: "network" }
  | { type: "empty" }
  | { type: "hang" };

export interface FaultRule {
  /** 1부터 세는 호출 번호 목록(엔진별). 없으면 모든 호출이 후보. */
  calls?: readonly number[];
  engine: EngineId;
  /** 주입할 장애. */
  fault: FaultKind;
  /** 호출 번호 하한(포함). */
  fromCall?: number;
  /** 0~1. 시드 고정 난수로 결정. 없으면 1(항상). */
  probability?: number;
  /** 호출 번호 상한(포함). */
  toCall?: number;
}

export interface FaultPlan {
  /** 위에서부터 처음 맞는 규칙이 이긴다. 맞는 규칙이 없으면 정상 응답. */
  rules: readonly FaultRule[];
  /** 확률 판정용 시드. 같은 시드 + 같은 호출 순서 = 같은 결과. */
  seed?: number;
}

export type CallOutcome =
  | "ok"
  | "empty"
  | "http429"
  | "http5xx"
  | "network"
  | "aborted"
  | "pending";

export interface CallRecord {
  /** 호출이 시작된 시각(Date.now — 가짜 시계 위에서는 가짜 시각). */
  at: number;
  callNo: number;
  engine: EngineId;
  fault: FaultKind["type"];
  outcome: CallOutcome;
  prompt: string;
  /** 끝난 시각(끝나기 전에는 없음). */
  settledAt?: number;
  /** signal 이 (지금 시점에) 취소됐는가. */
  signalAborted: () => boolean;
}

export type ErrorStyle = "response" | "throw";

export interface FaultHarnessOptions {
  /** 오류 표현 방식. 기본 "response"(실제 어댑터와 같다). */
  errorStyle?: ErrorStyle;
}

/** 시드 고정 난수(mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d_2b_79_f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const hashString = (text: string): number => {
  let h = 2_166_136_261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16_777_619);
  }
  return h >>> 0;
};

export function okResponse(
  engineId: EngineId,
  options: { mentioned?: boolean; rawResponse?: string } = {}
): EngineResponse {
  const mentioned = options.mentioned ?? true;
  return {
    brandMentioned: mentioned,
    citedSources: [],
    durationMs: 10,
    engineId,
    errorMessage: null,
    isStub: false,
    mentionListSize: mentioned ? 3 : null,
    mentionPosition: mentioned ? 1 : null,
    rawResponse: options.rawResponse ?? `answer from ${engineId}`,
    sentiment: null,
    shareOfVoice: null,
  };
}

export function errorResponse(
  engineId: EngineId,
  message: string
): EngineResponse {
  return {
    brandMentioned: false,
    citedSources: [],
    durationMs: 10,
    engineId,
    errorMessage: message,
    isStub: false,
    mentionListSize: null,
    mentionPosition: null,
    rawResponse: "",
    sentiment: null,
    shareOfVoice: null,
  };
}

/** 오류 문구 — 공급자 오류와 같은 모양(상태 코드가 문장 앞에 온다). */
export const faultMessage = (fault: FaultKind): string => {
  switch (fault.type) {
    case "http429":
      return fault.retryAfterSec === undefined
        ? "429 Too Many Requests"
        : `429 Too Many Requests (retry-after: ${fault.retryAfterSec}s)`;
    case "http5xx":
      return `${fault.status ?? 503} Service Unavailable`;
    case "network":
      return "fetch failed: ECONNRESET";
    default:
      return "";
  }
};

const faultStatus = (fault: FaultKind): number | undefined => {
  if (fault.type === "http429") {
    return 429;
  }
  if (fault.type === "http5xx") {
    return fault.status ?? 503;
  }
  return undefined;
};

/** throw 방식일 때 던지는 오류. status/headers 는 공급자 SDK 오류와 같은 이름. */
export class InjectedHttpError extends Error {
  readonly headers: Record<string, string>;
  readonly status: number | undefined;
  constructor(fault: FaultKind) {
    super(faultMessage(fault));
    this.name = "InjectedHttpError";
    this.status = faultStatus(fault);
    this.headers =
      fault.type === "http429" && fault.retryAfterSec !== undefined
        ? { "retry-after": String(fault.retryAfterSec) }
        : {};
  }
}

type Adapter = (query: EngineQuery) => Promise<EngineResponse>;

export interface FaultHarness {
  /** EngineAdapter 와 같은 모양. 엔진 id 는 query.engineId 로 구분한다. */
  adapter: Adapter;
  /** 호출 기록 전체(시작 순서). */
  readonly calls: readonly CallRecord[];
  /** 엔진별 호출 기록. */
  callsFor: (engine: EngineId) => CallRecord[];
  /** 칸(엔진+질문)별 호출 횟수. 키는 `${engine}::${prompt}`. */
  callsPerCell: () => Map<string, number>;
  /** 아직 안 끝난 호출 수. */
  readonly inFlight: number;
  /** 기록·호출 번호 초기화(규칙은 유지). */
  reset: () => void;
  /** 규칙을 통째로 바꾼다(기록·호출 번호도 초기화). vi.mock 팩토리가 묶인 뒤에 시나리오별로 갈아끼울 때 쓴다. */
  setPlan: (next: FaultPlan) => void;
}

const matchesRule = (
  rule: FaultRule,
  callNo: number,
  roll: () => number
): boolean => {
  if (rule.calls && !rule.calls.includes(callNo)) {
    return false;
  }
  if (rule.fromCall !== undefined && callNo < rule.fromCall) {
    return false;
  }
  if (rule.toCall !== undefined && callNo > rule.toCall) {
    return false;
  }
  if (rule.probability !== undefined && rule.probability < 1) {
    return roll() < rule.probability;
  }
  return true;
};

export function createFaultHarness(
  initialPlan: FaultPlan,
  options: FaultHarnessOptions = {}
): FaultHarness {
  let plan = initialPlan;
  const errorStyle = options.errorStyle ?? "response";
  const calls: CallRecord[] = [];
  const counters = new Map<EngineId, number>();
  const rngs = new Map<EngineId, () => number>();
  let inFlight = 0;

  // 엔진마다 독립 난수열 — 엔진 간 호출 끼어들기 순서가 바뀌어도 같은 호출 번호는 같은 결과.
  const rollFor = (engine: EngineId) => {
    let rng = rngs.get(engine);
    if (!rng) {
      rng = seededRandom((plan.seed ?? 1) ^ hashString(engine));
      rngs.set(engine, rng);
    }
    return rng;
  };

  const pickFault = (engine: EngineId, callNo: number): FaultKind => {
    const roll = rollFor(engine);
    for (const rule of plan.rules) {
      if (rule.engine === engine && matchesRule(rule, callNo, roll)) {
        return rule.fault;
      }
    }
    return { type: "ok" };
  };

  const wait = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });

  const hang = (signal?: AbortSignal) =>
    new Promise<EngineResponse>((_, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      // 실제 어댑터처럼 abort 가 오면 그 사유로 거절한다. signal 이 없으면 영원히 대기.
      signal?.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });

  const perform = async (
    query: EngineQuery,
    fault: FaultKind,
    record: CallRecord
  ): Promise<EngineResponse> => {
    const engine = query.engineId;
    if (fault.type === "delay") {
      await wait(fault.ms, query.signal);
      return perform(query, fault.afterDelay ?? { type: "ok" }, record);
    }
    record.fault = fault.type;
    if (fault.type === "ok") {
      record.outcome = "ok";
      return okResponse(engine, fault);
    }
    if (fault.type === "empty") {
      record.outcome = "empty";
      return okResponse(engine, { mentioned: false, rawResponse: "" });
    }
    if (fault.type === "hang") {
      record.outcome = "pending";
      return await hang(query.signal);
    }
    record.outcome = fault.type;
    if (errorStyle === "throw") {
      throw new InjectedHttpError(fault);
    }
    return errorResponse(engine, faultMessage(fault));
  };

  const adapter: Adapter = async (query) => {
    const engine = query.engineId;
    const callNo = (counters.get(engine) ?? 0) + 1;
    counters.set(engine, callNo);
    const fault = pickFault(engine, callNo);
    const record: CallRecord = {
      at: Date.now(),
      callNo,
      engine,
      fault: fault.type,
      outcome: "pending",
      prompt: query.prompt,
      signalAborted: () => query.signal?.aborted ?? false,
    };
    calls.push(record);
    inFlight += 1;
    try {
      return await perform(query, fault, record);
    } catch (error) {
      if (query.signal?.aborted) {
        record.outcome = "aborted";
      }
      throw error;
    } finally {
      record.settledAt = Date.now();
      inFlight -= 1;
    }
  };

  return {
    adapter,
    calls,
    callsFor: (engine) => calls.filter((c) => c.engine === engine),
    callsPerCell: () => {
      const cells = new Map<string, number>();
      for (const c of calls) {
        const key = `${c.engine}::${c.prompt}`;
        cells.set(key, (cells.get(key) ?? 0) + 1);
      }
      return cells;
    },
    get inFlight() {
      return inFlight;
    },
    reset: () => {
      calls.length = 0;
      counters.clear();
      rngs.clear();
      inFlight = 0;
    },
    setPlan: (next) => {
      plan = next;
      calls.length = 0;
      counters.clear();
      rngs.clear();
      inFlight = 0;
    },
  };
}

/**
 * `vi.mock("./global-adapters", ...)` 용 — engine-timeout.test.ts 와 같은 방식.
 * 사용(예, packages/ai/lib/engines 안의 테스트):
 *   const harness = createFaultHarness(plan);
 *   vi.mock("./global-adapters", () => globalAdaptersMock(harness));
 *   vi.mock("./korean-adapters", () => koreanAdaptersMock(harness));
 *   const { queryAllEngines } = await import("./index"); // mock 선언 뒤에 동적 import
 * vi.mock 팩토리는 index 를 처음 불러올 때 실행되므로 harness 는 그보다 먼저 만들어져 있어야 한다.
 */
export const globalAdaptersMock = (harness: FaultHarness) => ({
  chatgptAdapter: harness.adapter,
  claudeAdapter: harness.adapter,
  geminiAdapter: harness.adapter,
  perplexityAdapter: harness.adapter,
});

export const koreanAdaptersMock = (harness: FaultHarness) => ({
  NAVER_SEARCH_SAMPLING_VERSION: "interleave-v1",
  daumAdapter: harness.adapter,
  hyperclovaAdapter: harness.adapter,
  naverAdapter: harness.adapter,
});

/**
 * 러너 통합 수준용 — `@repo/ai/lib/engines` 의 queryAllEngines 자리에 꽂는 함수.
 * 엔진별로 harness.adapter 를 병렬 호출하고 응답 배열을 돌려준다(실제와 같이 엔진 순서 유지).
 * 오류 응답은 이미 errorMessage 형태로 오므로(errorStyle "response") 그대로 담는다.
 * 어댑터가 던지면(throw 방식·abort) 실제 queryAllEngines 처럼 errorMessage 행으로 바꾼다.
 */
export const makeQueryAllEngines =
  (harness: FaultHarness) =>
  async (
    base: Omit<EngineQuery, "engineId">,
    engineIds: readonly EngineId[],
    onEngineEvent?: (event: {
      engineId: EngineId;
      phase: "started" | "finished";
      status?: "fulfilled" | "rejected";
    }) => void
  ): Promise<EngineResponse[]> =>
    await Promise.all(
      engineIds.map(async (engineId) => {
        onEngineEvent?.({ engineId, phase: "started" });
        try {
          const response = await harness.adapter({ ...base, engineId });
          onEngineEvent?.({ engineId, phase: "finished", status: "fulfilled" });
          return response;
        } catch (error) {
          onEngineEvent?.({ engineId, phase: "finished", status: "rejected" });
          return errorResponse(
            engineId,
            error instanceof Error ? error.message : String(error)
          );
        }
      })
    );
