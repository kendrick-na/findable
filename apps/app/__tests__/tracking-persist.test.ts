/*
 * 🔴 **Tracking 적재를 원가 0원으로 검증한다** — 2026-08-16.
 *
 * ## 왜 이 테스트가 필요한가
 * 지금까지 "Tracking 이 실제로 쌓이는가" 를 확인할 방법이 **실측정뿐**이었다(건당 약 87원).
 * 그래서 아무도 자주 확인하지 않았고, org 측정 **34회 중 24회분이 사라진 것을 3주간 몰랐다**.
 *
 * ⚠️ 엔진 stub 모드로도 안 된다 — `persistAuditTracking` 이 `isStub` 행을 **의도적으로
 *   걸러내기** 때문에(D5: 인프라 실패를 "진짜 0언급" 으로 오해하지 않으려는 규칙)
 *   stub 실행은 **Tracking 을 0행 쓴다**. 즉 공짜 경로가 원천 봉쇄돼 있었다.
 *
 * ✅ 해법: `persistAuditTracking` 은 이미 `{organizationId, brandId, tagged, completedAt}` 만
 *   받는 **주입 가능한 함수**다. DB 를 가짜로 물리고 `tagged` 를 손으로 만들면
 *   **LLM 호출 0 · 원가 0 · 결정적**으로 적재 규칙 전체를 검증할 수 있다.
 *
 * ## 검사하는 계약 (문구 아님)
 *   ① 성공 행만 적재한다(stub·error·빈 응답·미실재 엔진 제외)
 *   ② 쓸 행이 하나도 없으면 **아무것도 쓰지 않는다**(빈 트랜잭션 금지)
 *   ③ 부모 org 가 없으면 **전부 skip**(고아 row 방지 — relationMode="prisma" 라 FK 가 안 막는다)
 *   ④ 같은 프롬프트 텍스트는 **upsert 로 하나의 promptId**(시계열 선 분열 방지)
 *   ⑤ 실패해도 **throw 하지 않는다**(측정 결과를 깨지 않는다)
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

/* ── DB 가짜 물리기 (실제 Neon 접속 0) ───────────────────────── */

const state = {
  orgExists: true,
  engineIds: ["chatgpt", "claude", "perplexity"],
  promptUpserts: [] as Array<{ brandId: string; text: string }>,
  trackingRows: [] as Record<string, unknown>[],
  transactionRan: false,
  throwOnCreateMany: false,
};

const tx = {
  prompt: {
    // Prisma 의 실제 시그니처가 Promise 라 `async` 가 **계약**이다.
    //   벗기면 호출부의 `await` 가 값이 아닌 함수를 받는다.
    upsert: vi.fn(
      // biome-ignore lint/suspicious/useAwait: 위 주석 참고
      async ({
        where,
      }: {
        where: { brandId_text: { brandId: string; text: string } };
      }) => {
        const { brandId, text } = where.brandId_text;
        state.promptUpserts.push({ brandId, text });
        // 같은 text → 같은 id (실제 upsert 의미론).
        return { id: `prompt_${text}` };
      }
    ),
  },
  tracking: {
    // 위와 같은 이유 — Prisma 시그니처가 Promise.
    // biome-ignore lint/suspicious/useAwait: 위 주석 참고
    createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
      if (state.throwOnCreateMany) {
        throw new Error("DB 폭발");
      }
      state.trackingRows.push(...data);
      return { count: data.length };
    }),
  },
};

vi.mock("@repo/database", () => ({
  database: {
    organization: {
      findUnique: vi.fn(async () => (state.orgExists ? { id: "org_1" } : null)),
    },
    engine: {
      findMany: vi.fn(async () => state.engineIds.map((id) => ({ id }))),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => {
      state.transactionRan = true;
      return await fn(tx);
    }),
  },
}));

vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { persistAuditTracking } = await import("@repo/audit/tracking");

/* ── 픽스처 ─────────────────────────────────────────────────── */

type Tagged = Parameters<typeof persistAuditTracking>[0]["tagged"][number];

