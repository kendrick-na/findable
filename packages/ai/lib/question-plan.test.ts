import { describe, expect, it } from "vitest";
import {
  composeQuestions,
  defaultConsumerQuestions,
  guardQuestions,
  type PlanQuestion,
  QUESTION_COMPOSITION,
  recommendedBundle,
  targetCounts,
  topicOfType,
} from "./question-plan";

const ctx = {
  brandNames: ["프란츠", "FRANZ", "franzskincare"],
  competitors: ["라운드랩"],
  siteText: "프란츠 | 민감성 피부를 위한 진정 스킨케어, 시카 크림",
};
const q = (
  type: PlanQuestion["type"],
  text: string,
  language: PlanQuestion["language"] = "ko"
): PlanQuestion => ({ language, text, type });

describe("구성비", () => {
  it("합계 20개, 이름 없는 질문 17개(85%)", () => {
    const total = Object.values(QUESTION_COMPOSITION).reduce(
      (a, b) => a + b,
      0
    );
    expect(total).toBe(20);
    expect(
      total -
        QUESTION_COMPOSITION.brand -
        QUESTION_COMPOSITION.alternative +
        QUESTION_COMPOSITION.alternative
    ).toBe(17);
  });

  it("언어 배분: 한국=ko만, 해외=en만, 둘 다=7:3, 합계는 항상 구성비와 같다", () => {
    for (const scope of ["korea", "global", "both"] as const) {
      const t = targetCounts(scope);
      for (const type of Object.keys(
        QUESTION_COMPOSITION
      ) as (keyof typeof QUESTION_COMPOSITION)[]) {
        expect(t[type].ko + t[type].en).toBe(QUESTION_COMPOSITION[type]);
      }
    }
    const korea = targetCounts("korea");
    expect(Object.values(korea).every((v) => v.en === 0)).toBe(true);
    const global = targetCounts("global");
    expect(Object.values(global).every((v) => v.ko === 0)).toBe(true);
    const both = targetCounts("both");
    const en = Object.values(both).reduce((a, v) => a + v.en, 0);
    expect(en).toBe(6); // 20 중 약 30%
  });
});

describe("자동 검사 — 지어낸 사실·이름 섞임을 코드가 거른다", () => {
  it("이름 없는 유형에 우리 이름·별칭·도메인 이름이 들어가면 버린다", () => {
    const r = guardQuestions(
      [
        q("category", "민감성 피부 크림 추천해줘"),
        q("category", "프란츠 같은 진정 크림 추천해줘"),
        q("concern", "FRANZ 쓰면 트러블 가라앉아?"),
        q("alternative", "franzskincare 대신 쓸 만한 곳"),
      ],
      ctx
    );
    expect(r.kept.map((x) => x.text)).toEqual(["민감성 피부 크림 추천해줘"]);
    expect(r.dropped.map((d) => d.reason)).toEqual([
      "name_in_nameless",
      "name_in_nameless",
      "name_in_nameless",
    ]);
  });

  it("브랜드 이해 유형은 이름이 있어야 하고, 없으면 버린다", () => {
    const r = guardQuestions(
      [q("brand", "프란츠 후기 어때?"), q("brand", "이 브랜드 후기 어때?")],
      ctx
    );
    expect(r.kept).toHaveLength(1);
    expect(r.dropped[0]?.reason).toBe("brand_missing");
  });

  it("대표 상품 질문은 사이트 문구에 있는 말일 때만 통과한다", () => {
    const r = guardQuestions(
      [
        q("representative", "시카 크림 뭐가 좋아?"),
        q("representative", "비타민 앰플 추천해줘"),
      ],
      ctx
    );
    expect(r.kept.map((x) => x.text)).toEqual(["시카 크림 뭐가 좋아?"]);
    expect(r.dropped[0]?.reason).toBe("no_site_evidence");
  });

  it("사이트 문구가 없으면 대표 상품 질문은 전부 버린다(지어내지 않는다)", () => {
    const r = guardQuestions([q("representative", "시카 크림 뭐가 좋아?")], {
      ...ctx,
      siteText: "",
    });
    expect(r.kept).toHaveLength(0);
  });

  it("경쟁사 이름은 비교·대안 질문에 쓸 수 있다", () => {
    const r = guardQuestions(
      [q("alternative", "라운드랩 대신 쓸 만한 곳")],
      ctx
    );
    expect(r.kept).toHaveLength(1);
  });

  it("목록 기호·따옴표를 정리하고 중복·너무 짧은 질문은 버린다", () => {
    const r = guardQuestions(
      [
        q("category", '1. "수분 크림 추천해줘"'),
        q("category", "수분 크림 추천해줘"),
        q("category", "네"),
      ],
      ctx
    );
    expect(r.kept.map((x) => x.text)).toEqual(["수분 크림 추천해줘"]);
    expect(r.dropped.map((d) => d.reason).sort()).toEqual([
      "duplicate",
      "length",
    ]);
  });
});

