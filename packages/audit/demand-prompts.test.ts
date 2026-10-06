import { describe, expect, it } from "vitest";
import {
  catalogVocabulary,
  type DemandKeyword,
  demandMarketsFor,
  demandSeedKeywords,
  generateDemandQuestions,
  isDemandPromptsEnabled,
  selectDemandRunQuestions,
  styleFromAnchors,
} from "./demand-prompts";
import { resolveDemandQuestionSet } from "./demand-prompts-live";
import { resolveDemandDiscovery } from "./demand-run-prompts";
import { googleAdsCredentials, parseKeywordIdeas } from "./google-keywords";

// 프란츠(franzskincare.com)와 비슷한 고정 입력 — 2026-10-05 실측 검색량 일부를 그대로 쓴다.
const BRAND_NAMES = ["프란츠", "Franz", "FRANZ SKINCARE", "franzskincare"];
const PRODUCTS = [
  { name: "프란츠 PDRN 앰플 30ml" },
  { name: "[FRANZ] 줄기세포배양액 앰플 50ml" },
  { name: "프란츠 투명 썬패치 NEW" },
  { name: "프란츠 PDRN 마스크팩 5매 SET" },
];
const naver = (keyword: string, volume: number, lowVolume = false) =>
  ({ keyword, volume, lowVolume, source: "naver" }) as DemandKeyword;
const google = (keyword: string, volume: number) =>
  ({ keyword, volume, source: "google" }) as DemandKeyword;

const KR: DemandKeyword[] = [
  naver("PDRN", 32_760), // 성분 단독(의료·연구 검색 섞임) → 제외
  naver("히알루론산앰플", 21_080), // 이 브랜드 제품에 없는 성분 → 제외
  naver("PDRN앰플", 19_330),
  naver("아누아세럼", 16_550), // 다른 브랜드 → 사전에 없는 낱말 → 제외
  naver("매스틱화장품", 15_320),
  naver("PDRN효과", 14_950), // 제형 없는 성분+의도(시술·영양제 검색 섞임) → 제외
  naver("PDRN앰플효과", 600),
  naver("쇼핑몰", 13_250),
  naver("줄기세포주사", 10_660), // 시술 → 제외
  naver("메디큐브PDRN", 8000), // 등록 경쟁사 → 제외
  naver("앰플", 5000), // 제형 단독 → 제외
  naver("프란츠", 4340), // 브랜드 단독 → 제외(참고값)
  naver("주름앰플", 2000),
  naver("줄기세포앰플", 1510),
  naver("PDRN앰플추천", 900),
  naver("PDRN앰플가격", 400),
  naver("프란츠앰플", 300), // 브랜드+제품 → 제외
  naver("PDRN앰플사용법", 150),
  naver("PDRN패치", 5, true), // 「< 10」 근사값 → 제외
];
const US: DemandKeyword[] = [
  google("korean skincare", 90_500),
  google("franz ferdinand", 90_500), // 브랜드 표기 포함(동명 밴드) → 제외
  google("pdrn", 40_500), // 성분 단독 → 제외
  google("pdrn serum", 22_200),
  google("franz", 8100),
  google("medicube pdrn serum", 5400),
  google("best pdrn serum", 2900),
  google("stem cell serum", 2400),
  google("pdrn serum benefits", 1300),
  google("the ordinary pdrn serum", 1000),
  google("pdrn serum for wrinkles", 320),
];

function franzSet(anchors: string[] | null = null) {
  return generateDemandQuestions({
    brandNames: BRAND_NAMES,
    otherBrandNames: ["메디큐브"],
    products: PRODUCTS,
    keywords: { KR, US },
    styleAnchors: { KR: anchors },
  });
}

describe("demand prompts — catalog vocabulary & seeds", () => {
  it("reads ingredients/types from product names, ignoring brand and promo words", () => {
    const v = catalogVocabulary(PRODUCTS, BRAND_NAMES);
    expect(v.ingredients.map((c) => c.id)).toEqual(["acr:PDRN", "stemcell"]);
    expect(v.types.map((c) => c.id).sort()).toEqual([
      "ampoule",
      "patch",
      "sheetmask",
    ]);
    const seeds = demandSeedKeywords(v, { ko: "프란츠", en: "Franz" });
    expect(seeds.KR.slice(0, 3)).toEqual([
      "PDRN앰플",
      "PDRN마스크팩",
      "줄기세포앰플",
    ]);
    expect(seeds.KR.at(-1)).toBe("프란츠");
    expect(seeds.US).toContain("pdrn serum");
    expect(seeds.US).toContain("stem cell ampoule");
    expect(seeds.US.at(-1)).toBe("franz");
  });

  it("returns nothing when the catalog has no known ingredient or type", () => {
    const set = generateDemandQuestions({
      brandNames: ["노우버스"],
      products: [{ name: "AI 전략 구독" }],
      keywords: { KR: [naver("AI컨설팅", 5000)] },
    });
    expect(set.questions.KR).toEqual([]);
  });
});

