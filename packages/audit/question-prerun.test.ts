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

const tableAnswer =
  "| 브랜드 | 특징 |\n|---|---|\n| **토스** | 송금 |\n| **카카오페이** | 결제 |\n| **페이코** | 포인트 |";
const extractor = (names: string[] | null) => vi.fn(async () => names);

describe("signalOfAnswer — 표·문장으로 나열된 답변도 센다(번호 목록이 아니어도)", () => {
  it("표로 나열된 답변: 추출기가 준 브랜드 수를 센다", async () => {
    const s = await signalOfAnswer(
      "송금 서비스 뭐가 좋아?",
      tableAnswer,
      { name: "프란츠" },
      extractor(["토스", "카카오페이", "페이코"])
    );
    expect(s.brandsListed).toBe(3);
    expect(s.ours).toBe(false);
    expect(s.error).toBeUndefined();
  });
  it("설명만 하고 브랜드가 없는 답변은 0개(정상 판정)", async () => {
    const s = await signalOfAnswer(
      "SEO랑 달라?",
      "GEO는 AI 답변에서의 노출을 다루는 개념입니다.",
      brand,
      extractor([])
    );
    expect(s.brandsListed).toBe(0);
    expect(s.error).toBeUndefined();
  });
  it("우리 브랜드가 나오면 ours, 우리 이름은 '다른 브랜드' 수에서 뺀다", async () => {
    const s = await signalOfAnswer(
      "q",
      tableAnswer,
      { name: "토스" },
      extractor(["토스", "카카오페이"])
    );
    expect(s.ours).toBe(true);
    expect(s.brandsListed).toBe(1);
  });
  it("추출기가 실패(null)하면 0개로 단정하지 않고 error 로 둔다", async () => {
    const s = await signalOfAnswer("q", tableAnswer, brand, extractor(null));
    expect(s).toMatchObject({ error: true, brandsListed: 0 });
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
      run,
      async (answer) =>
        answer.includes("설명만") ? [] : ["라운드랩", "토리든"]
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
      run,
      async () => ["라운드랩"]
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
      run,
      async () => ["라운드랩"]
    );
    expect(run).toHaveBeenCalledTimes(PRERUN_MAX_QUESTIONS);
  });

  it("한국어 질문은 ko, 영어 질문은 en 으로 호출한다", async () => {
    const run = vi.fn(async (_input: { language: string }) => ({
      errorMessage: null,
      isStub: false,
      rawResponse: list,
    }));
    await prerunQuestions(
      ["크림 추천해줘", "best moisturizers?"],
      brand,
      run,
      async () => ["라운드랩"]
    );
    expect(run.mock.calls.map((c) => c[0].language)).toEqual(["ko", "en"]);
  });
});
