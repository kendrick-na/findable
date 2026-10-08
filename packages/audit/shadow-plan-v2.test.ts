import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({ database: {} }));
vi.mock("@repo/observability/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import type { EngineResponse } from "@repo/ai/lib/engines";
import type { RunPrompt } from "./audit-prompts";
import { buildBrandProfile } from "./brand-profile";
import type { CollectedProfile } from "./brand-profile-live";
import {
  enginesForAuditPrompt,
  enginesForRunPrompt,
  MAX_AUDIT_CONTINUATIONS,
  makeAuditCheckpoint,
  readAuditCheckpoint,
} from "./checkpoint";
import {
  compareAcrossSearchSampling,
  engineSetKeyOf,
  SEARCH_SAMPLING_CHANGED,
  sameSearchSamplingSeries,
  searchSamplingVersionOf,
} from "./search-sampling-version";
import {
  attachShadowPlan,
  buildShadowPlanV2Result,
  ENGINE_SET_DAILY_NOCLAUDE,
  ENGINE_SET_WEEKLY_FULL,
  enginesForEngineSet,
  isShadowBrandAllowed,
  isShadowPlanV2Enabled,
  requiredContinuations,
  resolveShadowPlanV2,
  SHADOW_MAX_CONTINUATIONS,
  type ShadowPlanDeps,
  shadowAllowlist,
  shadowCadence,
  shadowContinuationLimit,
  shadowMinIntervalDays,
} from "./shadow-plan-v2";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-07T03:00:00.000Z");

describe("shadow plan v2 — flags, allowlist, cadence", () => {
  it("is off unless QUESTION_PLAN_V2_SHADOW=true", () => {
    expect(isShadowPlanV2Enabled({})).toBe(false);
    expect(isShadowPlanV2Enabled({ QUESTION_PLAN_V2_SHADOW: "1" })).toBe(false);
    expect(isShadowPlanV2Enabled({ QUESTION_PLAN_V2_SHADOW: "true" })).toBe(
      true
    );
  });

  it("requires an allowlist entry (empty list = nobody), by brand id or domain", () => {
    expect(shadowAllowlist({})).toEqual([]);
    expect(isShadowBrandAllowed({ brandId: "b1", domain: "a.com" }, {})).toBe(
      false
    );
    const env = {
      QUESTION_PLAN_V2_SHADOW_BRANDS: "b1, https://www.franzskincare.com",
    };
    expect(isShadowBrandAllowed({ brandId: "b1", domain: "x.com" }, env)).toBe(
      true
    );
    expect(
      isShadowBrandAllowed({ brandId: "b9", domain: "franzskincare.com" }, env)
    ).toBe(true);
    expect(isShadowBrandAllowed({ brandId: "b9", domain: "y.com" }, env)).toBe(
      false
    );
  });

  it("runs at most once per brand per week (default) and counts in-flight runs", () => {
    expect(shadowMinIntervalDays({})).toBe(7);
    expect(
      shadowMinIntervalDays({ QUESTION_PLAN_V2_SHADOW_MIN_DAYS: "0" })
    ).toBe(7);
    expect(
      shadowMinIntervalDays({ QUESTION_PLAN_V2_SHADOW_MIN_DAYS: "99" })
    ).toBe(30);
    const recent = [
      {
        createdAt: new Date(NOW.getTime() - 3 * DAY),
        engineSetKey: ENGINE_SET_WEEKLY_FULL,
      },
    ];
    expect(shadowCadence({ now: NOW, recent, minIntervalDays: 7 })).toEqual({
      run: false,
      reason: "too_soon",
      nextEligibleAt: new Date(NOW.getTime() + 4 * DAY),
    });
    expect(shadowCadence({ now: NOW, recent: [], minIntervalDays: 7 })).toEqual(
      { run: true, engineSetKey: ENGINE_SET_WEEKLY_FULL }
    );
  });

  it("weekly run includes Claude; runs in between (shorter interval) exclude it", () => {
    const recent = [
      {
        createdAt: new Date(NOW.getTime() - 2 * DAY),
        engineSetKey: ENGINE_SET_WEEKLY_FULL,
      },
    ];
    expect(shadowCadence({ now: NOW, recent, minIntervalDays: 1 })).toEqual({
      run: true,
      engineSetKey: ENGINE_SET_DAILY_NOCLAUDE,
    });
    expect(
      shadowCadence({
        now: NOW,
        recent: [
          {
            createdAt: new Date(NOW.getTime() - 1 * DAY),
            engineSetKey: ENGINE_SET_DAILY_NOCLAUDE,
          },
          {
            createdAt: new Date(NOW.getTime() - 8 * DAY),
            engineSetKey: ENGINE_SET_WEEKLY_FULL,
          },
        ],
        minIntervalDays: 1,
      })
    ).toEqual({ run: true, engineSetKey: ENGINE_SET_WEEKLY_FULL });
    expect(
      enginesForEngineSet(
        enginesForAuditPrompt("ko"),
        ENGINE_SET_DAILY_NOCLAUDE
      )
    ).toEqual(["chatgpt", "perplexity", "gemini", "naver", "daum"]);
    expect(
      enginesForEngineSet(enginesForAuditPrompt("en"), ENGINE_SET_WEEKLY_FULL)
    ).toEqual(["chatgpt", "claude", "perplexity", "gemini"]);
  });
});

describe("shadow plan v2 — continuation sizing from plan size", () => {
  it("⌈questions × 40s ÷ 240s⌉ + 1, at least the base 2, at most 8", () => {
    expect(requiredContinuations(20)).toBe(5);
    expect(requiredContinuations(28)).toBe(6);
    expect(requiredContinuations(8)).toBe(3);
    expect(shadowContinuationLimit(4, MAX_AUDIT_CONTINUATIONS)).toBe(2);
    expect(shadowContinuationLimit(28, MAX_AUDIT_CONTINUATIONS)).toBe(6);
    expect(shadowContinuationLimit(200, MAX_AUDIT_CONTINUATIONS)).toBe(
      SHADOW_MAX_CONTINUATIONS
    );
  });
});

const collected = (): CollectedProfile => ({
  profile: buildBrandProfile({
    catalog: [
      { name: "프란츠 PDRN 앰플" },
      { name: "프란츠 줄기세포배양액 앰플" },
      { name: "EGF 앰플" },
    ],
    siteOfferings: [],
    siteTextTerms: [],
    industry: "beauty",
  }),
  keywords: {
    KR: [
      { keyword: "PDRN앰플", volume: 18_570, source: "naver" },
      { keyword: "줄기세포앰플", volume: 1560, source: "naver" },
      { keyword: "PDRN앰플효과", volume: 600, source: "naver" },
    ],
    US: [{ keyword: "egf serum", volume: 1900, source: "google" }],
  },
  seeds: { KR: ["PDRN앰플"], US: ["egf"] },
  diagnostics: {
    catalogSource: "sitemap",
    catalogProducts: 3,
    keywordRows: { KR: 3, US: 1 },
    sitePagesRead: 1,
  },
});

const ARGS = {
  brandId: "brand-1",
  domain: "franzskincare.com",
  language: "both" as const,
  scope: "both" as const,
  brandNames: { ko: "프란츠", en: "Franz", variants: ["FRANZ SKINCARE"] },
  competitors: [],
  mainPromptCount: 8,
  baseContinuationLimit: MAX_AUDIT_CONTINUATIONS,
  now: NOW,
};
const ENV = {
  QUESTION_PLAN_V2_SHADOW: "true",
  QUESTION_PLAN_V2_SHADOW_BRANDS: "brand-1",
};

function fakeDeps(over: Partial<ShadowPlanDeps> = {}): ShadowPlanDeps & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    collect: (input) => {
      calls.push(`collect:${input.markets.join(",")}`);
      return Promise.resolve(collected());
    },
    recentShadowRuns: () => {
      calls.push("recent");
      return Promise.resolve([]);
    },
    previousAnswerBrands: () => Promise.resolve(["아누아"]),
    llm: null,
    ...over,
  };
}