describe("demand prompts — Franz fixture (KR)", () => {
  const set = franzSet();

  it("keeps only category keywords: no brand, other brand, unsold ingredient, procedure or bare type", () => {
    const keywords = set.questions.KR.map((q) => q.keyword);
    for (const banned of [
      "PDRN",
      "PDRN효과",
      "프란츠",
      "프란츠앰플",
      "아누아세럼",
      "메디큐브PDRN",
      "히알루론산앰플",
      "줄기세포주사",
      "쇼핑몰",
      "앰플",
      "PDRN패치",
    ]) {
      expect(keywords).not.toContain(banned);
    }
    expect(set.excluded.KR).toEqual({
      brand: 2,
      otherBrand: 1,
      lowVolume: 1,
      unmatched: 8,
    });
    expect(set.brandVolume.KR?.keyword).toBe("프란츠");
    expect(set.brandVolume.KR?.volume).toBe(4340);
  });

  it("turns them into natural Korean questions with keyword + volume provenance", () => {
    expect(
      set.questions.KR.map((q) => [q.text, q.topic, q.keyword, q.volume])
    ).toEqual([
      ["PDRN 앰플 추천해줘", "제품 추천", "PDRN앰플", 19_330],
      ["주름 관리에 좋은 앰플 추천해줘", "피부고민", "주름앰플", 2000],
      ["PDRN 앰플 효과 진짜 있어?", "효능·성분", "PDRN앰플효과", 600],
      ["가성비 좋은 PDRN 앰플 추천해줘", "가격·가성비", "PDRN앰플가격", 400],
      [
        "PDRN 앰플 바르는 순서랑 사용법 알려줘",
        "사용법",
        "PDRN앰플사용법",
        150,
      ],
      ["줄기세포 앰플 추천해줘", "제품 추천", "줄기세포앰플", 1510],
    ]);
    for (const q of set.questions.KR) {
      expect(q.lang).toBe("ko");
      expect(q.source).toBe("naver");
      expect(q.expanded).toBe(false);
      expect(q.text).not.toMatch(/프란츠|franz/i);
    }
  });

  it("is deterministic", () => {
    expect(franzSet()).toEqual(set);
  });

  it("follows 지식iN polite style when most anchor titles are polite", () => {
    expect(
      styleFromAnchors([
        "PDRN앰플 주름 관리에 괜찮을까요?",
        "PDRN 앰플 추천해주세요",
        "앰플 뭐 쓰세요?",
        "이거 써도 돼?",
      ])
    ).toBe("polite");
    expect(styleFromAnchors(null)).toBe("casual");
    const polite = franzSet(["PDRN 앰플 추천해주세요", "효과 있나요?"]);
    expect(polite.questions.KR.map((q) => q.text)).toContain(
      "PDRN 앰플 추천해 주세요"
    );
    expect(polite.questions.KR.map((q) => q.text)).toContain(
      "주름 관리에 좋은 앰플 있을까요?"
    );
  });
});

