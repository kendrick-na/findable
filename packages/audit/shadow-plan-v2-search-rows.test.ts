import { describe, expect, it, vi } from "vitest";

// 지난 회차 답변에서 뽑은 브랜드 이름은 질문 설계 LLM 프롬프트(forbiddenNames)로 들어간다.
// 네이버·다음 검색 API 결과는 AI 입력 금지(2026-10-07 👤 대표 결정 · 검색 API 약관) —
// 검색 행 발췌에서 뽑은 이름이 섞이면 안 된다.
const h = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock("@repo/database", () => ({
  database: { auditJob: { findFirst: h.findFirst } },
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { liveShadowPlanDeps } from "./shadow-plan-v2";

const list = (names: string[]) =>
  names.map((n, i) => `${i + 1}. **${n}** — 추천 브랜드입니다.`).join("\n");

describe("previousAnswerBrands — search API rows", () => {
  it("ignores naver/daum excerpts and keeps AI engine answers", async () => {
    h.findFirst.mockResolvedValue({
      result: {
        engineResponses: [
          {
            engineId: "naver",
            excerpt: list(["네이버검색전용브랜드", "네이버둘째브랜드"]),
          },
          {
            engineId: "daum",
            excerpt: list(["다음검색전용브랜드", "다음둘째브랜드"]),
          },
          {
            engineId: "chatgpt",
            excerpt: list(["아누아", "라운드랩", "토리든"]),
          },
        ],
      },
    });
    const names = await liveShadowPlanDeps.previousAnswerBrands({
      brandId: "b1",
      brandName: "인디고차일드",
      brandVariants: [],
      competitors: [],
    });
    const joined = names.join("|");
    expect(joined).not.toContain("네이버");
    expect(joined).not.toContain("다음");
    expect(names).toContain("아누아");
  });
});
