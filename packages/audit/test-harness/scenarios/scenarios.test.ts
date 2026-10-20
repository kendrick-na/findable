import { describe, expect, it, vi } from "vitest";
import {
  enginesForRunPrompt,
  makeAuditCheckpoint,
  readAuditCheckpoint,
} from "../../checkpoint";
import {
  AUDIT_JOB_QUEUE_STALE_AFTER_MS,
  AUDIT_JOB_STALE_AFTER_MS,
  isStaleAuditJob,
} from "../../stale-job";
import {
  MAX_CALLS_PER_CELL,
  SCENARIO_SEED,
  T1,
  T2_PLAN,
  T2_QUESTIONS,
  T3_PLAN,
  T3_QUESTIONS,
  T4,
  T5,
} from "./plans";

// stale-job.ts 가 @repo/database 를 import 한다 — 순수 함수만 쓰므로 빈 대역으로 막는다.
vi.mock("@repo/database", () => ({ database: {} }));

// 모의 시험 T1~T5 — 골격.
//
// 규칙: 합쳐진 단위(U1~U4)가 아직 없으므로 **통과하는 척하지 않는다**.
//   - 「지금 검증 가능한 부분」 = 현재 코드 동작을 기록하는 특성화 테스트(실제로 통과).
//   - 「합친 뒤 채울 부분」   = it.todo (실행 안 됨·통과로 안 센다). 준비·실행·단언은 *.scenario.md 에 문장으로.
// 장애 주입 틀: packages/ai/lib/engines/test-harness/fault-engine.ts (+ ../ 의 fake-clock·memory-job-store·concurrency-probe).
// 실행: cd packages/audit && npx vitest run test-harness/scenarios

describe("시나리오 준비값 점검(계획표가 코드와 어긋나지 않았는가)", () => {
  it("T2·T3 계획은 시드가 고정돼 있고 칸당 호출 상한은 3이다", () => {
    // T2 는 시드 3(SCENARIO_SEED 로는 gemini 429 가 24번 안에 한 번도 안 나와 시험이 비었다).
    expect(T2_PLAN.seed).toBe(3);
    expect(T3_PLAN.seed).toBe(SCENARIO_SEED);
    // 최초 1 + 칸당 재시도 상한(stabilityLimits 기본 1).
    expect(MAX_CALLS_PER_CELL).toBe(2);
    expect(T2_QUESTIONS).toBe(20);
    expect(T3_QUESTIONS).toBe(20);
  });

  it("T1 의 30분 규칙 값이 stale-job.ts 의 실제 상수와 같다", () => {
    expect(T1.staleAfterMs).toBe(AUDIT_JOB_QUEUE_STALE_AFTER_MS);
  });
});

describe("T1 동시 폭주 (필요한 합쳐진 단위: U2 입장 관리)", () => {
  const now = Date.parse("2026-10-18T09:00:00+09:00");
  const job = (extra: Record<string, unknown>) => ({
    createdAt: new Date(now),
    status: "queued",
    ...extra,
  });

  it("[현재 동작] 대기(queued, lease 없음) job 은 30분 넘으면 실패 처리 대상이다", () => {
    expect(isStaleAuditJob(job({}), now + 29 * 60_000)).toBe(false);
    expect(isStaleAuditJob(job({}), now + 31 * 60_000)).toBe(true);
  });

  it("[현재 동작] 이어가기 대기(queued + leaseUntil)는 30분이 지나도 실패 처리하지 않는다", () => {
    expect(
      isStaleAuditJob(
        job({ leaseUntil: new Date(now + 60_000) }),
        now + 60 * 60_000
      )
    ).toBe(false);
  });

  // 채움: apps/app/__tests__/stability-t1-concurrency.scenario.test.ts (입장 관리·대기 줄 일꾼은 apps/app 에 있다).
});

describe("T2 엔진 1개 100% 5xx + 다른 엔진 20% 429 (필요: U1 재시도·서킷브레이커)", () => {
  it("[참조] 현재 동작: 재시도·제외 없이 칸마다 1회 호출하고 오류 행으로 끝난다 — 자세한 기록은 ai/test-harness/engine-faults.characterization.test.ts · runner-faults.characterization.test.ts", () => {
    // 이 항목은 위 두 파일이 실제 단언을 가진다. 여기서는 위치만 가리킨다.
    expect(T2_PLAN.rules.map((r) => r.engine)).toEqual(["claude", "gemini"]);
  });

  // 채움: T2-T3-runner.scenario.test.ts(러너 층) · packages/ai/lib/engines/test-harness/t2-t3-engine-guard.scenario.test.ts(엔진 층).
});

