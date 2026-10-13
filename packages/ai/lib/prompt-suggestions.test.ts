import { beforeEach, describe, expect, it, vi } from "vitest";

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

const item = (text: string, language: "ko" | "en" = "ko") => ({
  language,
  text,
});
const llm = (over: Record<string, unknown> = {}) => ({
  object: {
    category: [
      item("민감성 피부 보습 크림 추천해줘"),
      item("프란츠 같은 진정 크림 추천해줘"),
      ...Array.from({ length: 9 }, (_, i) =>
        item(`수분 크림 질문 ${i} 추천해줘`)
      ),
    ],
    concern: Array.from({ length: 6 }, (_, i) =>
      item(`피부 고민 ${i} 어떻게 해?`)
    ),
    representative: [
      item("시카 크림 뭐가 좋아?"),
      item("비타민 앰플 추천해줘"),
    ],
    alternative: [
      item("라운드랩 대신 쓸 만한 곳"),
      item("라운드랩 말고 뭐 있어?"),
    ],
    brandUnderstanding: [
      item("프란츠 후기 어때?"),
      item("프란츠 어디서 사?"),
      item("이 브랜드 어때?"),
    ],
    confident: true,
    ...over,
  },
});
const input = {
  aliases: ["FRANZ"],
  brandName: "프란츠",
  competitors: ["라운드랩"],
  domain: "franzskincare.com",
  industry: "beauty",
  marketScope: "korea" as const,
  site: {
    description: "민감성 피부를 위한 시카 크림",
    h1: null,
    siteName: "프란츠",
    title: "프란츠 | 스킨케어",
  },
};

beforeEach(() => {
  h.generateObject.mockReset();
});

describe("suggestTrackingPrompts", () => {
  it("재료(업종·시장·사이트·별칭·경쟁사)를 프롬프트에 싣고 AI 호출은 1번", async () => {
    h.generateObject.mockResolvedValue(llm());
    await suggestTrackingPrompts(input);
    expect(h.generateObject).toHaveBeenCalledTimes(1);
    const prompt: string = h.generateObject.mock.calls[0]?.[0].prompt;
    expect(prompt).toContain("화장품·뷰티");
    expect(prompt).toContain("한국");
    expect(prompt).toContain("프란츠 | 스킨케어");
    expect(prompt).toContain("FRANZ");
    expect(prompt).toContain("라운드랩");
  });

  it("코드가 거른다: 이름 섞인 이름 없는 질문·사이트에 없는 대표 상품·이름 없는 브랜드 질문을 버린다", async () => {
    h.generateObject.mockResolvedValue(llm());
    const { prompts } = await suggestTrackingPrompts(input);
    const texts = prompts.map((p) => p.text);
    expect(texts).not.toContain("프란츠 같은 진정 크림 추천해줘");
    expect(texts).not.toContain("비타민 앰플 추천해줘");
    expect(texts).not.toContain("이 브랜드 어때?");
    expect(texts).toContain("시카 크림 뭐가 좋아?");
    // 이름 없는 유형 어디에도 우리 이름이 없다.
    for (const p of prompts.filter((x) => x.type !== "brand")) {
      expect(p.text).not.toMatch(/프란츠|franz/i);
    }
  });

  it("구성비를 넘기지 않는다(유형별 8·4·3·2·3, 한국 시장은 한국어만)", async () => {
    h.generateObject.mockResolvedValue(llm());
    const { prompts } = await suggestTrackingPrompts(input);
    const count = (t: string) => prompts.filter((p) => p.type === t).length;
    expect(count("category")).toBe(8);
    expect(count("concern")).toBe(4);
    expect(count("alternative")).toBe(2);
    expect(count("brand")).toBe(2);
    expect(prompts.every((p) => p.language === "ko")).toBe(true);
    expect(prompts.length).toBeLessThanOrEqual(20);
  });

  it("저장 값: 이름 질문은 brand 축, 나머지는 competitor 축 + 기존 주제 값", async () => {
    h.generateObject.mockResolvedValue(llm());
    const { prompts } = await suggestTrackingPrompts(input);
    for (const p of prompts) {
      expect(p.category).toBe(p.type === "brand" ? "brand" : "competitor");
      expect(p.topic).toBeTruthy();
    }
  });

  it("비확신·재료 부족·호출 실패면 업종 기반 기본 질문(소비자 말투)으로 폴백", async () => {
    h.generateObject.mockResolvedValue(llm({ confident: false }));
    const a = await suggestTrackingPrompts(input);
    expect(a.prompts).toHaveLength(4);
    h.generateObject.mockRejectedValue(new Error("boom"));
    const b = await suggestTrackingPrompts(input);
    expect(b.prompts).toHaveLength(4);
    for (const p of [...a.prompts, ...b.prompts]) {
      expect(p.text).not.toMatch(
        /강점과 한계|경쟁사를 비교|Is it worth buying/
      );
    }
  });
});

describe("staticFallback", () => {
  it("업종을 모르면 지어내지 않고 빈 목록", () => {
    expect(
      staticFallback({ brandName: "프란츠", domain: "x.com" }).prompts
    ).toEqual([]);
    expect(
      staticFallback({
        brandName: "프란츠",
        domain: "x.com",
        industry: "other",
      }).prompts
    ).toEqual([]);
  });
});