describe("shadow plan v2 — resolve (fail-open, cost-capped)", () => {
  it("does nothing (no source calls) when off or not allowlisted", async () => {
    const deps = fakeDeps();
    expect(await resolveShadowPlanV2({ ...ARGS, env: {} }, deps)).toBeNull();
    expect(
      await resolveShadowPlanV2(
        { ...ARGS, env: { QUESTION_PLAN_V2_SHADOW: "true" } },
        deps
      )
    ).toBeNull();
    expect(deps.calls).toEqual([]);
  });

  it("skips (without collecting) when the brand already had a shadow this week", async () => {
    const deps = fakeDeps({
      recentShadowRuns: () =>
        Promise.resolve([
          {
            createdAt: new Date(NOW.getTime() - DAY),
            engineSetKey: ENGINE_SET_WEEKLY_FULL,
          },
        ]),
    });
    expect(await resolveShadowPlanV2({ ...ARGS, env: ENV }, deps)).toBeNull();
    expect(deps.calls).toEqual([]);
  });

  it("plans v2 questions tagged with the engine set and a plan-sized continuation cap", async () => {
    const deps = fakeDeps();
    const out = await resolveShadowPlanV2({ ...ARGS, env: ENV }, deps);
    expect(deps.calls).toEqual(["recent", "collect:KR,US"]);
    // 작은 고정 입력(키워드 4개)이라 20문항을 다 채우지 못한다 — 지어내지 않는다.
    const count = out?.prompts.length ?? 0;
    expect(count).toBeGreaterThan(10);
    expect(count).toBeLessThanOrEqual(20);
    expect(
      out?.prompts.every(
        (p) => p.planV2?.engineSetKey === ENGINE_SET_WEEKLY_FULL
      )
    ).toBe(true);
    expect(out?.prompts.filter((p) => p.kind === "brand")).toHaveLength(3);
    expect(out?.checkpoint).toMatchObject({
      questionPlanVersion: 2,
      engineSetKey: ENGINE_SET_WEEKLY_FULL,
      questionCount: count,
      maxContinuations: shadowContinuationLimit(8 + count, 2),
      measurementContext: {
        questionPlanVersion: 2,
        engineSetKey: ENGINE_SET_WEEKLY_FULL,
        usedInScores: false,
        nameLessCount: count - 3,
        cadence: { minIntervalDays: 7 },
      },
    });
  });

  it("records question-improvement metrics and keeps planning LLM cost out of totalKrw", async () => {
    const llm = (request: { callSite: string }) =>
      Promise.resolve({
        costKrw: 2,
        text:
          request.callSite === "question-plan.profile"
            ? JSON.stringify({
                products: [
                  { name: "앰플", type: "product" },
                  { name: "PDRN", type: "ingredient" },
                ],
                useCases: [],
                targetCustomers: [],
                problemsSolved: [],
                categories: ["스킨케어 앰플"],
                differentiators: [],
              })
            : "{}",
      });
    const out = await resolveShadowPlanV2(
      { ...ARGS, env: ENV },
      fakeDeps({ llm })
    );
    if (!out) {
      throw new Error("expected a plan");
    }
    expect(out.checkpoint.metrics).toMatchObject({
      profileSource: "llm",
      judge: "unavailable",
      llmCostKrw: 6,
      llmCalls: { profile: "ok", generate: "invalid", judge: "invalid" },
    });
    expect(
      out.checkpoint.measurementContext.profile.structured?.categories
    ).toEqual(["스킨케어 앰플"]);
    expect(out.checkpoint.measurementContext).not.toHaveProperty("kinTitles");
    const result = buildShadowPlanV2Result({
      checkpoint: out.checkpoint,
      prompts: out.prompts,
      batches: [],
      verification: "unverified",
      cost: { costModelVersion: 2, totalKrw: 10, perEngine: [] },
    });
    expect(result.metrics?.llmCostKrw).toBe(6);
    expect(result.cost).toMatchObject({ totalKrw: 10, planningLlmKrw: 6 });
  });

  it("never throws: a collector failure means no shadow", async () => {
    const deps = fakeDeps({
      collect: () => Promise.reject(new Error("boom")),
    });
    expect(await resolveShadowPlanV2({ ...ARGS, env: ENV }, deps)).toBeNull();
  });
});

