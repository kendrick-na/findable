import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({ database: {} }));
vi.mock("@repo/observability/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { buildBrandProfile } from "./brand-profile";
import { liveProfileSourceDeps } from "./brand-profile-live";
import type { BuildPlanV2Input } from "./question-plan-v2";
import {
  dedupeCandidates,
  extractJson,
  ingredientAsProduct,
  keywordFits,
  keywordInText,
  keywordTooBroad,
  type LlmBrandProfile,
  type PlanCandidate,
  type PlanLlm,
  type PlanLlmRequest,
  profileEvidence,
  refineQuestionPlanV2,
  sanitizeLlmProfile,
  textSimilarity,
} from "./question-plan-v2-refine";

const PROFILE: LlmBrandProfile = {
  products: [
    { name: "앰플", type: "product" },
    { name: "크림", type: "product" },
    { name: "마스크팩", type: "product" },
    { name: "PDRN", type: "ingredient" },
    { name: "EGF 펩타이드", type: "ingredient" },
    { name: "줄기세포 배양액", type: "ingredient" },
  ],
  useCases: ["피부 탄력 관리"],
  targetCustomers: ["30대 이상 건성 피부"],
  problemsSolved: ["피부 탄력 저하"],
  categories: ["스킨케어 앰플", "세럼"],
  differentiators: ["고농도 PDRN"],
};

const input = (): BuildPlanV2Input & { industry: string } => ({
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
    US: [{ keyword: "pdrn serum", volume: 1900, source: "google" }],
  },
  markets: ["KR", "US"],
  brandNames: ["프란츠", "Franz", "FRANZ SKINCARE"],
  displayNames: { ko: "프란츠", en: "Franz" },
  competitors: [],
  otherBrandNames: ["아누아"],
  industry: "beauty",
});

/** 생성 후보 — keywordId k1 = PDRN앰플, k2 = 줄기세포앰플, k3 = PDRN앰플효과, k4 = pdrn serum. */
const GENERATED = [
  // A KR
  ["A", "KR", "요즘 괜찮은 PDRN 앰플 추천 좀 해줘", "k1"],
  ["A", "KR", "PDRN 들어간 앰플 추천해줘", "k1"],
  ["A", "KR", "줄기세포 배양액 들어간 앰플 뭐가 좋아?", "k2"],
  ["A", "KR", "피부 탄력 앰플 추천해줘", null],
  ["A", "KR", "건성 피부용 세럼 추천해줘", null],
  ["A", "KR", "모공 관리 앰플 어디 거가 좋아?", null],
  ["A", "KR", "주름 개선 크림 추천 좀", null],
  ["A", "KR", "민감성 피부 진정 앰플 알려줘", null],
  ["A", "KR", "피부 관리 추천해줘", null], // 심사: too_broad
  ["A", "KR", "프란츠 앰플 추천해줘", null], // 결정적: 우리 이름
  ["A", "KR", "아누아 앰플 말고 다른 거 추천해줘", null], // 결정적: 다른 브랜드
  ["A", "KR", "EGF 펩타이드 뭐가 좋아?", null], // 결정적: 성분 = 상품
  ["A", "KR", "없는 키워드로 만든 질문이야", "k99"], // 목록에 없는 키워드 → 버림
  // B KR
  ["B", "KR", "PDRN 앰플 효과 진짜 있어?", "k3"],
  ["B", "KR", "앰플이랑 세럼 바르는 순서 어떻게 해?", null],
  ["B", "KR", "줄기세포 화장품 부작용 없어?", null],
  ["B", "KR", "피부 재생 관리 집에서 어떻게 해?", null],
  // C KR
  ["C", "KR", "연어 PDRN 10% 들어간 고농도 앰플 있어?", null],
  ["C", "KR", "EGF 들어간 재생 앰플 찾고 있어", null],
  ["C", "KR", "PDRN 마스크 팩 찾고 있는데 괜찮은 제품 있어?", null], // 심사: fragment
  // D KR
  ["D", "KR", "PDRN 앰플 브랜드들 비교해줘. 어디가 제일 나아?", "k1"],
  ["D", "KR", "줄기세포 앰플 어디 제품이 제일 나아?", "k2"],
  // US
  ["A", "US", "What's a good PDRN serum?", "k4"],
  ["A", "US", "Can you recommend a Korean ampoule for firmness?", null],
  ["A", "US", "Best stem cell skincare serum for dry skin?", null],
  ["B", "US", "Does PDRN serum actually work?", "k4"],
  ["B", "US", "How do I layer an ampoule in my routine?", null],
  ["C", "US", "Is there a serum with 10% salmon PDRN?", null],
  ["C", "US", "Any EGF repair ampoule worth trying?", null],
  ["D", "US", "Compare Korean PDRN serum brands. Which is best?", "k4"],
  ["D", "US", "Which stem cell ampoule brand is best?", null],
] as const;

