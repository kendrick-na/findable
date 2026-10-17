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
] as const;
const flagsOn = () => {
  for (const f of FLAGS) {
    vi.stubEnv(f, "true");
  }
};

beforeEach(() => {
  h.generateObject.mockReset();
  for (const f of FLAGS) {
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
    flagsOn();
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
    flagsOn();
    h.generateObject.mockResolvedValue(
      llm({ categoryPhrase: "우주 광산 채굴 장비 대여", confident: false })
    );
    const out = await suggestTrackingPrompts(otherInput);
    expect(out.prompts).toEqual([]);
  });

  it("생성 호출 자체가 실패하면(분야 이름 없음) 예전처럼 빈 목록", async () => {
    flagsOn();
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
    flagsOn();
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
    flagsOn();
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
    flagsOn();
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
