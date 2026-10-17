/**
 * U5 2단계 — T4(중단·배포 시뮬)·T5(롤백 호환)의 **정리 cron 라우트** 층.
 * 진짜 sweep-stuck-jobs 라우트 + 진짜 resume-stuck·stale-job 을 메모리 AuditJob(상태가 실제로 바뀐다) 위에서 돌린다.
 * (sweep-resume-stuck.test.ts 는 모의 호출 횟수만 보지만 여기는 「결과 상태」를 본다.)
 * 운영 호출·DB 0. 질문 이어서 묻기(러너) 층은 packages/audit/test-harness/scenarios/T4-T5-*.
 *
 * @vitest-environment node
 */
import { makeAuditCheckpoint } from "@repo/audit/checkpoint";
import { createMemoryJobStore } from "@repo/audit/test-harness/memory-job-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = createMemoryJobStore();

vi.mock("@repo/database", () => store.databaseModule());
vi.mock("@repo/audit/audit-continuation", () => ({
  continueOldestPendingAudit: vi.fn(async () => null),
}));
vi.mock("@repo/audit/sweep-audit-tracking", () => ({
  sweepAuditTrackingReconciliation: vi.fn(async () => ({
    completed: 0,
    skipped: 0,
    failed: 0,
    bounded: false,
  })),
}));
vi.mock("@repo/security/cron", () => ({ denyIfNotCron: () => null }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@repo/observability/ops-alert", () => ({ captureOpsAlert: vi.fn() }));

const { GET } = await import("../app/api/cron/sweep-stuck-jobs/route");

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
    finalUrl: "https://example.com",
    title: null,
    description: null,
    h1: null,
    siteName: null,
  },
};

/** 12문항 checkpoint 에 `saved` 개 질문의 답이 저장된 모양. */
const checkpointWith = (
  saved: number,
  continuationCount?: number,
  createdAt = new Date()
) => {
  const base = makeAuditCheckpoint(
    scope,
    identity,
    Array.from({ length: 12 }, (_, i) => ({
      text: `q${i + 1}`,
      lang: "ko" as const,
      kind: "brand" as const,
    })),
    createdAt.toISOString()
  );
  return {
    ...base,
    ...(continuationCount === undefined
      ? {}
      : {
          continuation: {
            count: continuationCount,
            requestedAt: createdAt.toISOString(),
          },
        }),
    responses: base.enginePlan.slice(0, saved).map((engines) =>
      engines.map((engineId) => ({
        engineId,
        rawResponse: "답",
        brandMentioned: false,
        citedSources: [],
        durationMs: 1,
        isStub: false,
        errorMessage: null,
      }))
    ),
  };
};

const seedStuck = (id: string, saved: number, continuationCount?: number) => {
  const createdAt = new Date(Date.now() - 20 * 60_000);
  store.seed({
    id,
    status: "processing",
    email: "org:org-1",
    createdAt,
    attemptStartedAt: createdAt,
    leaseToken: `tok-${id}`,
    leaseUntil: new Date(Date.now() - 60_000), // lease 만료 = 실행하던 함수가 죽었다
    ...scope,
    checkpoint: checkpointWith(saved, continuationCount, createdAt),
  });
};

const sweep = async () =>
  (await (
    await GET(
      new Request("https://www.test/api/cron/sweep-stuck-jobs") as never
    )
  ).json()) as { swept: Record<string, unknown> };

