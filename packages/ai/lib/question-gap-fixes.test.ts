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

import { staticFallback, suggestTrackingPrompts } from "./prompt-suggestions";
import {
  defaultConsumerQuestions,
  defaultConsumerQuestionsFromPhrase,
  fixedAlternativeQuestions,
  fixedBrandQuestions,
  INDUSTRY_QUESTION_LABEL,
} from "./question-plan";

const item = (text: string, language: "ko" | "en" = "ko") => ({
  language,
  text,
});
const llm = (over: Record<string, unknown> = {}) => ({
  object: {
    category: Array.from({ length: 11 }, (_, i) =>
      item(`보습 크림 ${i} 추천해줘`)
    ),
    concern: Array.from({ length: 6 }, (_, i) =>
      item(`피부 고민 ${i} 어떤 제품이 좋아?`)
    ),
    representative: [
      { ...item("시카 크림 뭐가 좋아?"), basis: "site" },
      { ...item("비타민 앰플 추천해줘"), basis: "site" },
    ],
    alternative: [],
    brandUnderstanding: [
      item("프란츠 후기 어때?"),
      item("프란츠 어디서 사?"),
      item("프란츠 장단점 알려줘"),
    ],
    categoryPhrase: "",
    confident: true,
    ...over,
  },
});
const base = {
  brandName: "프란츠",
  domain: "franzskincare.com",
  marketScope: "korea" as const,
  site: {
    description: "민감성 피부를 위한 시카 크림 비타민 앰플 신생아 보습",
    h1: null,
    siteName: "프란츠",
    title: "프란츠 | 스킨케어",
  },
};

const TEN_INDUSTRIES = Object.keys(INDUSTRY_QUESTION_LABEL);
const FLAGS = [
  "QUESTION_OTHER_FALLBACK_ENABLED",
  "QUESTION_BRAND_GUARANTEE_ENABLED",
  "QUESTION_SOFT_CONFIDENCE_ENABLED",
] as const;
const EXTRA_FLAGS = [
  "QUESTION_BRAND_VARIANT_ENABLED",
  "QUESTION_GENERATION_LOG_ENABLED",
] as const;
const flagsOn = (...only: (typeof FLAGS)[number][]) => {
  for (const f of only.length > 0 ? only : FLAGS) {
    vi.stubEnv(f, "true");
  }
};

beforeEach(() => {
  h.generateObject.mockReset();
  for (const f of [...FLAGS, ...EXTRA_FLAGS]) {
    vi.stubEnv(f, "");
  }
});
afterEach(() => vi.unstubAllEnvs());

describe("회귀 — 업종 10개 경로의 출력은 플래그를 켜도 바이트 단위로 같다", () => {
  it("업종 기본 질문·고정 대안 질문·폴백은 업종마다 켜기 전과 같다", () => {
    expect(TEN_INDUSTRIES).toHaveLength(10);
    const snapshot = () =>
      JSON.stringify(
        TEN_INDUSTRIES.map((industry) => ({
          alt: fixedAlternativeQuestions(
            industry,
            "both",
            "신생아용 보습 스킨케어"
          ),
          altPhraseOnly: fixedAlternativeQuestions(
            industry,
            "both",
            "신생아용 보습 스킨케어",
            {
              phraseOnly: true,
            }
          ),
          defaults: defaultConsumerQuestions({
            englishName: "Franz",
            industry,
            koreanName: "프란츠",
            language: "both",
          }),
          fallbackKo: staticFallback({ ...base, industry }),
          fallbackKoPhrase: staticFallback(
            { ...base, industry },
            "신생아용 보습 스킨케어"
          ),
          fallbackEn: staticFallback({
            ...base,
            industry,
            marketScope: "global",
          }),
        }))
      );
    const off = snapshot();
    flagsOn();
    expect(snapshot()).toBe(off);
    // phraseOnly 는 업종이 있으면 의미가 없다 — 옵션 유무와 무관하게 같은 결과
    for (const industry of TEN_INDUSTRIES) {
      expect(
        fixedAlternativeQuestions(industry, "korea", "신생아용 보습 스킨케어", {
          phraseOnly: true,
        })
      ).toEqual(
        fixedAlternativeQuestions(industry, "korea", "신생아용 보습 스킨케어")
      );
    }
  });

  it("생성기가 정상(이름 질문 포함)이면 업종 10개 모두 플래그 켜기 전후 제안이 같다", async () => {
    const run = async () => {
      const out: unknown[] = [];
      for (const industry of TEN_INDUSTRIES) {
        h.generateObject.mockResolvedValue(
          llm({ categoryPhrase: "민감성 피부 보습 크림" })
        );
        out.push(await suggestTrackingPrompts({ ...base, industry }));
      }
      return JSON.stringify(out);
    };
    const off = await run();
    flagsOn();
    expect(await run()).toBe(off);
  });
});