describe("구성·추천 구성 담기", () => {
  const many = [
    ...Array.from({ length: 12 }, (_, i) =>
      q("category", `카테고리 질문 ${i}`)
    ),
    ...Array.from({ length: 6 }, (_, i) => q("concern", `고민 질문 ${i}`)),
    ...Array.from({ length: 4 }, (_, i) => q("alternative", `대안 질문 ${i}`)),
    ...Array.from({ length: 5 }, (_, i) => q("brand", `프란츠 질문 ${i}`)),
  ];

  it("유형별 목표 개수만큼만 남기고, 모자란 칸은 채우지 않는다", () => {
    const out = composeQuestions(many, "korea");
    const count = (t: PlanQuestion["type"]) =>
      out.filter((x) => x.type === t).length;
    expect(count("category")).toBe(8);
    expect(count("concern")).toBe(4);
    expect(count("representative")).toBe(0); // 재료가 없으면 비운다
    expect(count("alternative")).toBe(2);
    expect(count("brand")).toBe(3);
  });

  it("추천 구성: 플랜 상한 안에서 유형을 번갈아 고른다(무료 5개)", () => {
    const out = composeQuestions(many, "korea");
    const picked = recommendedBundle(out, 5).map((i) => out[i]?.type);
    expect(picked).toHaveLength(5);
    expect(new Set(picked).size).toBeGreaterThanOrEqual(4);
    expect(picked).toContain("category");
    expect(picked).toContain("concern");
  });

  it("추천 구성은 상한이 후보보다 크면 후보 전부", () => {
    const out = composeQuestions(many, "korea");
    expect(recommendedBundle(out, 100)).toHaveLength(out.length);
    expect(recommendedBundle(out, 0)).toEqual([]);
  });
});

describe("기본 질문 폴백 — 소비자 말투", () => {
  const base = { englishName: "FRANZ", koreanName: "프란츠" };

  it("업종을 알면 이름 없는 3 + 이름 1, 사업자 문구 없음", () => {
    const qs = defaultConsumerQuestions({
      ...base,
      industry: "beauty",
      language: "ko",
    });
    expect(qs).toHaveLength(4);
    expect(qs?.filter((x) => x.nameless)).toHaveLength(3);
    for (const x of qs ?? []) {
      expect(x.text).not.toMatch(
        /강점과 한계|경쟁사를 비교|Is it worth buying/
      );
    }
    expect(
      qs?.filter((x) => x.nameless).every((x) => !x.text.includes("프란츠"))
    ).toBe(true);
  });

  it("업종이 없거나 other 면 null(지어내지 않는다)", () => {
    for (const industry of [undefined, null, "other", "없는업종"]) {
      expect(
        defaultConsumerQuestions({ ...base, industry, language: "ko" })
      ).toBeNull();
    }
  });

  it("모든 업종 분야 표기로 질문을 만들 수 있다", () => {
    for (const industry of [
      "beauty",
      "fashion",
      "food",
      "b2b_saas",
      "content_ip",
      "retail",
      "finance",
      "healthcare",
      "education",
      "manufacturing",
    ]) {
      expect(
        defaultConsumerQuestions({ ...base, industry, language: "both" })
      ).toHaveLength(4);
    }
  });
});

describe("유형 → 저장 주제 (DB enum 안)", () => {
  it("5유형이 모두 기존 PromptCategory 값으로 매핑된다", () => {
    const allowed = new Set([
      "best_in_category",
      "alternative",
      "comparison",
      "recommendation",
      "problem_solving",
      "buying_guide",
      "custom",
    ]);
    for (const type of [
      "category",
      "concern",
      "representative",
      "alternative",
      "brand",
    ] as const) {
      expect(allowed.has(topicOfType(type))).toBe(true);
    }
  });
});
