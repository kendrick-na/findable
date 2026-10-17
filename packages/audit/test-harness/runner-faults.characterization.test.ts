import type { EngineId } from "@repo/ai/lib/engines";
import {
  createFaultHarness,
  type FaultPlan,
  makeQueryAllEngines,
} from "@repo/ai/lib/engines/test-harness/fault-engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryJobStore } from "./memory-job-store";

// 러너 통합 수준 특성화 시험 — 실제 runAuditJob 을 메모리 AuditJob 행 + 장애 주입 엔진 위에서 돌린다.
// 운영·유료 호출 0: DB 는 메모리, 엔진은 fault harness, 신원·판정·PDF·추적은 로컬 대역.
//
// ⚠️ 이 파일은 「지금 코드의 동작」을 기록한다. U1~U4 가 합쳐지면 일부 단언이 의도적으로 깨진다
//   (각 단언 옆 「합친 뒤」 주석 참고). 그때 scenarios/ 의 it.todo 를 채우고 여기 단언을 갱신한다.
//
// 엔진 주입 방식: 라이브 모드(스텁 모드 끔)에서 러너는 `@repo/ai/lib/engines` 의 queryAllEngines 를
//   직접 부른다 → 그 모듈을 vi.mock 해 fault harness 로 바꾼다(audit-stub-runner.test.ts 와 같은 방식).
//   audit-stub.ts 는 수정하지 않았다.

const store = createMemoryJobStore();
const harness = createFaultHarness({ rules: [] });
const queryAll = makeQueryAllEngines(harness);

