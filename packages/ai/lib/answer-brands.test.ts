import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ generateObject: vi.fn() }));
vi.mock("ai", () => ({ generateObject: h.generateObject }));
vi.mock("./models", () => ({ models: { chat: "stub" } }));
vi.mock("./letsur-fallback", () => ({
  HELPER_GATEWAY_MODEL_ID: "stub",
  letsurModelWithFallback: () => null,
}));
vi.mock("@repo/observability/log", () => ({
  log: { warn: vi.fn(), info: vi.fn() },
}));

import { extractListedBrands, keepNamesPresentInAnswer } from "./answer-brands";

const table =
  "| 브랜드 | 특징 |\n|---|---|\n| **이즈앤트리 (Isntree)** | 성분 중심 |\n| **토리든 (Torriden)** | 수분 |\n| **라운드랩** | 세라마이드 |";

beforeEach(() => {
  h.generateObject.mockReset();
});

describe("keepNamesPresentInAnswer — 모델이 지어낸 이름을 버린다", () => {
  it("본문에 있는 이름만 남기고 중복·너무 짧은 것은 뺀다", () => {
    expect(
      keepNamesPresentInAnswer(
        ["토리든", "라운드랩", "존재하지않는브랜드", "토리든", "a"],
        table
      )
    ).toEqual(["토리든", "라운드랩"]);
  });
  it("띄어쓰기·대소문자 차이를 무시한다", () => {
    expect(
      keepNamesPresentInAnswer(
        ["isntree", "Round Lab"],
        "ISNTREE 와 round lab 이 있어요"
      )
    ).toEqual(["isntree", "Round Lab"]);
  });
});

describe("keepNamesPresentInAnswer — AI 서비스 이름은 세지 않는다", () => {
  it("ChatGPT·Gemini 같은 엔진 이름은 빼고 나머지 브랜드만 남긴다", () => {
    const answer =
      "ChatGPT와 Gemini 같은 AI 에서 Semrush 나 Ahrefs 데이터를 참고하세요";
    expect(
      keepNamesPresentInAnswer(
        ["ChatGPT", "Gemini", "Semrush", "Ahrefs"],
        answer
      )
    ).toEqual(["Semrush", "Ahrefs"]);
  });
});

describe("extractListedBrands", () => {
  it("표로 나열된 답변에서 브랜드 이름을 뽑는다(번호 목록이 아니어도)", async () => {
    h.generateObject.mockResolvedValue({
      object: { brands: ["이즈앤트리", "토리든", "라운드랩"] },
    });
    expect(await extractListedBrands(table)).toEqual([
      "이즈앤트리",
      "토리든",
      "라운드랩",
    ]);
  });
  it("모델이 본문에 없는 이름을 섞어도 걸러낸다", () => {
    expect(keepNamesPresentInAnswer(["토리든", "지어낸회사"], table)).toEqual([
      "토리든",
    ]);
  });
  it("빈 답변은 호출 없이 빈 배열", async () => {
    expect(await extractListedBrands("   ")).toEqual([]);
    expect(h.generateObject).not.toHaveBeenCalled();
  });
  it("호출 실패는 null — 0개로 단정하지 않는다", async () => {
    h.generateObject.mockRejectedValue(new Error("429"));
    expect(await extractListedBrands(table)).toBeNull();
  });
});
