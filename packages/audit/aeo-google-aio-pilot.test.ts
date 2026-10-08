import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({ database: {} }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  type FetchGoogleAioArgs,
  fetchGoogleAio,
  type GoogleAioResult,
} from "@repo/ai/lib/engines/google-aio-adapter";
import {
  AEO_PILOT_MONTHLY_CAP,
  type AeoPilotDeps,
  type AeoPilotRun,
  aeoPilotMonthlyCap,
  isAeoPilotBrandAllowed,
  kstMonthStart,
  measureAeoPilotBrand,
  runAeoGoogleAioPilot,
  selectAeoPilotQuestions,
} from "./aeo-google-aio-pilot";
import { publicAuditResult } from "./normalize-stored-metrics";

const fixture = (name: string) =>
  readFileSync(
    new URL(`../ai/lib/engines/__fixtures__/${name}`, import.meta.url),
    "utf8"
  );
const SHOWN = fixture("google-aio-shown.json");
const NOT_SHOWN = fixture("google-aio-not-shown.json");
const ENV_ON = {
  AEO_GOOGLE_AIO_PILOT: "true",
  AEO_PILOT_BRANDS: "franzskincare.com",
  BRIGHTDATA_API_KEY: "test-key",
  BRIGHTDATA_SERP_ZONE: "zone1",
};

const q = (
  index: number,
  over: Partial<{ kind: string; market: string; text: string; type: string }>
) => ({
  index,
  kind: "discovery",
  market: "KR",
  type: "A",
  lang: "ko",
  text: `질문 ${index}`,
  ...over,
});

/** fixture 기반 가짜 Bright Data(네트워크 없음): 텍스트에 "shown" 이 있으면 AI 개요가 뜬다. */
const fixtureFetchAio = vi.fn(
  (args: FetchGoogleAioArgs): Promise<GoogleAioResult> =>
    fetchGoogleAio({
      ...args,
      fetchImpl: (async () =>
        new Response(args.query.includes("shown") ? SHOWN : NOT_SHOWN, {
          status: 200,
        })) as unknown as typeof fetch,
    })
);

describe("flags and allowlist", () => {
  it("allows only listed brand IDs or domains", () => {
    const env = { AEO_PILOT_BRANDS: "brand-1, https://www.franzskincare.com/" };
    expect(
      isAeoPilotBrandAllowed({ id: "brand-1", domain: "a.com" }, env)
    ).toBe(true);
    expect(
      isAeoPilotBrandAllowed({ id: "x", domain: "franzskincare.com" }, env)
    ).toBe(true);
    expect(isAeoPilotBrandAllowed({ id: "x", domain: "b.com" }, env)).toBe(
      false
    );
    expect(isAeoPilotBrandAllowed({ id: "brand-1", domain: "a.com" }, {})).toBe(
      false
    );
  });

  it("monthly cap can only be lowered", () => {
    expect(aeoPilotMonthlyCap({})).toBe(AEO_PILOT_MONTHLY_CAP);
    expect(aeoPilotMonthlyCap({ AEO_PILOT_MONTHLY_CAP: "100" })).toBe(100);
    expect(aeoPilotMonthlyCap({ AEO_PILOT_MONTHLY_CAP: "99999" })).toBe(4500);
  });

  it("uses the KST calendar month", () => {
    // 2026-10-31 16:00 UTC = 2026-11-01 01:00 KST → 11월 1일 0시 KST = 10-31 15:00 UTC.
    expect(kstMonthStart(new Date("2026-10-31T16:00:00Z")).toISOString()).toBe(
      "2026-10-31T15:00:00.000Z"
    );
  });
});