vi.mock("@repo/database", () => store.databaseModule());
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@repo/ai/lib/engines", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  queryAllEngines: (...args: Parameters<typeof queryAll>) => queryAll(...args),
}));
vi.mock("@repo/ai/lib/mention-verdict", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // 판정 LLM 대역: 노출이면 confirmed, 아니면 absent. 오류 행은 러너가 알아서 다룬다.
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
vi.mock("../official-site-identity", async (importOriginal) => ({
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
vi.mock("../pdf-generator", () => ({
  generateAuditPdf: () => Promise.reject(new Error("PAID CALL: pdf")),
}));
vi.mock("../tracking", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  persistAuditTracking: () => Promise.reject(new Error("PAID CALL: tracking")),
}));

const { runAuditJob } = await import("../runner");
const { makeAuditCheckpoint } = await import("../checkpoint");
const { runCheckpointedQuestions } = await import(
  "../run-checkpointed-questions"
);

const createdAt = new Date();
const input = {
  jobId: "job-1",
  domain: "example.com",
  brandName: "Example",
  language: "both" as const,
};
const plan = (rules: FaultPlan["rules"]): FaultPlan => ({ rules, seed: 42 });

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

beforeEach(() => {
  store.reset();
  harness.setPlan({ rules: [] });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("NETWORK CALL")))
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("러너 위 장애 주입: 지금 동작 기록", () => {
  it("장애 없음 — 계획한 칸 수만큼만 엔진을 부르고 완료한다(기준선)", async () => {
    const checkpoint = checkpointFor(3);
    store.seed({ id: "job-1", createdAt, domain: "example.com", checkpoint });

    await runAuditJob(input);

    const planned = checkpoint.enginePlan.flat().length;
    expect(harness.calls).toHaveLength(planned);
    expect(Math.max(...harness.callsPerCell().values())).toBe(1);
    expect(store.get("job-1").status).toBe("completed");
  });

  it("엔진 하나가 계속 429 — 재시도 없이 칸마다 1회씩만 부르고(합 = 질문 수), 작업은 완료된다", async () => {
    harness.setPlan(
      plan([{ engine: "gemini", fault: { type: "http429", retryAfterSec: 5 } }])
    );
    const checkpoint = checkpointFor(3);
    store.seed({ id: "job-1", createdAt, domain: "example.com", checkpoint });

    await runAuditJob(input);

    const geminiCalls = harness.callsFor("gemini");
    // 합친 뒤(U1): 칸당 ≤ 3 이지만 재시도가 생기므로 이 값은 늘 수 있다 → 상한 ≤ 질문 수 × 3 으로 교체.
    expect(geminiCalls).toHaveLength(
      checkpoint.enginePlan.filter((engines) => engines.includes("gemini"))
        .length
    );
    expect(Math.max(...harness.callsPerCell().values())).toBe(1);
    expect(store.get("job-1").status).toBe("completed");
    const result = store.get("job-1").result as {
      measurementContext?: { engineErrors?: unknown };
    };
    // 오류 칸의 요약이 결과에 남는다(진단 ⑦, 4d9f2d70).
    expect(result.measurementContext?.engineErrors).toBeDefined();
  });

  it("빈 응답 — 재시도·사유 기록 없이 호출 1회로 끝난다", async () => {
    harness.setPlan(plan([{ engine: "perplexity", fault: { type: "empty" } }]));
    const checkpoint = checkpointFor(2);
    store.seed({ id: "job-1", createdAt, domain: "example.com", checkpoint });

    await runAuditJob(input);

    // 합친 뒤(U1/T3): 빈 응답은 재시도되어 칸당 호출 > 1 이 될 수 있다.
    expect(Math.max(...harness.callsPerCell().values())).toBe(1);
    expect(store.get("job-1").status).toBe("completed");
    const result = store.get("job-1").result as {
      measurementContext?: { engineErrors?: unknown };
    };
    // 빈 응답은 errorMessage 가 없어 오류 요약에 안 잡힌다 = 분모 제외 사유 기록 없음.
    expect(result.measurementContext?.engineErrors).toBeUndefined();
  });
});

describe("T4 일부: 체크포인트 이어가기 — 지금 코드로 검증 가능한 부분", () => {
  it("12개 질문 중 7번째 저장 직후 중단 → 이어가면 남은 5개 질문만 부르고 같은 칸을 두 번 부르지 않는다", async () => {
    const checkpoint = checkpointFor(12);
    const callOne = async (cp: typeof checkpoint, index: number) =>
      await queryAll(
        { prompt: cp.prompts[index].text, language: "ko" },
        cp.enginePlan[index] as EngineId[]
      );

    let durable = checkpoint;
    // 1차 호출: 7번째 질문이 저장된 직후 lease 를 잃어 중단된 상황을 save 에서 던져 흉내 낸다.
    await expect(
      runCheckpointedQuestions(
        checkpoint,
        (index) => callOne(checkpoint, index),
        (saved) => {
          durable = saved;
          return saved.responses.length === 7
            ? Promise.reject(new Error("lease lost after question 7"))
            : Promise.resolve();
        }
      )
    ).rejects.toThrow("lease lost");
    expect(durable.responses).toHaveLength(7);
    const callsBefore = harness.calls.length;

    // 2차(이어가기): 저장된 7개는 건너뛰고 8~12번째만 부른다.
    const resumed = { ...checkpoint, responses: durable.responses };
    const askedIndexes: number[] = [];
    await runCheckpointedQuestions(
      resumed,
      (index) => {
        askedIndexes.push(index);
        return callOne(resumed, index);
      },
      () => Promise.resolve()
    );
    expect(askedIndexes).toEqual([7, 8, 9, 10, 11]);
    const secondRunCalls = harness.calls.slice(callsBefore);
    expect(secondRunCalls.every((c) => !c.prompt.match(/^q[1-7]$/))).toBe(true);
    // 같은 칸(엔진+질문) 유료 호출 1회.
    expect(Math.max(...harness.callsPerCell().values())).toBe(1);
  });
});

describe("T5 일부: 기준선(5068d9f4) 결과 재현성", () => {
  // 시각·소요시간만 지워 비교한다. 새 코드(플래그 꺼짐)의 결과를 같은 방법으로 이 기준선과 비교한다.
  const stable = (value: unknown): string =>
    JSON.stringify(value, (key, v) =>
      key === "durationMs" || /(At|Ms)$/.test(key) ? undefined : v
    );

  it("같은 입력·같은 장애 계획이면 결과 JSON 이 두 번 모두 같다", async () => {
    const results: string[] = [];
    for (const jobId of ["job-1", "job-2"]) {
      store.reset();
      harness.setPlan(plan([{ engine: "gemini", fault: { type: "http429" } }]));
      store.seed({
        id: jobId,
        createdAt,
        domain: "example.com",
        checkpoint: checkpointFor(3),
      });
      await runAuditJob({ ...input, jobId });
      results.push(stable(store.get(jobId).result));
    }
    expect(results[0]).toBeTruthy();
    expect(results[0]).toBe(results[1]);
  });
});
