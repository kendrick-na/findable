import { describe, expect, it } from "vitest";
import { questionSetKeyOf } from "./question-set-key";

describe("questionSetKeyOf", () => {
  it("순서·대소문자·공백·중복과 무관하다", () => {
    const a = questionSetKeyOf(["수분 크림 추천해줘", "Best  Cream?"]);
    const b = questionSetKeyOf([
      "best cream?",
      " 수분 크림 추천해줘 ",
      "수분 크림 추천해줘",
    ]);
    expect(a).toBe(b);
  });

  it("질문이 하나라도 바뀌면(추가·삭제·수정) 지문이 달라진다", () => {
    const base = ["질문 A", "질문 B"];
    const key = questionSetKeyOf(base);
    expect(questionSetKeyOf([...base, "질문 C"])).not.toBe(key);
    expect(questionSetKeyOf(["질문 A"])).not.toBe(key);
    expect(questionSetKeyOf(["질문 A", "질문 B2"])).not.toBe(key);
  });

  it("질문이 없으면 null(키에 붙이지 않는다)", () => {
    expect(questionSetKeyOf([])).toBeNull();
    expect(questionSetKeyOf(["  "])).toBeNull();
  });
});