describe("selectAeoPilotQuestions", () => {
  it("keeps non-branded A–D discovery questions, dedupes, interleaves markets, caps 20", () => {
    const questions = [
      q(0, { type: "E", kind: "brand" }),
      q(1, { text: "PDRN 앰플 추천" }),
      q(2, { text: "pdrn 앰플 추천" }),
      q(3, { type: "E" }),
      q(4, { kind: "brand", type: "A" }),
      q(5, { market: "US", text: "best PDRN serum", type: "D" }),
      ...Array.from({ length: 30 }, (_, i) => q(10 + i, { type: "B" })),
    ];
    const picked = selectAeoPilotQuestions({ questions });
    expect(picked).toHaveLength(20);
    expect(picked[0]).toEqual({
      index: 1,
      market: "KR",
      text: "PDRN 앰플 추천",
      type: "A",
    });
    expect(picked[1]).toMatchObject({ index: 5, market: "US" });
    expect(picked.some((p) => p.index === 2 || p.index === 3)).toBe(false);
    expect(selectAeoPilotQuestions(null)).toEqual([]);
  });
});

describe("measureAeoPilotBrand", () => {
  it("measures per question+market and summarizes rule-based metrics", async () => {
    const run = await measureAeoPilotBrand({
      brand: {
        id: "b1",
        domain: "franzskincare.com",
        names: ["프란츠", "Franz"],
      },
      questions: [
        { index: 0, market: "KR", text: "shown 1", type: "A" },
        { index: 1, market: "KR", text: "plain 2", type: "B" },
        { index: 2, market: "US", text: "shown 3", type: "C" },
      ],
      monthlyUsed: 0,
      sourceAuditJobId: "job-1",
      fetchAio: fixtureFetchAio,
      env: ENV_ON,
      now: new Date("2026-10-07T00:00:00Z"),
    });
    expect(run).toMatchObject({
      usedInScores: false,
      sourceLabel: "제3자 측정 서비스 기준",
      officialDomain: "franzskincare.com",
      cost: {
        credits: 3,
        requestsAttempted: 3,
        basis: "free_tier",
        billedKrw: 0,
      },
    });
    expect(run.summary.KR).toMatchObject({
      questions: 2,
      measured: 2,
      shown: 1,
      showRate: 0.5,
      brandMentioned: 1,
      brandMentionRate: 1,
      officialCited: 1,
      officialCitedRate: 1,
    });
    expect(run.summary.KR?.topCitedDomains[0]).toEqual({
      domain: "blog.example.com",
      count: 1,
    });
    expect(run.summary.US).toMatchObject({ questions: 1, shown: 1 });
    expect(run.rows.map((r) => r.status)).toEqual([
      "shown",
      "not_shown",
      "shown",
    ]);
  });

  it("excludes failures from the show-rate denominator", async () => {
    const run = await measureAeoPilotBrand({
      brand: { id: "b1", domain: "x.com", names: ["엑스"] },
      questions: [
        { index: 0, market: "US", text: "shown", type: "A" },
        { index: 1, market: "US", text: "x", type: "A" },
      ],
      monthlyUsed: 4999,
      sourceAuditJobId: "job-1",
      fetchAio: (args) =>
        args.query === "x"
          ? fetchGoogleAio({ ...args, env: {} })
          : fixtureFetchAio(args),
      env: ENV_ON,
    });
    expect(run.summary.US).toMatchObject({
      questions: 2,
      measured: 1,
      failed: 1,
      showRate: 1,
      brandMentionRate: 0,
      officialCitedRate: 0,
    });
    // 5,000번째는 무료, 5,001번째(실패 · 0크레딧)는 유료 구간.
    expect(run.cost).toMatchObject({ credits: 1, basis: "paid" });
  });
});

const PLAN = {
  questions: [
    q(0, { text: "shown a" }),
    q(1, { text: "plain b" }),
    q(2, { market: "US", text: "shown c", lang: "en" } as never),
  ],
};

