import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ enabled: false }));
vi.mock("./keys", () => ({
  keys: () => ({ QUESTION_PRERUN_ENABLED: h.enabled }),
}));

import {
  isQuestionPrerunEnabled,
  PRERUN_MAX_QUESTIONS,
  prerunQuestions,
  signalOfAnswer,
} from "./question-prerun";

const brand = { name: "프란츠", variants: ["FRANZ"] };
const list =
  "추천 제품입니다.\n1. 라운드랩 - 진정 크림\n2. 토리든 - 세럼\n3. 아누아 - 토너\n";

beforeEach(() => {
  h.enabled = false;
});

describe("isQuestionPrerunEnabled — 기본 off, Preview 에서는 항상 off", () => {
  it("꺼져 있으면 off", () => expect(isQuestionPrerunEnabled({})).toBe(false));
  it("켜져 있으면 on", () => {
    h.enabled = true;
    expect(isQuestionPrerunEnabled({})).toBe(true);
  });
  it("켜져 있어도 Preview 에서는 off", () => {
    h.enabled = true;
    expect(isQuestionPrerunEnabled({ VERCEL_ENV: "preview" })).toBe(false);
  });
});

describe("signalOfAnswer", () => {
  it("번호 목록의 브랜드 수를 센다", () => {
    const s = signalOfAnswer("민감성 크림 추천해줘", list, brand);
    expect(s.brandsListed).toBeGreaterThanOrEqual(3);
    expect(s.ours).toBe(false);
  });
  it("설명만 하고 브랜드가 없는 답변은 0개", () => {
    const s = signalOfAnswer(
      "SEO랑 달라?",
      "GEO는 AI 답변에서의 노출을 다루는 개념입니다. SEO는 검색 순위를 다룹니다.",
      brand
    );
    expect(s.brandsListed).toBe(0);
  });
  it("우리 브랜드가 나오면 ours", () => {
    expect(signalOfAnswer("q", `${list}프란츠도 있습니다.`, brand).ours).toBe(
      true
    );
  });
});

describe("prerunQuestions", () => {
  it("질문마다 1번씩만 호출하고 순서를 지킨다(동시 4개)", async () => {
    const run = vi.fn(async ({ prompt }: { prompt: string }) => ({
      errorMessage: null,
      isStub: false,
      rawResponse: prompt.includes("설명") ? "설명만 있습니다." : list,
    }));
    const out = await prerunQuestions(
      ["크림 추천해줘", "설명해줘 설명", "토너 추천해줘"],
      brand,
      run
    );
    expect(run).toHaveBeenCalledTimes(3);
    expect(out.map((o) => o.text)).toEqual([
      "크림 추천해줘",
      "설명해줘 설명",
      "토너 추천해줘",
    ]);
    expect(out[1]?.brandsListed).toBe(0);
    expect(out[0]?.brandsListed).toBeGreaterThan(0);
  });

  it("한 질문의 호출 실패·스텁 응답은 그 질문만 error 로 표시한다", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        errorMessage: "429",
        isStub: false,
        rawResponse: "",
      })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        errorMessage: null,
        isStub: true,
        rawResponse: "가짜",
      })
      .mockResolvedValueOnce({
        errorMessage: null,
        isStub: false,
        rawResponse: list,
      });
    const out = await prerunQuestions(
      ["a 질문", "b 질문", "c 질문", "d 질문"],
      brand,
      run
    );
    expect(out.map((o) => Boolean(o.error))).toEqual([true, true, true, false]);
  });

  it(`질문은 ${PRERUN_MAX_QUESTIONS}개까지만 돌린다(원가 상한)`, async () => {
    const run = vi.fn(async () => ({
      errorMessage: null,
      isStub: false,
      rawResponse: list,
    }));
    await prerunQuestions(
      Array.from({ length: 40 }, (_, i) => `질문 ${i}`),
      brand,
      run
    );
    expect(run).toHaveBeenCalledTimes(PRERUN_MAX_QUESTIONS);
  });

  it("한국어 질문은 ko, 영어 질문은 en 으로 호출한다", async () => {
    const run = vi.fn(async (_input: { language: string }) => ({
      errorMessage: null,
      isStub: false,
      rawResponse: list,
    }));
    await prerunQuestions(["크림 추천해줘", "best moisturizers?"], brand, run);
    expect(run.mock.calls.map((c) => c[0].language)).toEqual(["ko", "en"]);
  });
});
