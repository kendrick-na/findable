import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type BrandProfile, buildBrandProfile } from "./brand-profile";
import {
  type CollectProfileInput,
  collectBrandProfile,
  type ProfileSourceDeps,
} from "./brand-profile-live";
import type { DemandKeyword } from "./demand-prompts";
import {
  classifyKeywordRelevance,
  profileTermsFromNames,
  relevanceContext,
} from "./keyword-relevance";
import {
  buildQuestionPlanV2,
  PLAN_V2_COMPOSITION,
  PLAN_V2_TOTAL,
  type QuestionPlanV2,
  splitByMarket,
} from "./question-plan-v2";
import { extractPageOfferings, servicePageUrls } from "./site-structure";

const naver = (keyword: string, volume: number): DemandKeyword => ({
  keyword,
  volume,
  source: "naver",
});
const google = (keyword: string, volume: number): DemandKeyword => ({
  keyword,
  volume,
  source: "google",
});

// ── 상품 사이트(프란츠와 비슷한 고정 입력) ─────────────────────────────
const FRANZ_NAMES = ["프란츠", "Franz", "FRANZ SKINCARE", "franzskincare"];
const FRANZ_CATALOG = [
  { name: "프란츠 줄기세포배양액 10% 앰플", price: 10_000 },
  { name: "프란츠 줄기세포배양액 10% 앰플 (4ea)", price: 40_000 },
  { name: "프란츠 줄기세포배양액 30% 앰플", price: 30_000 },
  { name: "EGF 인텐시브 볼륨 앰플", price: 33_000 },
  { name: "네이키드 선쉴드 펩타이드 패치 L 사이즈 (5매입)", price: 25_000 },
  { name: "네이키드 선쉴드 펩타이드 선크림 50ml (CJ스티커)", price: 33_000 },
];
const FRANZ_NAV = [
  { name: "PDRN", lang: "ko" as const, source: "site_nav" as const },
  { name: "줄기세포 앰플", lang: "ko" as const, source: "site_nav" as const },
];
const FRANZ_KR: DemandKeyword[] = [
  naver("PDRN", 32_760),
  naver("PDRN앰플", 18_570),
  naver("아누아PDRN앰플", 9000), // 등록 경쟁사 아님 — AI 답변에서 나온 다른 브랜드
  naver("프란츠앰플", 300),
  naver("줄기세포앰플", 1560),
  naver("펩타이드앰플", 1370),
  naver("PDRN앰플효과", 600),
  naver("PDRN앰플사용법", 150),
  naver("줄기세포배양액앰플", 170),
  naver("볼륨앰플", 220),
  naver("펩타이드선크림", 300),
  naver("PDRN주사", 12_000), // 다른 뜻(시술)
  naver("PDRN앰플비교", 90),
];
const FRANZ_US: DemandKeyword[] = [
  google("egf serum", 1900),
  google("best egf serum", 880),
  google("egf serum for microneedling", 110),
  google("medicube pdrn serum", 5400), // 영어 조각 = 다른 브랜드
  google("pdrn serum", 22_200),
  google("pdrn injection", 1900), // 다른 뜻
  google("franz ferdinand", 90_500), // 브랜드 표기
];

function franzProfile(): BrandProfile {
  return buildBrandProfile({
    catalog: FRANZ_CATALOG,
    siteOfferings: FRANZ_NAV,
    siteTextTerms: [],
    industry: "beauty",
  });
}

function franzPlan(): QuestionPlanV2 {
  return buildQuestionPlanV2({
    profile: franzProfile(),
    keywords: { KR: FRANZ_KR, US: FRANZ_US },
    markets: ["KR", "US"],
    brandNames: FRANZ_NAMES,
    displayNames: { ko: "프란츠", en: "Franz" },
    otherBrandNames: ["아누아", "PDRN 앰플"],
  });
}