const JUDGE_LINE_RE = /^(c\d+)\|([A-E])\|(KR|US)\|(.*)$/gm;

function judgeText(prompt: string): string {
  const results = [...prompt.matchAll(JUDGE_LINE_RE)].map((m) => {
    const text = m[4] ?? "";
    if (text.includes("피부 관리 추천")) {
      return { id: m[1], pass: false, reasons: ["too_broad"] };
    }
    if (text.includes("마스크 팩")) {
      return { id: m[1], pass: false, reasons: ["fragment"] };
    }
    return { id: m[1], pass: true, reasons: [] };
  });
  return JSON.stringify({ results });
}

function fakeLlm(
  over: Partial<Record<"profile" | "generate" | "judge", string | Error>> = {}
): PlanLlm & { calls: PlanLlmRequest[] } {
  const calls: PlanLlmRequest[] = [];
  const fn = (request: PlanLlmRequest) => {
    calls.push(request);
    const step = request.callSite.split(".")[1] as
      | "profile"
      | "generate"
      | "judge";
    const forced = over[step];
    if (forced instanceof Error) {
      return Promise.reject(forced);
    }
    let text = forced;
    if (text === undefined) {
      if (step === "profile") {
        text = `\`\`\`json\n${JSON.stringify(PROFILE)}\n\`\`\``;
      } else if (step === "generate") {
        text = JSON.stringify({
          candidates: GENERATED.map(([type, market, t, keywordId]) => ({
            type,
            market,
            text: t,
            keywordId,
          })),
        });
      } else {
        text = judgeText(request.prompt);
      }
    }
    return Promise.resolve({ text, costKrw: 1.5 });
  };
  return Object.assign(fn, { calls });
}

describe("question plan v2 refine — LLM profile", () => {
  it("validates the profile with zod and strips own brand names", () => {
    expect(sanitizeLlmProfile({ products: [] }, ["프란츠"])).toBeNull();
    expect(
      sanitizeLlmProfile(
        { ...PROFILE, products: [{ name: "앰플", type: "gadget" }] },
        ["프란츠"]
      )
    ).toBeNull();
    const clean = sanitizeLlmProfile(
      {
        ...PROFILE,
        products: [
          ...PROFILE.products,
          { name: "프란츠 앰플", type: "product" },
        ],
      },
      ["프란츠"]
    );
    expect(clean?.products.map((p) => p.name)).not.toContain("프란츠 앰플");
    expect(extractJson('설명 {"a":1} 끝')).toEqual({ a: 1 });
    expect(extractJson("not json")).toBeNull();
  });

  it("falls back to the rule profile when the profile JSON is invalid or the call fails", async () => {
    for (const bad of ["{not json", new Error("letsur down")]) {
      const llm = fakeLlm({ profile: bad });
      const out = await refineQuestionPlanV2(input(), llm);
      expect(out.metrics.profileSource).toBe("rules");
      expect(out.metrics.llmCalls.profile).toBe(
        bad instanceof Error ? "failed" : "invalid"
      );
      // LLM 프로필이 없으면 다시 쓰기는 하지 않는다(근거 없는 생성 금지) — 규칙 문장 + 심사만.
      expect(llm.calls.map((c) => c.callSite)).toEqual([
        "question-plan.profile",
        "question-plan.judge",
      ]);
      expect(out.llmProfile).toBeNull();
      expect(out.plan.questions.length).toBeGreaterThan(0);
    }
  });

  it("returns the rule plan untouched when there is no LLM", async () => {
    const out = await refineQuestionPlanV2(input(), null);
    expect(out.metrics).toMatchObject({
      profileSource: "rules",
      judge: "unavailable",
      llmCostKrw: 0,
      judgePassRate: null,
    });
  });

  it("feeds only official-site evidence to the profile call (no Naver 지식iN)", async () => {
    const llm = fakeLlm();
    await refineQuestionPlanV2(input(), llm);
    const prompt = llm.calls[0]?.prompt ?? "";
    expect(prompt).toContain("[상품명·ko] 프란츠 PDRN 앰플");
    expect(prompt).not.toMatch(/지식iN|지식인/);
    expect(profileEvidence(input()).every((l) => l.startsWith("["))).toBe(true);
    // 수집 경로에도 지식iN 호출이 없다(네이버 Open API 약관 — 법무 검토 대기).
    expect(Object.keys(liveProfileSourceDeps)).not.toContain("kinTitles");
  });
});

