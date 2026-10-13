/**
 * 추적 질문 저장 — 단일 SQL + 한도 검사 원자화 (2026-10-13 운영 장애 → 2026-10-14 한도 경쟁 보강).
 *
 * 🔴 2026-10-13 사고: 질문마다 upsert 를 interactive 트랜잭션에서 순서대로 돌려 Supabase 풀러(연결 1개)에서
 *   Prisma 기본 제한 5초를 넘겼다("expired transaction … 5000 ms, 5732 ms passed") → 저장 0건.
 *   → 저장은 **한 번의 createMany**. 트랜잭션은 3문장(락·count·createMany)뿐이고 제한을 명시한다.
 * 🔴 2026-10-14: count 후 createMany 가 분리돼 있어, 같은 순간 두 요청이 둘 다 남은 칸이 있다고 보고
 *   상한을 넘겨 저장할 수 있었다 → 브랜드별 어드바이저리 락으로 한 트랜잭션에 묶는다.
 *
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  plan: vi.fn(),
  txOptions: undefined as undefined | { maxWait?: number; timeout?: number },
  statements: [] as string[],
  rows: [] as Array<{ text: string }>,
  createManyCalls: 0,
  lockCalls: [] as string[],
  failCreate: false,
  chain: Promise.resolve() as Promise<unknown>,
}));

// 질문 보관 조회(raw SQL)는 이 테스트의 관심사가 아니다 — 보관된 질문 없음으로 둔다.
vi.mock("@repo/audit/prompt-archive", () => ({
  activePromptFilter: () => ({}),
  archivedPromptIds: () => Promise.resolve([]),
}));
vi.mock("@repo/database", () => ({
  database: {
    $transaction: async (
      fn: (tx: unknown) => Promise<unknown>,
      options?: { maxWait?: number; timeout?: number }
    ) => {
      h.txOptions = options;
      let release: () => void = () => undefined;
      const tx = {
        // 어드바이저리 락 = 같은 키의 다른 트랜잭션은 이 트랜잭션이 끝날 때까지 기다린다.
        $executeRaw: async (strings: TemplateStringsArray, key: string) => {
          h.statements.push("lock");
          h.lockCalls.push(`${strings.join("?")}|${key}`);
          const previous = h.chain;
          h.chain = new Promise<void>((resolve) => {
            release = resolve;
          });
          await previous;
          return 1;
        },
        prompt: {
          count: async () => {
            h.statements.push("count");
            await Promise.resolve(); // 다른 요청과 끼어들 틈
            return h.rows.length;
          },
          createMany: async ({ data }: { data: Array<{ text: string }> }) => {
            h.statements.push("createMany");
            h.createManyCalls += 1;
            if (h.failCreate) {
              throw new Error("db down");
            }
            await Promise.resolve();
            h.rows.push(...data);
            return { count: data.length };
          },
        },
      };
      try {
        return await fn(tx);
      } finally {
        release();
      }
    },
    prompt: { count: vi.fn(), createMany: vi.fn() },
  },
}));
vi.mock("@repo/auth/plan-server", () => ({ getCurrentPlan: h.plan }));
vi.mock("@/lib/db/scoped", () => ({
  requireOrg: () => Promise.resolve("org_1"),
  scopedBrandById: () => Promise.resolve({ id: "brand_1" }),
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@repo/observability/error", () => ({ parseError: String }));
vi.mock("@repo/ai/lib/brand-identity", () => ({
  lookupStaticBrandName: vi.fn(),
  resolveBrandIdentity: vi.fn(),
}));
vi.mock("@repo/ai/lib/prompt-suggestions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  suggestTrackingPrompts: vi.fn(),
}));

import { saveApprovedPromptsAction } from "../app/actions/brand/suggest-prompts";

const make = (n: number, tag = "a") =>
  Array.from({ length: n }, (_, i) => ({
    category: "competitor" as const,
    language: "ko" as const,
    text: `수분 크림 질문 ${tag}${i} 추천해줘`,
    topic: "best_in_category" as const,
  }));

beforeEach(() => {
  h.plan.mockReset();
  h.plan.mockResolvedValue("growth");
  h.txOptions = undefined;
  h.statements = [];
  h.rows = [];
  h.createManyCalls = 0;
  h.lockCalls = [];
  h.failCreate = false;
  h.chain = Promise.resolve();
});

describe("saveApprovedPromptsAction — 단일 문장 저장", () => {
  it("20개를 createMany 한 번으로 저장하고, 트랜잭션은 락·count·createMany 3문장뿐이다", async () => {
    const result = await saveApprovedPromptsAction({
      brandId: "brand_1",
      prompts: make(20),
    });
    expect(result).toMatchObject({ ok: true, saved: 20 });
    expect(h.createManyCalls).toBe(1);
    expect(h.statements).toEqual(["lock", "count", "createMany"]);
    expect(h.rows).toHaveLength(20);
  });

  it("트랜잭션 제한을 Prisma 기본 5초보다 넉넉히 명시한다", async () => {
    await saveApprovedPromptsAction({ brandId: "brand_1", prompts: make(3) });
    expect(h.txOptions?.timeout).toBeGreaterThanOrEqual(10_000);
    expect(h.txOptions?.maxWait).toBeGreaterThanOrEqual(5000);
  });

  it("락은 브랜드별 어드바이저리 락이다", async () => {
    await saveApprovedPromptsAction({ brandId: "brand_1", prompts: make(1) });
    expect(h.lockCalls[0]).toContain("pg_advisory_xact_lock");
    expect(h.lockCalls[0]).toContain("prompt-limit:brand_1");
  });
});

describe("플랜 상한", () => {
  it("상한을 넘으면 상한까지만 저장하고 capped·requested·limit 로 알린다", async () => {
    h.plan.mockResolvedValue("free"); // 상한 5
    const result = await saveApprovedPromptsAction({
      brandId: "brand_1",
      prompts: make(20),
    });
    expect(result).toMatchObject({
      ok: true,
      saved: 5,
      capped: true,
      requested: 20,
      limit: 5,
    });
    expect(h.rows).toHaveLength(5);
  });

  it("남은 칸이 0이면 저장하지 않고 prompt_limit + limit 으로 알린다", async () => {
    h.plan.mockResolvedValue("free");
    h.rows = make(5, "old");
    const result = await saveApprovedPromptsAction({
      brandId: "brand_1",
      prompts: make(3, "new"),
    });
    expect(result).toMatchObject({ code: "prompt_limit", limit: 5 });
    expect(h.createManyCalls).toBe(0);
    expect(h.rows).toHaveLength(5);
  });

  it("🔴 같은 순간 두 요청이 와도 상한을 넘기지 않는다(락이 직렬화)", async () => {
    h.plan.mockResolvedValue("free"); // 상한 5
    const [a, b] = await Promise.all([
      saveApprovedPromptsAction({ brandId: "brand_1", prompts: make(4, "x") }),
      saveApprovedPromptsAction({ brandId: "brand_1", prompts: make(4, "y") }),
    ]);
    expect(h.rows.length).toBeLessThanOrEqual(5);
    expect(h.rows).toHaveLength(5);
    const saved = [a, b].map((r) => ("ok" in r ? r.saved : 0));
    expect(saved.reduce((x, y) => x + y, 0)).toBe(5);
  });

  it("저장이 실패하면 성공처럼 말하지 않고 오류를 돌려준다", async () => {
    h.failCreate = true;
    const result = await saveApprovedPromptsAction({
      brandId: "brand_1",
      prompts: make(3),
    });
    expect("error" in result && result.error).toContain("저장 중 문제");
  });
});

describe("소스 계약 — 질문 저장 경로", () => {
  const source = readFileSync(
    join(process.cwd(), "app/actions/brand/suggest-prompts.ts"),
    "utf8"
  );

  it("질문별 upsert 로 되돌아가지 않는다 · 락과 제한을 명시한다", () => {
    expect(source).not.toContain(".upsert(");
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("maxWait");
    expect(source).toContain("timeout");
    expect(source).toContain("createMany");
  });
});