// ── 서비스·B2B 사이트(노우버스와 비슷한 고정 입력) ─────────────────────
const KV_NAMES = ["노우버스", "KNOWVERSE", "knowverse"];
const KV_HOME = `<!doctype html><html><head>
<title>노우버스 | AI 전략 · CTO 구독 · 기술실사 · AI 교육</title>
<meta name="description" content="노우버스는 AI 기술실사, CTO 구독, AI 강의로 기업의 AI 전환을 지원합니다.">
</head><body>
<h1>노우버스 — AI 기술실사(TechDD), CTO 구독, AX/DX 컨설팅, AI 강의·교육</h1>
<h2>기술의 진짜 실력을,</h2>
<h3>서비스</h3><h3>온라인 교육</h3>
</body></html>`;
const KV_SERVICE_LIST = `<html><head><title>서비스 | 노우버스</title></head><body>
<h1>기업의 기술 의사결정과</h1>
<h3>AI 기술실사 (TechDD)</h3><h3>CTO 구독</h3><h3>AX / DX 컨설팅</h3><h3>AI 강의</h3>
</body></html>`;
const KV_SERVICE_DETAIL = `<html><head><title>CTO 구독 | 노우버스</title></head><body>
<h1>CTO 구독 (CTO-as-a-Service)</h1><h3>TechDD의 특징</h3><h3>주요 대상</h3><h3>25년 이상 IT 경험</h3>
</body></html>`;
const KV_SITEMAP = `<urlset>
<url><loc>https://www.knowverse.net/</loc></url>
<url><loc>https://www.knowverse.net/service.html</loc></url>
<url><loc>https://www.knowverse.net/service-cto.html</loc></url>
<url><loc>https://www.knowverse.net/service-cto-apply-basic.html</loc></url>
<url><loc>https://www.knowverse.net/en/service.html</loc></url>
<url><loc>https://other.example.com/service.html</loc></url>
</urlset>`;
const KV_KR: DemandKeyword[] = [
  naver("AI교육", 7460),
  naver("AI컨설팅", 2900),
  naver("AI도입컨설팅", 880),
  naver("국비지원교육", 16_440), // head 만 + 조각 — 서비스 업종은 받지 않는다
  naver("직무교육", 1740),
  naver("부동산컨설팅", 5000),
  naver("AI강의", 2140),
  naver("CTO구독", 40),
  naver("AI교육비용", 320),
  naver("AI컨설팅비용", 210),
  naver("AI자격증", 8050), // 다른 뜻
  naver("노우버스", 90), // 브랜드 단독
];

function kvOfferings() {
  return [
    ...extractPageOfferings({
      html: KV_HOME,
      url: "https://www.knowverse.net/",
      kind: "home",
      lang: "ko",
      brandNames: KV_NAMES,
    }),
    ...extractPageOfferings({
      html: KV_SERVICE_LIST,
      url: "https://www.knowverse.net/service.html",
      kind: "service",
      lang: "ko",
      listPage: true,
      brandNames: KV_NAMES,
    }),
    ...extractPageOfferings({
      html: KV_SERVICE_DETAIL,
      url: "https://www.knowverse.net/service-cto.html",
      kind: "service",
      lang: "ko",
      brandNames: KV_NAMES,
    }),
  ];
}

function kvPlan(): QuestionPlanV2 {
  return buildQuestionPlanV2({
    profile: buildBrandProfile({
      catalog: [],
      siteOfferings: kvOfferings(),
      siteTextTerms: [],
      industry: "b2b_saas",
    }),
    keywords: { KR: KV_KR },
    markets: ["KR"],
    brandNames: KV_NAMES,
    displayNames: { ko: "노우버스", en: "KNOWVERSE" },
  });
}

const KO_CASUAL_END_RE = /(줘|\?)$/;
const KO_POLITE_END_RE = /(요|니다|세요)[?.!]?$/;
const HANGUL_RE = /[가-힣]/;

describe("brand profile — commerce site (Franz-like)", () => {
  it("uses the catalog first and only menu categories from the site", () => {
    const profile = buildBrandProfile({
      catalog: FRANZ_CATALOG,
      siteOfferings: [
        ...FRANZ_NAV,
        { name: "서비스 정보", lang: "ko", source: "site_heading" },
      ],
      siteTextTerms: [],
      industry: "beauty",
    });
    expect(profile.level).toBe("site");
    expect(profile.businessType).toBe("commerce");
    expect(profile.sources).toEqual(["catalog", "site_nav"]);
    expect(profile.offerings.map((o) => o.name)).not.toContain("서비스 정보");
  });

  it("keeps only identity provenance (customer > footer), never the values", () => {
    const profile = buildBrandProfile({
      catalog: FRANZ_CATALOG,
      siteOfferings: [],
      siteTextTerms: [],
      customerIdentity: { legalName: "바이오센서연구소(주)" },
      footerIdentity: { legalName: "x", businessNumber: "123-45-67890" },
    });
    expect(profile.identity).toEqual({
      legalName: "customer",
      businessNumber: "footer",
    });
    expect(JSON.stringify(profile)).not.toContain("123-45-67890");
  });
});