describe("question plan v2 refine — ingredient, judge, dedupe", () => {
  it("flags a keyword that is only a fragment of the brand's specific category as too broad", () => {
    const kv: LlmBrandProfile = {
      ...PROFILE,
      products: [{ name: "AI 캐릭터 영상 제작", type: "service" }],
      categories: ["AI 캐릭터 영상 제작", "AI 교육"],
    };
    const q = (text: string, keyword: string) => ({
      text,
      provenance: {
        keyword,
        volume: 100,
        source: "naver" as const,
        expanded: false,
      },
    });
    expect(keywordTooBroad(q("영상 제작 추천해줘", "영상제작"), kv)).toBe(true);
    expect(
      keywordTooBroad(q("AI 캐릭터 영상 제작 업체 추천해줘", "영상제작"), kv)
    ).toBe(false);
    expect(keywordTooBroad(q("AI 교육 추천해줘", "AI교육"), kv)).toBe(false);
    expect(keywordTooBroad(q("영상 제작 추천해줘", "영상제작"), null)).toBe(
      false
    );
  });

  it("never treats an ingredient as a product", () => {
    expect(ingredientAsProduct("EGF 펩타이드 뭐가 좋아?", PROFILE)).toBe(true);
    expect(ingredientAsProduct("PDRN 추천해줘", PROFILE)).toBe(true);
    expect(ingredientAsProduct("PDRN 들어간 앰플 추천해줘", PROFILE)).toBe(
      false
    );
    expect(ingredientAsProduct("수분 크림 추천해줘", PROFILE)).toBe(false);
    expect(ingredientAsProduct("EGF 펩타이드 뭐가 좋아?", null)).toBe(false);
  });

  it("removes branded, ingredient-as-product, fragment and too-broad candidates and keeps reasons", async () => {
    const out = await refineQuestionPlanV2(input(), fakeLlm());
    const texts = out.plan.questions.map((q) => q.text);
    const rejected = new Map(out.rejected.map((r) => [r.text, r.reasons]));
    expect(rejected.get("프란츠 앰플 추천해줘")).toContain("branded");
    expect(rejected.get("아누아 앰플 말고 다른 거 추천해줘")).toContain(
      "branded"
    );
    expect(rejected.get("EGF 펩타이드 뭐가 좋아?")).toContain(
      "ingredient_as_product"
    );
    expect(rejected.get("피부 관리 추천해줘")).toEqual(["too_broad"]);
    expect(
      rejected.get("PDRN 마스크 팩 찾고 있는데 괜찮은 제품 있어?")
    ).toEqual(["fragment"]);
    for (const bad of rejected.keys()) {
      expect(texts).not.toContain(bad);
    }
    // 목록에 없는 키워드를 댄 후보는 후보에도 들어가지 않는다.
    expect(texts).not.toContain("없는 키워드로 만든 질문이야");
    // 이름 없는 질문에는 어떤 브랜드 이름도 없다.
    for (const q of out.plan.questions.filter((x) => x.kind === "discovery")) {
      expect(q.text).not.toMatch(/프란츠|franz|아누아/i);
    }
  });

  it("de-duplicates near-identical questions (normalized 2-gram Jaccard)", () => {
    expect(
      textSimilarity("PDRN 앰플 추천해줘", "요즘 괜찮은 PDRN 앰플 추천 좀 해줘")
    ).toBe(1);
    expect(
      textSimilarity("PDRN 앰플 추천해줘", "줄기세포 크림 뭐가 좋아?")
    ).toBeLessThan(0.2);
    const c = (id: string, text: string): PlanCandidate => ({
      id,
      text,
      type: "A",
      kind: "discovery",
      market: "KR",
      lang: "ko",
      provenance: {
        keyword: null,
        volume: null,
        source: "profile",
        expanded: false,
      },
    });
    const { kept, removed } = dedupeCandidates([
      c("1", "PDRN 앰플 추천해줘"),
      c("2", "요즘 괜찮은 PDRN 앰플 추천 좀 해줘"),
      c("3", "줄기세포 크림 뭐가 좋아?"),
    ]);
    expect(kept.map((k) => k.id)).toEqual(["1", "3"]);
    expect(removed.map((k) => k.id)).toEqual(["2"]);
  });
});