describe("demand prompts — Franz fixture (US)", () => {
  const set = franzSet();

  it("drops brand noise (franz / franz ferdinand) and other brands, keeps pdrn serum", () => {
    const keywords = set.questions.US.map((q) => q.keyword);
    expect(keywords).not.toContain("franz");
    expect(keywords).not.toContain("pdrn");
    expect(keywords).not.toContain("franz ferdinand");
    expect(keywords).not.toContain("korean skincare");
    expect(keywords).not.toContain("medicube pdrn serum");
    expect(keywords).not.toContain("the ordinary pdrn serum");
    expect(set.brandVolume.US?.keyword).toBe("franz");
  });

  it("writes natural English questions; expansion is marked", () => {
    expect(
      set.questions.US.map((q) => [q.text, q.keyword, q.volume, q.expanded])
    ).toEqual([
      ["What's the best PDRN serum?", "pdrn serum", 22_200, false],
      [
        "Does PDRN serum actually work for skin?",
        "pdrn serum benefits",
        1300,
        false,
      ],
      [
        "What's the best PDRN serum for wrinkles?",
        "pdrn serum for wrinkles",
        320,
        false,
      ],
      ["What's the best stem cell serum?", "stem cell serum", 2400, false],
      ["What's a good affordable PDRN serum?", "pdrn serum", 22_200, true],
      [
        "How should I use PDRN serum in my skincare routine?",
        "pdrn serum",
        22_200,
        true,
      ],
    ]);
  });

  it("normalizes word order / repeated forms and ignores bracketed packaging notes", () => {
    const set2 = generateDemandQuestions({
      brandNames: BRAND_NAMES,
      products: [
        { name: "줄기세포배양액 앰플 (CJ스티커)" },
        { name: "EGF 앰플 [1+1]" },
      ],
      keywords: {
        US: [
          google("stem cell serum", 880),
          google("serum stem cell", 880),
          google("egf ampoule serum", 70),
          google("egf serum", 1900),
          google("cj serum", 5000),
        ],
      },
    });
    expect(
      set2.questions.US.map((q) => [q.text, q.keyword, q.expanded])
    ).toEqual([
      ["What's the best EGF serum?", "egf serum", false],
      // 「serum stem cell」과 「stem cell serum」은 한 질문(동률이면 키워드 사전순)
      ["What's the best stem cell serum?", "serum stem cell", false],
      // 질문이 6개 미만이면 검색량 1위 핵심어를 빠진 주제로 넓힌다(expanded)
      ["Does EGF serum actually work for skin?", "egf serum", true],
      ["What's a good affordable EGF serum?", "egf serum", true],
      ["How should I use EGF serum in my skincare routine?", "egf serum", true],
      ["Does stem cell serum actually work for skin?", "serum stem cell", true],
    ]);
    expect(set2.questions.US.map((q) => q.keyword)).not.toContain("cj serum");
    expect(set2.questions.US.filter((q) => !q.expanded)).toHaveLength(2);
  });

  it("caps per market", () => {
    const capped = generateDemandQuestions({
      brandNames: BRAND_NAMES,
      products: PRODUCTS,
      keywords: { KR },
      maxPerMarket: 3,
    });
    expect(capped.questions.KR).toHaveLength(3);
    expect(capped.questions.US).toEqual([]);
  });
});

describe("demand prompts — run selection & flag", () => {
  it("maps language × market scope to markets", () => {
    expect(demandMarketsFor("both", "both")).toEqual(["KR", "US"]);
    expect(demandMarketsFor("both", "korea")).toEqual(["KR"]);
    expect(demandMarketsFor("ko", "global")).toEqual([]);
    expect(demandMarketsFor("en", "both")).toEqual(["US"]);
  });

  it("alternates markets by volume rank within the discovery slot", () => {
    const picked = selectDemandRunQuestions(franzSet(), ["KR", "US"], 2);
    expect(picked.map((q) => q.text)).toEqual([
      "PDRN 앰플 추천해줘",
      "What's the best PDRN serum?",
    ]);
  });

  it("is off unless MEASUREMENT_DEMAND_PROMPTS=true", () => {
    expect(isDemandPromptsEnabled({})).toBe(false);
    expect(isDemandPromptsEnabled({ MEASUREMENT_DEMAND_PROMPTS: "1" })).toBe(
      false
    );
    expect(isDemandPromptsEnabled({ MEASUREMENT_DEMAND_PROMPTS: "true" })).toBe(
      true
    );
  });
});