describe("brand profile — B2B service site (Knowverse-like)", () => {
  it("reads service names from title, h1, the service list page and detail h1 (no h2 slogans, no detail h3 sections)", () => {
    const names = kvOfferings().map((o) => o.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "AI 전략",
        "CTO 구독",
        "기술실사",
        "AI 교육",
        "AI 기술실사(TechDD)",
        "AX/DX 컨설팅",
        "AI 강의",
        "AI 기술실사 (TechDD)",
        "CTO 구독 (CTO-as-a-Service)",
      ])
    );
    for (const junk of [
      "기술의 진짜 실력을,",
      "서비스",
      "TechDD의 특징",
      "주요 대상",
      "25년 이상 IT 경험",
    ]) {
      expect(names).not.toContain(junk);
    }
  });

  it("picks service pages from the sitemap (same host, no apply/checkout pages)", () => {
    expect(servicePageUrls(KV_SITEMAP, "knowverse.net")).toEqual({
      ko: [
        "https://www.knowverse.net/service.html",
        "https://www.knowverse.net/service-cto.html",
      ],
      en: ["https://www.knowverse.net/en/service.html"],
    });
  });

  it("is a service profile even without any catalog", () => {
    const profile = buildBrandProfile({
      catalog: [],
      siteOfferings: kvOfferings(),
      siteTextTerms: [],
      industry: "b2b_saas",
    });
    expect(profile.businessType).toBe("service");
    expect(profile.level).toBe("site");
  });
});

describe("keyword relevance — profile terms, not a cosmetics dictionary", () => {
  const ctx = relevanceContext(
    profileTermsFromNames(["AI 컨설팅", "CTO 구독", "AI 교육"], ["노우버스"]),
    ["노우버스"],
    ["경쟁사랩"],
    { allowHeadOnly: false }
  );
  it("needs the brand's own head + a profile word for service brands", () => {
    expect(classifyKeywordRelevance("AI컨설팅", ctx)).toMatchObject({
      ok: true,
      core: "AI 컨설팅",
    });
    expect(classifyKeywordRelevance("부동산컨설팅", ctx)).toEqual({
      ok: false,
      reason: "unmatched",
    });
    expect(classifyKeywordRelevance("AI", ctx)).toEqual({
      ok: false,
      reason: "unmatched",
    });
  });
  it("drops own brand, other brands and other senses", () => {
    expect(classifyKeywordRelevance("노우버스AI교육", ctx)).toEqual({
      ok: false,
      reason: "brand",
    });
    expect(classifyKeywordRelevance("경쟁사랩AI교육", ctx)).toEqual({
      ok: false,
      reason: "otherBrand",
    });
    expect(classifyKeywordRelevance("AI교육자격증", ctx)).toEqual({
      ok: false,
      reason: "unrelated",
    });
  });

  it("source files carry no K-beauty ingredient dictionary", () => {
    for (const file of [
      "keyword-relevance.ts",
      "brand-profile.ts",
      "question-plan-v2.ts",
      "demand-prompts.ts",
    ]) {
      const src = readFileSync(join(import.meta.dirname, file), "utf8");
      for (const word of [
        "히알루론산",
        "나이아신아마이드",
        "세라마이드",
        "레티놀",
        "INGREDIENT_CONCEPTS",
        "TYPE_CONCEPTS",
      ]) {
        expect(`${file}:${src.includes(word)}`).toBe(`${file}:false`);
      }
    }
  });
});