describe("question plan v2 refine — grounding", () => {
  it("ties an id-less LLM question to the most specific same-market keyword it literally contains", () => {
    const ids = new Map([
      [
        "k1",
        {
          market: "KR" as const,
          row: {
            keyword: "앰플",
            volume: 90_000,
            source: "naver" as const,
            matched: true,
          },
        },
      ],
      [
        "k2",
        {
          market: "KR" as const,
          row: {
            keyword: "PDRN앰플",
            volume: 18_570,
            source: "naver" as const,
            matched: true,
          },
        },
      ],
      [
        "k3",
        {
          market: "US" as const,
          row: {
            keyword: "pdrn",
            volume: 49_500,
            source: "google" as const,
            matched: true,
          },
        },
      ],
    ]);
    expect(keywordInText("PDRN 앰플 효과 있어?", "KR", ids)?.row.keyword).toBe(
      "PDRN앰플"
    );
    expect(keywordInText("수분 앰플 추천해줘", "KR", ids)?.row.keyword).toBe(
      "앰플"
    );
    expect(keywordInText("세럼 추천해줘", "KR", ids)).toBeUndefined();
    expect(keywordInText("pdrn 앰플", "US", ids)?.row.keyword).toBe("pdrn");
    expect(keywordFits("CTO 구독 서비스가 뭐고 어디서 하는데?", "AX교육")).toBe(
      false
    );
    expect(keywordFits("AI 교육 받을 수 있는 곳 있어?", "AI교육")).toBe(true);
    expect(
      keywordFits("What's a good fractional CTO service?", "fractional cto")
    ).toBe(true);
  });
});

describe("question plan v2 refine — composition and metrics", () => {
  it("keeps A8 B4 C3 D2 E3 and the 7:3 market split", async () => {
    const out = await refineQuestionPlanV2(input(), fakeLlm());
    expect(out.plan.counts).toEqual({ A: 8, B: 4, C: 3, D: 2, E: 3 });
    expect(out.plan.markets).toEqual({ KR: 14, US: 6 });
    expect(out.plan.questions).toHaveLength(20);
    expect(out.plan.questions.filter((q) => q.kind === "brand")).toHaveLength(
      3
    );
    expect(out.metrics.shortfall).toBe(0);
    // E 는 「어떤 브랜드야?」가 먼저 남는다(넣은 순서 유지).
    expect(out.plan.questions.map((q) => q.text)).toContain(
      "프란츠는 어떤 브랜드야?"
    );
    // 출처: 키워드+검색량 또는 profile. LLM 문장은 origin=llm.
    for (const q of out.plan.questions.filter((x) => x.kind === "discovery")) {
      const p = q.provenance;
      expect(
        (p.keyword !== null && (p.volume ?? 0) > 0) ||
          p.source === "profile" ||
          p.source === "catalog" ||
          p.source === "site"
      ).toBe(true);
    }
    expect(out.plan.questions.some((q) => q.provenance.origin === "llm")).toBe(
      true
    );
  });

  it("records metrics (candidates, judge pass rate, dedupe, demand link, cost)", async () => {
    const llm = fakeLlm();
    const out = await refineQuestionPlanV2(input(), llm);
    const m = out.metrics;
    expect(llm.calls).toHaveLength(3); // 프로필·후보·심사 각 1회(브랜드당 배치)
    // 규칙 문장은 같은 키워드 id 로 다시 쓰라고 넘긴다.
    expect(llm.calls[1]?.prompt).toMatch(/^A\|KR\|k\d+\|.+추천해줘$/m);
    expect(m.profileSource).toBe("llm");
    expect(m.judge).toBe("llm");
    expect(m.candidatesGenerated).toBeGreaterThanOrEqual(40);
    expect(m.candidatesGenerated).toBeLessThanOrEqual(60);
    expect(m.deterministicRejected).toBeGreaterThanOrEqual(3);
    expect(m.judged).toBe(m.candidatesGenerated - m.deterministicRejected);
    expect(m.judgePassRate).toBeCloseTo((m.judgePassed / m.judged) * 100, 0);
    expect(m.dedupRemoved).toBeGreaterThanOrEqual(1);
    expect(m.llmCostKrw).toBe(4.5);
    const linked = out.plan.questions.filter(
      (q) => q.provenance.keyword && (q.provenance.volume ?? 0) > 0
    ).length;
    expect(m.demandLinkRate).toBeCloseTo((linked / 20) * 100, 1);
  });

  it("falls back to deterministic checks when the judge output is truncated", async () => {
    const out = await refineQuestionPlanV2(
      input(),
      fakeLlm({ judge: '{"results":[{"id":"c1","pass":true}]}' })
    );
    expect(out.metrics.judge).toBe("unavailable");
    expect(out.metrics.llmCalls.judge).toBe("invalid");
    expect(out.metrics.judgePassRate).toBeNull();
    expect(out.plan.questions.map((q) => q.text)).not.toContain(
      "프란츠 앰플 추천해줘"
    );
  });
});