beforeEach(() => {
  store.reset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("T4 정리 cron — 플래그 켜짐", () => {
  beforeEach(() => {
    vi.stubEnv("STABILITY_RESUME_STUCK_ENABLED", "1");
  });

  it("7개 저장 후 lease 만료: failed 가 아니라 queued + leaseUntil, 이어가기 횟수 1, 받은 답 보존", async () => {
    seedStuck("j1", 7);
    const body = await sweep();
    const row = store.get("j1");
    expect(row.status).toBe("queued");
    expect((row.leaseUntil as Date).getTime()).toBeGreaterThan(Date.now());
    expect(row.leaseToken).toBeNull();
    expect(row.errorMessage ?? null).toBeNull();
    const cp = row.checkpoint as {
      continuation: { count: number };
      responses: unknown[];
    };
    expect(cp.continuation.count).toBe(1);
    expect(cp.responses).toHaveLength(7);
    expect(store.statusTrail("j1")).toEqual(["queued"]);
    expect(body.swept).toMatchObject({ resumed: 1, fast: 0 });
  });

  it("이어가기 대기는 다음 정리에서도 실패로 바뀌지 않는다(30분 규칙 면제) — 대기가 30분을 넘어도", async () => {
    seedStuck("j1", 7);
    await sweep();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 31 * 60_000);
      const again = await sweep();
      expect(again.swept).toMatchObject({ resumed: 0, fast: 0 });
      expect(store.get("j1").status).toBe("queued");
      expect(store.statusTrail("j1")).not.toContain("failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("이어가기 상한을 다 쓴 작업은 기존 동작 그대로 failed(stuck-swept)", async () => {
    // 12문항 checkpoint 의 상한 = 기본 2 (continuationLimitOf). 이미 2회 이어갔다.
    seedStuck("j1", 7, 2);
    const body = await sweep();
    const row = store.get("j1");
    expect(row.status).toBe("failed");
    expect(String(row.errorMessage)).toContain("stuck-swept");
    expect(body.swept).toMatchObject({ resumed: 0, fast: 1 });
  });

  it("응답 0개는 이어갈 것이 없으니 failed(stuck-swept)", async () => {
    seedStuck("j1", 0);
    const body = await sweep();
    expect(store.get("j1").status).toBe("failed");
    expect(String(store.get("j1").errorMessage)).toContain("stuck-swept");
    expect(body.swept).toMatchObject({ resumed: 0, fast: 1 });
  });

  it("섞여 있으면 답이 있는 것만 이어가기, 없는 것은 실패", async () => {
    seedStuck("with-answers", 5);
    seedStuck("no-answers", 0);
    const body = await sweep();
    expect(store.get("with-answers").status).toBe("queued");
    expect(store.get("no-answers").status).toBe("failed");
    expect(body.swept).toMatchObject({ resumed: 1, fast: 1 });
  });

  it("lease 가 아직 유효한(살아 있는) 작업은 건드리지 않는다", async () => {
    seedStuck("alive", 7);
    store.get("alive").leaseUntil = new Date(Date.now() + 60_000);
    store.get("alive").attemptStartedAt = new Date();
    await sweep();
    expect(store.get("alive").status).toBe("processing");
  });
});

describe("T4·T5 정리 cron — 플래그 꺼짐(롤백 상태)", () => {
  it("답이 있어도 기존과 같이 failed + stuck-swept 문구, 응답 키에 resumed 없음", async () => {
    seedStuck("j1", 7);
    const body = await sweep();
    const row = store.get("j1");
    expect(row.status).toBe("failed");
    expect(row.errorMessage).toBe(
      "stuck-swept: 백그라운드 처리가 시간 내 완료되지 않았습니다."
    );
    expect(row.leaseToken).toBeNull();
    expect(row.leaseUntil).toBeNull();
    expect(Object.keys(body.swept).sort()).toEqual([
      "crew",
      "fast",
      "tracking",
    ]);
    expect(body.swept.fast).toBe(1);
  });

  it("켰다 끈 뒤: 켜서 이어가기 대기로 만든 작업은 꺼도 실패로 바뀌지 않고 checkpoint 가 그대로 읽힌다", async () => {
    vi.stubEnv("STABILITY_RESUME_STUCK_ENABLED", "1");
    seedStuck("j1", 7);
    await sweep();
    vi.stubEnv("STABILITY_RESUME_STUCK_ENABLED", "");
    const body = await sweep();
    expect(body.swept.fast).toBe(0);
    expect(store.get("j1").status).toBe("queued");
    expect(store.statusTrail("j1")).not.toContain("failed");
  });
});