describe("question plan v2 — composition and tone", () => {
  it("splits each type 7 : 3 between Korea and overseas", () => {
    expect(splitByMarket(8, ["KR", "US"])).toEqual({ KR: 6, US: 2 });
    expect(splitByMarket(3, ["KR", "US"])).toEqual({ KR: 2, US: 1 });
    expect(splitByMarket(2, ["KR", "US"])).toEqual({ KR: 1, US: 1 });
    expect(splitByMarket(8, ["KR"])).toEqual({ KR: 8, US: 0 });
    expect(Object.values(PLAN_V2_COMPOSITION).reduce((a, b) => a + b, 0)).toBe(
      PLAN_V2_TOTAL
    );
  });

  it("Franz-like commerce brand: 20 questions = A8 B4 C3 D2 E3, provenance on every name-less question", () => {
    const plan = franzPlan();
    expect(plan.questionPlanVersion).toBe(2);
    expect(plan.questions).toHaveLength(20);
    expect(plan.counts).toEqual({ A: 8, B: 4, C: 3, D: 2, E: 3 });
    expect(plan.nameLessCount).toBe(17);
    expect(plan.markets.KR + plan.markets.US).toBe(20);
    expect(plan.markets.KR).toBeGreaterThan(plan.markets.US);
    for (const q of plan.questions.filter((x) => x.kind === "discovery")) {
      expect(q.text).not.toMatch(/프란츠|franz/i);
      if (q.type !== "C") {
        expect(q.provenance.keyword).toEqual(expect.any(String));
        expect(q.provenance.volume).toEqual(expect.any(Number));
      }
    }
    for (const q of plan.questions.filter((x) => x.type === "E")) {
      expect(q.kind).toBe("brand");
      expect(q.text).toMatch(/프란츠|Franz/);
    }
    const first = plan.questions[0];
    expect(first).toMatchObject({
      type: "A",
      market: "KR",
      text: "PDRN 앰플 추천해줘",
      provenance: { keyword: "PDRN앰플", volume: 18_570, source: "naver" },
    });
  });

  it("excludes own-brand, other-brand and other-sense keywords", () => {
    const keywords = franzPlan().questions.map((q) => q.provenance.keyword);
    for (const banned of [
      "프란츠앰플",
      "아누아PDRN앰플",
      "PDRN주사",
      "medicube pdrn serum",
      "pdrn injection",
      "franz ferdinand",
      "PDRN",
    ]) {
      expect(keywords).not.toContain(banned);
    }
    // 「PDRN 앰플」(AI 답변에서 잘못 뽑힌 일반 명사)은 브랜드 목록에 있어도 카테고리를 지우지 않는다.
    expect(keywords).toContain("PDRN앰플");
  });

  it("uses natural casual Korean (반말) and casual English", () => {
    for (const q of franzPlan().questions) {
      if (q.lang === "ko") {
        expect(q.text).toMatch(KO_CASUAL_END_RE);
        expect(q.text).not.toMatch(KO_POLITE_END_RE);
      } else {
        expect(q.text).not.toMatch(HANGUL_RE);
        expect(q.text).toMatch(/\?$/);
      }
    }
  });

  it("describes the flagship product by features, without line names", () => {
    const c = franzPlan().questions.filter((q) => q.type === "C");
    expect(c.length).toBeGreaterThan(0);
    for (const q of c) {
      expect(q.text).not.toMatch(/네이키드|선쉴드|인텐시브/);
    }
    expect(c[0]?.text).toBe(
      "줄기세포배양액 10% 앰플 찾고 있는데 괜찮은 제품 있어?"
    );
  });

  it("Knowverse-like B2B brand: non-zero name-less questions from service names alone", () => {
    const plan = kvPlan();
    expect(plan.nameLessCount).toBeGreaterThan(0);
    expect(plan.questions).toHaveLength(20);
    const texts = plan.questions.map((q) => q.text);
    expect(texts).toContain("AI 교육 추천해줘");
    expect(texts).toEqual(
      expect.arrayContaining(["AI 컨설팅 비용 보통 얼마야?"])
    );
    const keywords = plan.questions.map((q) => q.provenance.keyword);
    for (const banned of [
      "국비지원교육",
      "직무교육",
      "부동산컨설팅",
      "AI자격증",
      "노우버스",
    ]) {
      expect(keywords).not.toContain(banned);
    }
    // 서비스 말투(업체·서비스)
    expect(plan.questions.find((q) => q.type === "C")?.text).toMatch(
      /서비스 하는 곳 있어\?/
    );
    expect(plan.questions.filter((q) => q.type === "E")[0]?.text).toBe(
      "노우버스는 어떤 회사야?"
    );
  });

  it("registered competitors become D (alternatives) questions without our name", () => {
    const plan = buildQuestionPlanV2({
      profile: franzProfile(),
      keywords: { KR: FRANZ_KR },
      markets: ["KR"],
      brandNames: FRANZ_NAMES,
      displayNames: { ko: "프란츠", en: "Franz" },
      competitors: ["메디큐브", "프란츠"],
    });
    const d = plan.questions.filter((q) => q.type === "D");
    expect(d[0]).toMatchObject({
      text: "메디큐브 말고 비슷한 PDRN 앰플 뭐 있어?",
      provenance: { competitor: "메디큐브", keyword: "PDRN앰플" },
    });
    expect(d.map((q) => q.text).join(" ")).not.toContain("프란츠");
  });
});