describe("T3 빈 응답 20% (필요: U1 빈 응답 재시도·분모 제외)", () => {
  it("[참조] 현재 동작: 빈 응답은 오류가 아닌 정상 응답으로 분모에 들어가 미노출로 센다 — ai/test-harness/engine-faults.characterization.test.ts 의 마지막 항목이 기록", () => {
    expect(T3_PLAN.rules.every((r) => r.fault.type === "empty")).toBe(true);
  });

  // 채움: T2-T3-runner.scenario.test.ts · packages/ai/lib/engines/test-harness/t2-t3-engine-guard.scenario.test.ts.
});

describe("T4 중단 시뮬 (필요: U3 중단 복구, 정리 cron)", () => {
  const now = Date.parse("2026-10-18T09:00:00+09:00");

  it("[현재 동작] 실행 중(processing) job 의 lease 가 만료되면 stale(실패 정리 대상)이다 — U3 는 이걸 「이어가기 대기」로 바꿔야 한다", () => {
    expect(
      isStaleAuditJob(
        {
          createdAt: new Date(now - 10 * 60_000),
          status: "processing",
          leaseUntil: new Date(now - 1000),
        },
        now
      )
    ).toBe(true);
    expect(AUDIT_JOB_STALE_AFTER_MS).toBe(6 * 60_000);
  });

  it("[참조] 현재 동작: 7개 저장 후 중단 → 이어가기는 남은 질문만 부르고 같은 칸 호출 1회 — ai 쪽이 아니라 runner-faults.characterization.test.ts 가 단언", () => {
    expect(T4.interruptAfterSavedQuestions).toBeLessThan(T4.questions);
  });

  // 채움: T4-T5-interruption-rollback.scenario.test.ts · apps/web/__tests__/stability-t4-sweep-route.test.ts(cron 라우트).
});

describe("T5 롤백 호환 (필요: U1~U4 중 checkpoint/결과에 필드를 더하는 단위 + 플래그)", () => {
  const scope = { domain: "example.com", language: "both" as const };
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
  const prompts = [{ text: "q1", lang: "ko" as const, kind: "brand" as const }];

  it("[현재 동작] 읽기 코드는 모르는 최상위·행 필드를 무시한다 → 새 코드가 필드를 「더하기만」 하면 옛 코드가 읽는다", () => {
    const base = makeAuditCheckpoint(scope, identity, prompts);
    const row = enginesForRunPrompt(prompts[0]).map((engineId) => ({
      engineId,
      rawResponse: "answer",
      brandMentioned: false,
      citedSources: [],
      durationMs: 1,
      isStub: false,
      errorMessage: null,
      ...Object.fromEntries(T5.addedRowFields.map((k) => [k, { attempts: 2 }])),
    }));
    const extended = {
      ...base,
      responses: [row],
      ...Object.fromEntries(
        T5.addedTopLevelFields.map((k) => [k, { schema: "new" }])
      ),
    };
    const parsed = readAuditCheckpoint(extended, scope);
    expect(parsed?.responses).toHaveLength(1);
  });

  it("[현재 동작] 버전·엔진 구성 버전을 바꾸면 옛 코드는 거부한다 → 새 코드는 이 값을 건드리면 안 된다", () => {
    const base = makeAuditCheckpoint(scope, identity, prompts);
    expect(() =>
      readAuditCheckpoint({ ...base, engineConfigVersion: 2 }, scope)
    ).toThrow("invalid audit checkpoint");
    expect(() => readAuditCheckpoint({ ...base, version: 3 }, scope)).toThrow(
      "invalid audit checkpoint"
    );
  });

  // 채움: T4-T5-interruption-rollback.scenario.test.ts 의 「T5 롤백 호환」 · apps/web/__tests__/stability-t4-sweep-route.test.ts(정리 경로 꺼짐 동일).
});