describe("shadow plan v2 — checkpoint contract", () => {
  const scope = {
    domain: "franzskincare.com",
    language: "both" as const,
    brandId: "brand-1",
    organizationId: "org-1",
  };
  const context = {
    brandName: "프란츠",
    brandVariants: [],
    identityGrounded: true,
    officialSiteIdentity: {
      finalUrl: "https://franzskincare.com",
      title: "프란츠",
      description: null,
      h1: null,
      siteName: null,
    },
  };
  const main: RunPrompt[] = [
    { kind: "brand", lang: "ko", text: "프란츠는 어떤 브랜드야?" },
  ];

  it("daily shadow questions skip Claude in the saved engine plan; resumes validate", async () => {
    const plan = await resolveShadowPlanV2(
      {
        ...ARGS,
        mainPromptCount: 1,
        env: { ...ENV, QUESTION_PLAN_V2_SHADOW_MIN_DAYS: "1" },
      },
      fakeDeps({
        recentShadowRuns: () =>
          Promise.resolve([
            {
              createdAt: new Date(NOW.getTime() - 2 * DAY),
              engineSetKey: ENGINE_SET_WEEKLY_FULL,
            },
          ]),
      })
    );
    expect(plan?.checkpoint.engineSetKey).toBe(ENGINE_SET_DAILY_NOCLAUDE);
    const checkpoint = attachShadowPlan(
      makeAuditCheckpoint(
        scope,
        context,
        [...main, ...(plan?.prompts ?? [])],
        NOW.toISOString()
      ),
      plan ?? null,
      main.length,
      MAX_AUDIT_CONTINUATIONS
    );
    expect(checkpoint.shadowPlanV2?.startIndex).toBe(1);
    expect(checkpoint.enginePlan[0]).toContain("claude");
    expect(checkpoint.enginePlan[1]).not.toContain("claude");
    expect(enginesForRunPrompt(checkpoint.prompts[1] as RunPrompt)).toEqual(
      checkpoint.enginePlan[1]
    );
    const saved = JSON.parse(
      JSON.stringify({
        ...checkpoint,
        continuation: { count: 4, requestedAt: NOW.toISOString() },
      })
    );
    expect(readAuditCheckpoint(saved, scope)?.shadowPlanV2?.startIndex).toBe(1);
  });

  it("rejects a shadow checkpoint that leaks into the scored set or over-continues", async () => {
    const plan = await resolveShadowPlanV2(
      { ...ARGS, mainPromptCount: 1, env: ENV },
      fakeDeps()
    );
    const checkpoint = attachShadowPlan(
      makeAuditCheckpoint(
        scope,
        context,
        [...main, ...(plan?.prompts ?? [])],
        NOW.toISOString()
      ),
      plan ?? null,
      main.length,
      MAX_AUDIT_CONTINUATIONS
    );
    const clone = () => JSON.parse(JSON.stringify(checkpoint));
    // planV2 questions without a shadow record (would be scored)
    const noRecord = clone();
    noRecord.shadowPlanV2 = undefined;
    expect(() => readAuditCheckpoint(noRecord, scope)).toThrow();
    // a shadow record pointing into the current set
    const shifted = clone();
    shifted.shadowPlanV2.startIndex = 0;
    expect(() => readAuditCheckpoint(shifted, scope)).toThrow();
    // more continuations than the plan allows
    const over = clone();
    over.continuation = {
      count: (checkpoint.shadowPlanV2?.maxContinuations ?? 0) + 1,
      requestedAt: NOW.toISOString(),
    };
    expect(() => readAuditCheckpoint(over, scope)).toThrow();
    // a normal run still caps at 2
    const plain = JSON.parse(
      JSON.stringify({
        ...makeAuditCheckpoint(scope, context, main, NOW.toISOString()),
        continuation: { count: 3, requestedAt: NOW.toISOString() },
      })
    );
    expect(() => readAuditCheckpoint(plain, scope)).toThrow();
  });
});