describe("question plan v2 — fallbacks when the site cannot be read", () => {
  it("site unreadable → registered industry seeds (level customer_industry)", () => {
    const profile = buildBrandProfile({
      catalog: [],
      siteOfferings: [],
      siteTextTerms: ["의미 없는 조각"],
      industry: "education",
      customerProducts: ["AI 교육"],
    });
    expect(profile.level).toBe("customer_industry");
    expect(profile.sources).toEqual(["customer", "industry"]);
    const plan = buildQuestionPlanV2({
      profile,
      keywords: { KR: KV_KR },
      markets: ["KR"],
      brandNames: KV_NAMES,
      displayNames: { ko: "노우버스", en: "KNOWVERSE" },
    });
    expect(plan.nameLessCount).toBeGreaterThan(0);
  });

  it("nothing at all → 0 name-less questions, says so, still asks the 3 brand questions", () => {
    const profile = buildBrandProfile({
      catalog: [],
      siteOfferings: [],
      siteTextTerms: [],
      industry: "other",
    });
    expect(profile.level).toBe("none");
    const plan = buildQuestionPlanV2({
      profile,
      keywords: { KR: KV_KR },
      markets: ["KR"],
      brandNames: KV_NAMES,
      displayNames: { ko: "노우버스", en: "KNOWVERSE" },
    });
    expect(plan.nameLessCount).toBe(0);
    expect(plan.note).toBe("no_profile");
    expect(plan.counts.E).toBe(3);
  });
});

describe("brand profile collection — live orchestration with fake sources", () => {
  const deps = (over: Partial<ProfileSourceDeps> = {}): ProfileSourceDeps => ({
    catalog: async () => ({ source: "none", products: [] }),
    siteStructure: async () => ({
      source: "site",
      offerings: kvOfferings(),
      pagesRead: 3,
    }),
    naverVolumes: async () => KV_KR,
    googleIdeas: async () => null,
    ...over,
  });
  const input: CollectProfileInput = {
    domain: "knowverse.net",
    brandNames: { ko: "노우버스", en: "KNOWVERSE", variants: ["knowverse"] },
    industry: "b2b_saas",
    markets: ["KR"],
  };

  it("collects a service profile and seeds from service names (no Naver 지식iN)", async () => {
    const out = await collectBrandProfile(input, deps());
    expect(out.profile.businessType).toBe("service");
    expect(out.seeds.KR).toEqual(
      expect.arrayContaining(["AI전략", "CTO구독", "AI교육"])
    );
    expect(out.seeds.KR.at(-1)).toBe("노우버스");
    // ⛔ 지식iN 은 네이버 Open API 약관(AI 입력·검색 표시 외 용도 금지)으로 끔(2026-10-07).
    expect(Object.keys(deps())).not.toContain("kinTitles");
    expect(out).not.toHaveProperty("kinStyle");
  });

  it("does not call keyword APIs when there is no profile", async () => {
    let called = false;
    const out = await collectBrandProfile(
      { ...input, industry: "other" },
      deps({
        siteStructure: async () => ({
          source: "none",
          offerings: [],
          pagesRead: 0,
        }),
        naverVolumes: () => {
          called = true;
          return Promise.resolve(KV_KR);
        },
      })
    );
    expect(out.profile.level).toBe("none");
    expect(called).toBe(false);
  });

  it("fails open when a source throws", async () => {
    const out = await collectBrandProfile(
      input,
      deps({
        catalog: () => Promise.reject(new Error("network")),
        naverVolumes: () => Promise.reject(new Error("429")),
      })
    );
    expect(out.profile.level).toBe("site");
    expect(out.keywords.KR).toBeNull();
  });
});