describe("③ 업종 '기타'도 사이트 근거 분야 이름으로 질문을 만든다", () => {
  const otherInput = { ...base, industry: "other" };
  const unsure = () =>
    llm({ categoryPhrase: "민감성 피부 보습 크림", confident: false });

  it("플래그 꺼짐(기본): 업종 other 에서 생성기가 확신 못 하면 질문 0개 — 예전 그대로", async () => {
    h.generateObject.mockResolvedValue(unsure());
    const out = await suggestTrackingPrompts(otherInput);
    expect(out.prompts).toEqual([]);
  });

  it("플래그 켜짐: 사이트와 대조 통과한 분야 이름으로 기본 질문 4개(이름 없는 3 + 이름 1)", async () => {
    flagsOn("QUESTION_OTHER_FALLBACK_ENABLED");
    h.generateObject.mockResolvedValue(unsure());
    const out = await suggestTrackingPrompts(otherInput);
    expect(out.prompts.map((p) => p.text)).toEqual([
      "민감성 피부 보습 크림 추천해줘",
      "민감성 피부 보습 크림 뭐가 좋아?",
      "민감성 피부 보습 크림 처음 고를 때 뭘 봐야 해?",
      "프란츠 후기 어때?",
    ]);
    expect(out.prompts.filter((p) => p.type === "brand")).toHaveLength(1);
  });

  it("분야 이름이 사이트와 안 맞으면(지어낸 말) 업종 other 는 여전히 빈 목록 — 지어내지 않는다", async () => {
    flagsOn("QUESTION_OTHER_FALLBACK_ENABLED");
    h.generateObject.mockResolvedValue(
      llm({ categoryPhrase: "우주 광산 채굴 장비 대여", confident: false })
    );
    const out = await suggestTrackingPrompts(otherInput);
    expect(out.prompts).toEqual([]);
  });

  it("생성 호출 자체가 실패하면(분야 이름 없음) 예전처럼 빈 목록", async () => {
    flagsOn("QUESTION_OTHER_FALLBACK_ENABLED");
    h.generateObject.mockRejectedValue(new Error("boom"));
    expect((await suggestTrackingPrompts(otherInput)).prompts).toEqual([]);
  });

  it("해외 시장(영어)에 한국어 분야 이름은 번역해 지어내지 않고 비운다", () => {
    expect(
      defaultConsumerQuestionsFromPhrase({
        brandName: "Franz",
        language: "en",
        phrase: "민감성 피부 보습 크림",
      })
    ).toBeNull();
    expect(
      defaultConsumerQuestionsFromPhrase({
        brandName: "Franz",
        language: "en",
        phrase: "sensitive skin moisturizer",
      })?.[3]?.text
    ).toBe("What do people say about Franz?");
  });

  it("경쟁사가 없고 생성이 충분한 업종 other: 플래그 켜짐 때만 한국어 분야 대안 질문 2개가 붙는다", async () => {
    h.generateObject.mockResolvedValue(
      llm({ categoryPhrase: "민감성 피부 보습 크림" })
    );
    const off = await suggestTrackingPrompts(otherInput);
    expect(off.prompts.some((p) => p.type === "alternative")).toBe(false);
    flagsOn("QUESTION_OTHER_FALLBACK_ENABLED");
    h.generateObject.mockResolvedValue(
      llm({ categoryPhrase: "민감성 피부 보습 크림" })
    );
    const on = await suggestTrackingPrompts(otherInput);
    const alts = on.prompts.filter((p) => p.type === "alternative");
    expect(alts).toHaveLength(2);
    expect(alts[0]?.text).toContain("민감성 피부 보습 크림");
  });
});