describe("shadow plan v2 — stored result (never scored)", () => {
  const row = (
    engineId: string,
    over: Partial<EngineResponse> = {}
  ): EngineResponse => ({
    engineId: engineId as EngineResponse["engineId"],
    rawResponse: "x".repeat(2000),
    brandMentioned: true,
    mentionQuality: "confirmed",
    mentionPosition: 1,
    mentionListSize: 5,
    sentiment: "neutral",
    citedSources: [],
    shareOfVoice: 0.2,
    errorMessage: null,
    durationMs: 1,
    isStub: false,
    ...over,
  });
  it("tallies exact exposure per type; search engines and failures are not answers", async () => {
    const plan = await resolveShadowPlanV2({ ...ARGS, env: ENV }, fakeDeps());
    if (!plan) {
      throw new Error("expected a plan");
    }
    const prompts = plan.prompts.slice(0, 2);
    const result = buildShadowPlanV2Result({
      checkpoint: { ...plan.checkpoint, questionCount: 2 },
      prompts,
      batches: [
        [
          row("chatgpt"),
          row("perplexity", {
            brandMentioned: false,
            mentionQuality: "absent",
          }),
          row("gemini", { mentionQuality: "different_entity" }),
          row("naver"),
          row("claude", { errorMessage: "ENGINE_TIMEOUT" }),
        ],
        [row("chatgpt")],
      ],
      verification: "verified",
      cost: { costModelVersion: 2, totalKrw: 12.3, perEngine: [] },
    });
    expect(result.usedInScores).toBe(false);
    expect(result.summary.byType.A).toEqual({
      answers: 4,
      mentioned: 3,
      accurate: 2,
    });
    expect(result.summary.nameLess).toEqual({
      answers: 4,
      mentioned: 3,
      accurate: 2,
    });
    expect(result.engineResponses[0]?.excerpt).toHaveLength(1500);
    expect(result.measurementContext).toMatchObject({
      questionPlanVersion: 2,
      questionsPlanned: 2,
      questionsAnswered: 2,
    });
  });
});

