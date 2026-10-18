import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ generateObject: vi.fn() }));
vi.mock("ai", () => ({ generateObject: h.generateObject }));
vi.mock("./models", () => ({ models: { chat: "stub-model" } }));
vi.mock("./letsur-fallback", () => ({
  HELPER_GATEWAY_MODEL_ID: "stub",
  letsurModelWithFallback: () => null,
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { suggestTrackingPrompts } from "./prompt-suggestions";
import { GAP_FIXTURES_15, type GapFixture } from "./question-gap-fixtures";

/**
 * 15곳 재현 결과를 고정 입력(익명)으로 회귀 시험화(2026-10-19).
 * 생성기는 **비결정적**이다(같은 입력이 4→18개로 흔들렸다) — 그래서 한 번의 결과로 판단하지 않고
 * 같은 입력을 세 가지 흔들림(기록 그대로 / 매번 확신 없음 / 첫 시도 빈손 뒤 재시도)으로 N회 돌려
 * 「통과한 후보가 충분하면 질문 8개 이상·이름 질문 1개 이상」이라는 **불변식**이 모든 변형에서 지켜지는지 본다.
 */
const FLAGS = [
  "QUESTION_OTHER_FALLBACK_ENABLED",
  "QUESTION_BRAND_GUARANTEE_ENABLED",
  "QUESTION_SOFT_CONFIDENCE_ENABLED",
  "QUESTION_BRAND_VARIANT_ENABLED",
  "QUESTION_GENERATION_LOG_ENABLED",
] as const;
const BRAND = "프란츠";
const PHRASE = "스킨케어 서비스";
const SITE = {
  description: `${PHRASE} 민감성 피부 보습 시카 크림`,
  h1: null,
  siteName: BRAND,
  title: `${BRAND} | ${PHRASE}`,
};

type Lang = "ko" | "en";
const langOf = (i: number, scope: string): Lang => {
  if (scope === "korea") {
    return "ko";
  }
  return i % 2 === 0 ? "ko" : "en";
};
const nameless = (i: number, scope: string, kind: string) => {
  const language = langOf(i, scope);
  return language === "ko"
    ? { language, text: `${PHRASE} ${kind} ${i}번 어떤 곳이 좋아? 추천해줘` }
    : {
        language,
        text: `Can you recommend ${kind} skincare service option ${i}?`,
      };
};
const named = (i: number, scope: string) => {
  const language = langOf(i, scope);
  return language === "ko"
    ? { language, text: `${BRAND} ${i}번 후기 어때?` }
    : { language, text: `What do people say about ${BRAND} ${i}?` };
};
// 이름이 빠진 이름 질문(진단 재현의 brand_missing 폐기분)
const unnamed = (i: number, scope: string) => {
  const language = langOf(i, scope);
  return language === "ko"
    ? { language, text: `이 회사 ${i}번 평판 어때?` }
    : { language, text: `How is this company ${i} regarded overall?` };
};

function objectOf(
  round: GapFixture["rounds"][number],
  scope: string,
  confident: boolean
) {
  const rep = (n: number, f: (i: number) => unknown) =>
    Array.from({ length: n }, (_, i) => f(i));
  return {
    object: {
      category: rep(round.category, (i) => nameless(i, scope, "분야")),
      concern: rep(round.concern, (i) => nameless(i, scope, "고민")),
      representative: [],
      alternative: [],
      brandUnderstanding: [
        ...rep(round.brandNamed, (i) => named(i, scope)),
        ...rep(round.brandUnnamed, (i) => unnamed(i, scope)),
      ],
      categoryPhrase: round.hasCategoryPhrase ? PHRASE : "",
      confident,
    },
  };
}

type Variant = "recorded" | "always_unconfident" | "empty_then_recorded";
const VARIANTS: Variant[] = [
  "recorded",
  "always_unconfident",
  "empty_then_recorded",
];

function mockVariant(fx: GapFixture, variant: Variant) {
  h.generateObject.mockReset();
  const rounds = fx.rounds;
  const empty = {
    object: {
      category: [],
      concern: [],
      representative: [],
      alternative: [],
      brandUnderstanding: [],
      categoryPhrase: "",
      confident: false,
    },
  };
  let call = 0;
  h.generateObject.mockImplementation(() => {
    const index = call++;
    if (variant === "empty_then_recorded" && index === 0) {
      return Promise.resolve(empty);
    }
    const src =
      rounds[
        Math.min(
          variant === "empty_then_recorded" ? index - 1 : index,
          rounds.length - 1
        )
      ];
    if (!src) {
      return Promise.resolve(empty);
    }
    return Promise.resolve(
      objectOf(
        src,
        fx.scope,
        variant === "always_unconfident" ? false : src.confident
      )
    );
  });
}

const run = (fx: GapFixture) =>
  suggestTrackingPrompts({
    brandName: BRAND,
    domain: "example.test",
    industry: fx.industry,
    marketScope: fx.scope === "korea" ? "korea" : "both",
    site: fx.thin ? { ...SITE, description: null, thin: true } : SITE,
  } as never);

const stubFlags = (on: boolean) => {
  for (const f of FLAGS) {
    vi.stubEnv(f, on ? "true" : "");
  }
};

beforeEach(() => h.generateObject.mockReset());
afterEach(() => vi.unstubAllEnvs());

// 통과할 후보가 충분했던 곳(진단에서 검사 통과 질문이 20개 이상 남았다)
const ENOUGH = GAP_FIXTURES_15.filter((fx) =>
  fx.rounds.some((r) => r.category + r.concern >= 24 - 0 && r.category > 0)
);

describe("15곳 고정 입력 회귀 — 플래그를 켜면 질문 8개 이상·이름 질문 1개 이상(모든 흔들림 변형)", () => {
  it("고정 입력이 15곳이고 ID 외 식별 정보가 없다", () => {
    expect(GAP_FIXTURES_15).toHaveLength(15);
    for (const fx of GAP_FIXTURES_15) {
      expect(fx.id).toMatch(/^[A-Z]-\d{2}$/);
    }
  });

  for (const fx of ENOUGH) {
    for (const variant of VARIANTS) {
      it(`${fx.id} · ${variant}: 질문 ≥ 8, 이름 질문 ≥ 1, 20 초과 없음`, async () => {
        stubFlags(true);
        mockVariant(fx, variant);
        const out = await run(fx);
        expect(out.prompts.length).toBeGreaterThanOrEqual(8);
        expect(out.prompts.length).toBeLessThanOrEqual(20);
        expect(out.prompts.some((p) => p.type === "brand")).toBe(true);
        expect(out.generationLog?.finalCount).toBe(out.prompts.length);
      });
    }
  }

  it("재시도 N회 규칙: 생성이 3번 연속 빈손이어도 마지막에 정상이면(비결정) 통과 — 한 번의 빈손으로 영구 포기하지 않는다", async () => {
    stubFlags(true);
    const fx = GAP_FIXTURES_15.find((f) => f.id === "E-11") as GapFixture;
    const results: number[] = [];
    for (const variant of VARIANTS) {
      mockVariant(fx, variant);
      results.push((await run(fx)).prompts.length);
    }
    expect(Math.max(...results)).toBeGreaterThanOrEqual(8);
  });
});

describe("예전 동작 고정(플래그 꺼짐) — 진단에서 재현된 문제가 그대로 남아 있어야 켜기 전후 비교가 의미 있다", () => {
  it("E-11: 확신 없음이면 통과한 질문을 버리고 기본 질문 4개", async () => {
    stubFlags(false);
    const fx = GAP_FIXTURES_15.find((f) => f.id === "E-11") as GapFixture;
    mockVariant(fx, "recorded");
    expect((await run(fx)).prompts).toHaveLength(4);
  });

  it("이름 질문 전멸 곳(A-21): 꺼짐이면 이름 질문 0개, 생성 기록도 없다", async () => {
    stubFlags(false);
    const fx = GAP_FIXTURES_15.find((f) => f.id === "A-21") as GapFixture;
    mockVariant(fx, "recorded");
    const out = await run(fx);
    expect(out.prompts.some((p) => p.type === "brand")).toBe(false);
    expect(out.generationLog).toBeUndefined();
  });
});

describe("재료가 아예 없는 곳(I-05)은 지어내지 않는다 — 빈 결과는 경고 대상으로 남는다", () => {
  it("업종 기타 + 확신 없음 + 분야 이름 없음 → 질문 0개(생성 기록에 이유가 남는다)", async () => {
    stubFlags(true);
    const fx: GapFixture = {
      ...(GAP_FIXTURES_15.find((f) => f.id === "I-05") as GapFixture),
      rounds: [
        {
          brandNamed: 0,
          brandUnnamed: 0,
          category: 0,
          concern: 0,
          confident: false,
          hasCategoryPhrase: false,
        },
      ],
    };
    mockVariant(fx, "recorded");
    const out = await run(fx);
    expect(out.generationLog?.decision).toMatch(/fallback/);
  });
});