describe("⑥ 이름 질문 보장", () => {
  const noBrand = () => llm({ brandUnderstanding: [item("이 브랜드 어때?")] });

  it("플래그 꺼짐(기본): 생성기가 이름 질문을 못 내면 예전처럼 이름 질문 0개", async () => {
    h.generateObject.mockResolvedValue(noBrand());
    const out = await suggestTrackingPrompts({ ...base, industry: "beauty" });
    expect(out.prompts.some((p) => p.type === "brand")).toBe(false);
  });

  it("플래그 켜짐: 이름 질문 0개일 때만 고정 문형 3개를 채우고 총합은 20을 넘지 않는다", async () => {
    flagsOn("QUESTION_BRAND_GUARANTEE_ENABLED");
    h.generateObject.mockResolvedValue(noBrand());
    const out = await suggestTrackingPrompts({ ...base, industry: "beauty" });
    const brand = out.prompts
      .filter((p) => p.type === "brand")
      .map((p) => p.text);
    expect(brand).toEqual([
      "프란츠 후기 어때?",
      "프란츠 장단점 알려줘",
      "프란츠 어떤 곳이야?",
    ]);
    expect(out.prompts.length).toBeLessThanOrEqual(20);
    expect(out.prompts.every((p) => p.text.length > 0)).toBe(true);
  });

  it("이름 질문이 이미 있으면 손대지 않는다", async () => {
    flagsOn("QUESTION_BRAND_GUARANTEE_ENABLED");
    h.generateObject.mockResolvedValue(llm());
    const out = await suggestTrackingPrompts({ ...base, industry: "beauty" });
    expect(
      out.prompts.filter((p) => p.type === "brand").map((p) => p.text)
    ).toEqual([
      "프란츠 후기 어때?",
      "프란츠 어디서 사?",
      "프란츠 장단점 알려줘",
    ]);
  });

  it("고정 문형은 시장 범위를 따른다(영어만/둘 다) — 이름은 입력 그대로", () => {
    expect(fixedBrandQuestions("Franz", "global").map((q) => q.text)).toEqual([
      "What do people say about Franz?",
      "What are the pros and cons of Franz?",
      "What is Franz known for?",
    ]);
    const both = fixedBrandQuestions("Franz", "both");
    expect(both.map((q) => q.language)).toContain("ko");
    expect(both.every((q) => q.text.includes("Franz"))).toBe(true);
    expect(fixedBrandQuestions(" ", "korea")).toEqual([]);
  });
});

describe("⑨ '확신 없음'이어도 검사를 통과한 질문이 충분하면 버리지 않는다(52곳 재현 진단)", () => {
  const unsure = (over: Record<string, unknown> = {}) =>
    llm({ confident: false, ...over });

  it("플래그 꺼짐(기본): 확신 없음이면 통과한 질문을 버리고 업종 기본 4개 — 예전 그대로", async () => {
    h.generateObject.mockResolvedValue(unsure());
    const out = await suggestTrackingPrompts({ ...base, industry: "beauty" });
    expect(out.prompts).toHaveLength(4);
    expect(out.lowConfidence).toBeUndefined();
  });

  it("플래그 켜짐: 통과한 질문이 8개 이상이면 그대로 쓰고 lowConfidence 표시", async () => {
    flagsOn("QUESTION_SOFT_CONFIDENCE_ENABLED");
    h.generateObject.mockResolvedValue(unsure());
    const out = await suggestTrackingPrompts({ ...base, industry: "beauty" });
    expect(out.prompts.length).toBeGreaterThanOrEqual(8);
    expect(out.lowConfidence).toBe(true);
  });

  it("플래그 켜짐이라도 통과한 질문이 8개 미만이면 예전처럼 기본 4개", async () => {
    flagsOn("QUESTION_SOFT_CONFIDENCE_ENABLED");
    h.generateObject.mockResolvedValue(
      unsure({
        category: [item("보습 크림 추천해줘"), item("수분 크림 뭐가 좋아?")],
        concern: [item("피부 당길 때 어떤 제품 써야 해?")],
        representative: [],
        brandUnderstanding: [item("프란츠 후기 어때?")],
      })
    );
    const out = await suggestTrackingPrompts({ ...base, industry: "beauty" });
    expect(out.prompts).toHaveLength(4);
    expect(out.lowConfidence).toBeUndefined();
  });

  it("확신 있는 정상 결과는 플래그와 무관하게 lowConfidence 가 붙지 않는다", async () => {
    flagsOn("QUESTION_SOFT_CONFIDENCE_ENABLED");
    h.generateObject.mockResolvedValue(llm());
    const out = await suggestTrackingPrompts({ ...base, industry: "beauty" });
    expect(out.lowConfidence).toBeUndefined();
  });
});