describe("engine set guard — trend comparison", () => {
  const naver = {
    engineId: "naver",
    naverSource: "search_results",
    naverSamplingVersion: "interleave-v1",
  };
  const legacy = { engineResponses: [naver], measurementContext: {} };
  const daily = {
    engineResponses: [naver],
    measurementContext: { engineSetKey: ENGINE_SET_DAILY_NOCLAUDE },
  };
  const weekly = {
    engineResponses: [naver],
    measurementContext: {
      engineSetKey: ENGINE_SET_WEEKLY_FULL,
      questionPlanVersion: 2,
    },
  };

  it("leaves every stored run's key unchanged; appends the engine set / plan when recorded", () => {
    expect(searchSamplingVersionOf(legacy)).toBe("interleave-v1");
    expect(engineSetKeyOf(legacy)).toBeNull();
    expect(searchSamplingVersionOf(daily)).toBe(
      "interleave-v1+engines:daily-noclaude-v1"
    );
    expect(searchSamplingVersionOf(weekly)).toBe(
      "interleave-v1+engines:weekly-full-v1+plan:2"
    );
  });

  it("blocks Claude-less vs Claude-included (and legacy) comparisons and trend points", () => {
    expect(
      compareAcrossSearchSampling(
        { value: 40, version: searchSamplingVersionOf(daily) },
        { value: 55, version: searchSamplingVersionOf(weekly) }
      )
    ).toEqual({
      blockedReason: SEARCH_SAMPLING_CHANGED,
      comparable: false,
      delta: null,
    });
    expect(
      compareAcrossSearchSampling(
        { value: 40, version: searchSamplingVersionOf(legacy) },
        { value: 55, version: searchSamplingVersionOf(daily) }
      ).comparable
    ).toBe(false);
    expect(
      compareAcrossSearchSampling(
        { value: 40, version: searchSamplingVersionOf(daily) },
        { value: 45, version: searchSamplingVersionOf(daily) }
      )
    ).toEqual({ blockedReason: null, comparable: true, delta: 5 });
    expect(
      sameSearchSamplingSeries(
        [legacy, daily, weekly, daily],
        searchSamplingVersionOf,
        searchSamplingVersionOf(daily)
      )
    ).toEqual({ excludedCount: 2, points: [daily, daily] });
  });
});