function makeDeps(over: Partial<AeoPilotDeps> = {}) {
  const appended: Array<{ id: string; run: AeoPilotRun }> = [];
  const deps: AeoPilotDeps = {
    fetchAio: fixtureFetchAio,
    listBrands: vi.fn(async () => [
      {
        id: "b1",
        name: "프란츠",
        domain: "franzskincare.com",
        entityVariants: ["Franz"],
      },
      // 허용 목록 밖 — DB 가 돌려줘도 다시 거른다.
      { id: "b2", name: "남", domain: "other.com", entityVariants: [] },
    ]),
    monthlyRequests: vi.fn(async () => 0),
    lastRunAt: vi.fn(async () => null),
    latestShadowSource: vi.fn(async () => ({
      auditJobId: "job-1",
      shadowPlanV2: PLAN,
    })),
    appendRun: vi.fn((id: string, run: AeoPilotRun) => {
      appended.push({ id, run });
      return Promise.resolve();
    }),
    ...over,
  };
  return { deps, appended };
}

describe("runAeoGoogleAioPilot", () => {
  it("does nothing when the flag is off or the allowlist is empty", async () => {
    const { deps } = makeDeps();
    for (const env of [
      { ...ENV_ON, AEO_GOOGLE_AIO_PILOT: "false" },
      { ...ENV_ON, AEO_PILOT_BRANDS: "" },
    ]) {
      const out = await runAeoGoogleAioPilot({ env, deps });
      expect(out.enabled).toBe(false);
    }
    expect(deps.listBrands).not.toHaveBeenCalled();
    expect(deps.monthlyRequests).not.toHaveBeenCalled();
  });

  it("measures allowlisted brands and appends to the source job only", async () => {
    const { deps, appended } = makeDeps();
    const out = await runAeoGoogleAioPilot({
      env: ENV_ON,
      deps,
      now: new Date("2026-10-07T00:00:00Z"),
    });
    expect(out.brands).toEqual([
      { brandId: "b1", status: "measured", questions: 3, credits: 3 },
    ]);
    expect(out.monthlyUsedAfter).toBe(3);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.id).toBe("job-1");
    expect(appended[0]?.run.summary.KR?.brandMentioned).toBe(1);
  });

  it("runs at most once a week per brand", async () => {
    const { deps, appended } = makeDeps({
      lastRunAt: vi.fn(async () => new Date("2026-10-02T00:00:00Z")),
    });
    const out = await runAeoGoogleAioPilot({
      env: ENV_ON,
      deps,
      now: new Date("2026-10-07T00:00:00Z"),
    });
    expect(out.brands).toEqual([{ brandId: "b1", status: "too_soon" }]);
    expect(appended).toHaveLength(0);
  });

  it("stops before the monthly cap would be exceeded", async () => {
    const { deps, appended } = makeDeps({
      monthlyRequests: vi.fn(async () => 4498),
    });
    const out = await runAeoGoogleAioPilot({ env: ENV_ON, deps });
    expect(out.brands).toEqual([{ brandId: "b1", status: "quota" }]);
    expect(appended).toHaveLength(0);
  });

  it("skips brands without a question plan v2 and never throws", async () => {
    const noPlan = makeDeps({ latestShadowSource: vi.fn(async () => null) });
    expect(
      (await runAeoGoogleAioPilot({ env: ENV_ON, deps: noPlan.deps })).brands
    ).toEqual([{ brandId: "b1", status: "no_plan" }]);

    const broken = makeDeps({
      appendRun: vi.fn(() => Promise.reject(new Error("db down"))),
    });
    expect(
      (await runAeoGoogleAioPilot({ env: ENV_ON, deps: broken.deps })).brands
    ).toEqual([{ brandId: "b1", status: "error" }]);

    const down = makeDeps({
      monthlyRequests: vi.fn(() => Promise.reject(new Error("db down"))),
    });
    await expect(
      runAeoGoogleAioPilot({ env: ENV_ON, deps: down.deps })
    ).resolves.toMatchObject({ enabled: true, brands: [] });
  });
});

describe("public API isolation", () => {
  it("strips aeoPilotRuns from public audit results", () => {
    const out = publicAuditResult({
      aeoPilotRuns: [{ rows: [] }],
      overallScore: 10,
    }) as Record<string, unknown>;
    expect(out.aeoPilotRuns).toBeUndefined();
  });
});