describe("demand prompts — live orchestration with fake sources", () => {
  const deps = {
    catalog: async () => ({
      source: "sitemap" as const,
      products: PRODUCTS.map((p) => ({
        ...p,
        price: null,
        currency: null,
        url: "https://example.com/p",
      })),
    }),
    naverVolumes: async () => KR,
    googleIdeas: async () => US,
    kinTitles: async () => null,
  };

  it("collects sources only for requested markets", async () => {
    const calls: string[] = [];
    const out = await resolveDemandQuestionSet(
      {
        domain: "franzskincare.com",
        brandNames: { ko: "프란츠", en: "Franz", variants: ["FRANZ SKINCARE"] },
        markets: ["KR"],
      },
      {
        ...deps,
        naverVolumes: (seeds) => {
          calls.push(`naver:${seeds.length}`);
          return Promise.resolve(KR);
        },
        googleIdeas: () => {
          calls.push("google");
          return Promise.resolve(US);
        },
      }
    );
    expect(calls).toEqual(["naver:6"]);
    expect(out.set.questions.KR.length).toBeGreaterThan(0);
    expect(out.set.questions.US).toEqual([]);
  });

  it("fills the discovery slot, tags provenance, and tops up with site questions", async () => {
    const result = await resolveDemandDiscovery({
      domain: "franzskincare.com",
      brandNames: { ko: "프란츠", en: "Franz" },
      fallback: [
        {
          kind: "discovery",
          lang: "ko",
          text: "스킨케어 서비스를 하는 곳 추천해줘",
        },
      ],
      language: "ko",
      limit: 2,
      scope: "korea",
      resolve: (input) => resolveDemandQuestionSet(input, deps),
    });
    expect(result?.prompts).toEqual([
      {
        kind: "discovery",
        lang: "ko",
        text: "PDRN 앰플 추천해줘",
        demand: {
          market: "KR",
          topic: "제품 추천",
          keyword: "PDRN앰플",
          volume: 19_330,
          source: "naver",
          expanded: false,
        },
      },
      expect.objectContaining({ text: "주름 관리에 좋은 앰플 추천해줘" }),
    ]);
    // 수요 기반 질문이 자리보다 적으면 기존 사이트 기반 질문으로 채운다
    const topped = await resolveDemandDiscovery({
      domain: "franzskincare.com",
      brandNames: { ko: "프란츠", en: "Franz" },
      fallback: [
        {
          kind: "discovery",
          lang: "ko",
          text: "스킨케어 서비스를 하는 곳 추천해줘",
        },
      ],
      language: "ko",
      limit: 2,
      scope: "korea",
      resolve: async (input) => {
        const out = await resolveDemandQuestionSet(input, deps);
        out.set.questions.KR = out.set.questions.KR.slice(0, 1);
        return out;
      },
    });
    expect(topped?.prompts.map((p) => p.text)).toEqual([
      "PDRN 앰플 추천해줘",
      "스킨케어 서비스를 하는 곳 추천해줘",
    ]);
  });

  it("returns null (runner keeps old path) when sources fail or yield nothing", async () => {
    const empty = await resolveDemandDiscovery({
      domain: "x.com",
      brandNames: { ko: "엑스" },
      fallback: [],
      language: "both",
      limit: 2,
      scope: "both",
      resolve: () => Promise.reject(new Error("network")),
    });
    expect(empty).toBeNull();
    const none = await resolveDemandDiscovery({
      domain: "x.com",
      brandNames: { ko: "엑스" },
      fallback: [],
      language: "both",
      limit: 2,
      scope: "both",
      resolve: (input) =>
        resolveDemandQuestionSet(input, {
          ...deps,
          catalog: async () => ({ source: "none", products: [] }),
        }),
    });
    expect(none).toBeNull();
  });
});

describe("google keyword planner — parsing & credentials", () => {
  it("parses avgMonthlySearches strings", () => {
    expect(
      parseKeywordIdeas({
        results: [
          {
            text: "pdrn serum",
            keywordIdeaMetrics: {
              avgMonthlySearches: "22200",
              competition: "HIGH",
            },
          },
          { text: "no metrics" },
          { nope: true },
        ],
      })
    ).toEqual([
      { keyword: "pdrn serum", volume: 22_200, competition: "HIGH" },
      { keyword: "no metrics", volume: 0, competition: null },
    ]);
    expect(parseKeywordIdeas(null)).toEqual([]);
  });

  it("uses the login (manager) customer by default and strips dashes", () => {
    const creds = googleAdsCredentials({
      GOOGLE_ADS_CLIENT_ID: "id",
      GOOGLE_ADS_CLIENT_SECRET: "secret",
      GOOGLE_ADS_REFRESH_TOKEN: "refresh",
      GOOGLE_ADS_CUSTOMER_ID: "575-000-0000",
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: "890-694-9148",
    });
    expect(creds?.customerId).toBe("8906949148");
    expect(creds?.loginCustomerId).toBe("8906949148");
    expect(creds?.developerToken).toBeNull();
    expect(googleAdsCredentials({})).toBeNull();
  });
});