describe("③ 이름 질문 표기 변형(QUESTION_BRAND_VARIANT_ENABLED)", () => {
  const variantLlm = () =>
    llm({
      brandUnderstanding: [
        item("프란츠 스킨케어 후기 어때?"),
        item("프란츠 어디서 사?"),
        item("이 브랜드 평판 어때?"),
      ],
    });
  it("꺼짐(기본): 제목 앞부분 변형은 인정하지 않는다 — 예전과 같다", async () => {
    h.generateObject.mockResolvedValue(
      llm({ brandUnderstanding: [item("프란츠스킨 후기 어때?")] })
    );
    const out = await suggestTrackingPrompts({
      ...base,
      brandName: "(주)프란츠 코리아",
      site: { ...base.site, siteName: "스킨랩", title: "스킨랩 | 시카" },
    });
    expect(out.prompts.some((p) => p.type === "brand")).toBe(false);
  });
  it("켜짐: 법인 꼬리표를 뗀 이름으로 쓴 이름 질문을 인정한다", async () => {
    vi.stubEnv("QUESTION_BRAND_VARIANT_ENABLED", "true");
    h.generateObject.mockResolvedValue(variantLlm());
    const out = await suggestTrackingPrompts({
      ...base,
      brandName: "(주)프란츠 코리아",
      site: { ...base.site, siteName: "스킨랩", title: "스킨랩 | 시카" },
    });
    expect(
      out.prompts.filter((p) => p.type === "brand").length
    ).toBeGreaterThan(0);
  });
  it("이름 없는 질문 판정은 변형 때문에 달라지지 않는다(이름 변형이 들어간 이름 없는 질문은 그대로 통과)", async () => {
    vi.stubEnv("QUESTION_BRAND_VARIANT_ENABLED", "true");
    h.generateObject.mockResolvedValue(variantLlm());
    const out = await suggestTrackingPrompts({ ...base, brandName: "프란츠" });
    expect(out.prompts.length).toBeGreaterThan(0);
  });
});

describe("⑦ 질문 생성 기록(QUESTION_GENERATION_LOG_ENABLED)", () => {
  it("꺼짐(기본): 결과에 generationLog 키가 없다", async () => {
    h.generateObject.mockResolvedValue(llm());
    expect("generationLog" in (await suggestTrackingPrompts(base))).toBe(false);
  });
  it("켜짐: 후보 수·폐기 사유·결정을 담고 질문 문장은 담지 않는다", async () => {
    vi.stubEnv("QUESTION_GENERATION_LOG_ENABLED", "true");
    h.generateObject.mockResolvedValue(llm({ confident: false }));
    const out = await suggestTrackingPrompts(base);
    expect(out.generationLog?.decision).toBe("fallback_unconfident");
    expect(out.generationLog?.rounds[0]?.candidates).toBeGreaterThan(0);
    expect(JSON.stringify(out.generationLog)).not.toContain("추천해줘");
  });
  it("생성 호출이 실패하면 fallback_error", async () => {
    vi.stubEnv("QUESTION_GENERATION_LOG_ENABLED", "true");
    h.generateObject.mockRejectedValue(new Error("boom"));
    const out = await suggestTrackingPrompts(base);
    expect(out.generationLog?.decision).toBe("fallback_error");
  });
});