const row = (over: Partial<Tagged> = {}): Tagged =>
  ({
    engineId: "chatgpt",
    promptText: "브랜드 추천해줘",
    promptLang: "ko",
    rawResponse: "답변 원문",
    brandMentioned: true,
    mentionPosition: 1,
    mentionListSize: 5,
    sentiment: "positive",
    citedSources: [],
    shareOfVoice: 0.4,
    isStub: false,
    errorMessage: null,
    ...over,
  }) as Tagged;

const run = (tagged: Tagged[]) =>
  persistAuditTracking({
    organizationId: "org_1",
    brandId: "brand_1",
    tagged,
    completedAt: new Date("2026-08-16T00:00:00Z"),
  });

beforeEach(() => {
  state.orgExists = true;
  state.engineIds = ["chatgpt", "claude", "perplexity"];
  state.promptUpserts = [];
  state.trackingRows = [];
  state.transactionRan = false;
  state.throwOnCreateMany = false;
  vi.clearAllMocks();
});

/* ── 계약 검사 ──────────────────────────────────────────────── */

describe("persistAuditTracking — 적재 규칙 (원가 0원)", () => {
  test("성공 행만 적재한다 — stub·error·빈응답·미실재엔진은 제외", async () => {
    await run([
      row({ engineId: "chatgpt" }), // ✅
      row({ engineId: "claude" }), // ✅
      row({ engineId: "gemini" }), // ❌ Engine 테이블에 없음
      row({ isStub: true, engineId: "perplexity" }), // ❌ stub
      row({ errorMessage: "429", engineId: "perplexity" }), // ❌ 실패
      row({ promptText: "   ", engineId: "perplexity" }), // ❌ 빈 프롬프트
    ]);

    expect(state.trackingRows).toHaveLength(2);
    expect(state.trackingRows.map((r) => r.engineId)).toEqual([
      "chatgpt",
      "claude",
    ]);
  });

  test("🔴 쓸 행이 없으면 트랜잭션 자체를 열지 않는다", async () => {
    await run([row({ isStub: true }), row({ errorMessage: "fail" })]);

    expect(state.transactionRan).toBe(false);
    expect(state.trackingRows).toHaveLength(0);
  });

  test("🔴 부모 org 가 없으면 전부 skip — 고아 row 를 만들지 않는다", async () => {
    state.orgExists = false;

    await run([row(), row({ engineId: "claude" })]);

    expect(state.transactionRan).toBe(false);
    expect(state.trackingRows).toHaveLength(0);
  });

  test("같은 프롬프트 텍스트는 upsert 1회 — promptId 가 갈리지 않는다", async () => {
    await run([
      row({ engineId: "chatgpt", promptText: "같은 질문" }),
      row({ engineId: "claude", promptText: "같은 질문" }),
      row({ engineId: "perplexity", promptText: "다른 질문" }),
    ]);

    // 텍스트 2종 → upsert 2회(엔진 3개인데도).
    expect(state.promptUpserts).toHaveLength(2);
    expect(state.trackingRows).toHaveLength(3);
    // 같은 텍스트의 두 행이 같은 promptId 를 공유한다.
    const ids = state.trackingRows.map((r) => r.promptId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  test("적재 실패해도 throw 하지 않는다 — 측정 결과를 깨지 않는다", async () => {
    state.throwOnCreateMany = true;

    await expect(run([row()])).resolves.toBeUndefined();
  });

  test("엔진 응답 값이 손실 없이 옮겨진다", async () => {
    await run([
      row({
        brandMentioned: true,
        mentionPosition: 3,
        mentionListSize: 10,
        sentiment: "negative",
        shareOfVoice: 0.25,
      }),
    ]);

    const [saved] = state.trackingRows;
    expect(saved).toMatchObject({
      brandId: "brand_1",
      engineId: "chatgpt",
      brandMentioned: true,
      mentionPosition: 3,
      mentionListSize: 10,
      sentiment: "negative",
      shareOfVoice: 0.25,
      errorMessage: null,
    });
  });
});
